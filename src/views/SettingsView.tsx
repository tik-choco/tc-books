// Settings screen. Tabbed layout (帳簿 / AI接続 / AI Network / タスク /
// バックアップ / はじめに). Owns:
//   - 共有LLM設定 (tc-shared-llm-config-v1, lib/llmConfig.ts) — providers/
//     presets/defaultPreset/network.roomId, co-owned with the rest of the
//     tik-choco app family. Edits go through lib/llmConfigEdit.ts's CRUD
//     helpers (create/patch/delete), applied to a structuredClone of the
//     current config (see mutateShared below) so other apps' entries are
//     only ever patched/removed by explicit user action here, never
//     silently dropped by a stale-state overwrite.
//   - tc-books設定 (lib/llmSettings.ts) — which preset (+ reasoning_effort)
//     each task (既定/領収書OCR/領収書解析) uses, plus the AI Network(P2P)
//     consumer toggle.
//   - バックアップ — read-only status for the automatic encrypted
//     tc-storage backup (lib/booksBackupPublisher.ts).
//
// UI form follows tc-docs/drafts/llm-settings-common-v1.md (AI接続 / AI
// Network / タスク の3タブ + ツールチップ方式), ported from tc-translate's
// src/components/SettingsModal.tsx via src/components/LlmConnectionPanel.tsx
// (the provider/preset flat card grid). tc-books has no AI Network
// "provider" role (see lib/network.ts — consumer-only) and no TTS/STT, so
// the AI Networkタブ only has the consumer role card and the タスクタブ has
// no voice rows (per the guide's §5.3 checklist items 4/5/7 — not
// applicable here).

import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  BookOpenText,
  Bot,
  Check,
  Cloud,
  Network,
  Pencil,
  Plug,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  X,
} from "lucide-preact";
import { MESSAGES_JA } from "@tik-choco/mistai";
import { ConsumerStatusIndicator } from "@tik-choco/mistai/preact";
import { emptyLlmConfig, loadLlmConfig, saveLlmConfig, subscribeLlmConfig, type SharedLlmConfigV1 } from "../lib/llmConfig";
import { loadLocalSettings, saveLocalSettings, REASONING_EFFORT_OPTIONS, type BooksLocalSettings, type ReasoningEffort } from "../lib/llmSettings";
import { requestOnboarding } from "../lib/onboarding";
import { paneEnterClass, useEnterDirection } from "../hooks/useEnterDirection";
import { useDraftField } from "../hooks/useDraftField";
import {
  connectNetworkConsumer,
  consumerStatus,
  disconnectNetworkConsumer,
  onConsumerStatusChange,
  type ConsumerStatus,
} from "../lib/network";
import { createBook, deleteBook, getActiveBookId, loadBooks, renameBook, setActiveBook, subscribeBooks, updateBookKind } from "../lib/store";
import type { Book, BookKind } from "../types";
import { BOOK_KIND_LABEL, BOOK_KIND_ORDER } from "../components/BookSwitcher";
import { LlmConnectionPanel } from "../components/LlmConnectionPanel";
import "../styles/settings.css";
import "../styles/network-status.css";

// Read-only presence check for booksBackupPublisher's publish-state record —
// this view only reports "has a backup ever been published successfully",
// it never writes this key itself.
const BACKUP_STATE_KEY = "tc-books:backup-publish-state-v1";

function hasPublishedBackup(): boolean {
  try {
    const raw = localStorage.getItem(BACKUP_STATE_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const record = parsed as Record<string, unknown>;
    return record.v === 1 && typeof record.signature === "string" && record.signature.length > 0;
  } catch {
    return false;
  }
}

function formatBookDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ja-JP");
}

// ----- Settings tabs -------------------------------------------------------
// Tab selection is remembered across visits (localStorage, parsed defensively
// — same pattern as llmSettings.ts).

type SettingsTabId = "books" | "connection" | "network" | "tasks" | "backup" | "onboarding";

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string; icon: typeof Plug }> = [
  { id: "books", label: "帳簿", icon: BookOpenText },
  { id: "connection", label: "AI接続", icon: Plug },
  { id: "network", label: "AI Network", icon: Network },
  { id: "tasks", label: "タスク", icon: Bot },
  { id: "backup", label: "バックアップ", icon: Cloud },
  { id: "onboarding", label: "はじめに", icon: Sparkles },
];

const SETTINGS_TAB_ORDER: SettingsTabId[] = SETTINGS_TABS.map((tab) => tab.id);

const SETTINGS_TAB_STORAGE_KEY = "tc-books:settings-tab";

function loadSettingsTab(): SettingsTabId {
  try {
    const raw = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
    if (raw && SETTINGS_TABS.some((tab) => tab.id === raw)) return raw as SettingsTabId;
    // 旧タブ構成("llm"/"ocr")からの読み替え。
    if (raw === "llm") return "connection";
    if (raw === "ocr") return "tasks";
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back to default.
  }
  return "connection";
}

function saveSettingsTab(tab: SettingsTabId): void {
  try {
    localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab);
  } catch {
    // Non-fatal — the tab just won't be remembered next visit.
  }
}

function ReasoningEffortSelect(props: { value: ReasoningEffort; onChange: (next: ReasoningEffort) => void }) {
  return (
    <div class="task-model-field">
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value as ReasoningEffort)}
        aria-label="reasoning_effort"
        title="reasoning_effort"
      >
        {REASONING_EFFORT_OPTIONS.map((effort) => (
          <option key={effort} value={effort}>
            {effort}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SettingsView(): JSX.Element {
  // Active tab is pure UI state (which panel is visible) — it must not gate
  // any of the hooks below, so the shared-LLM subscription, the AI Network
  // consumer connection, and the backup-status polling all keep running even
  // while another tab is showing.
  const [activeTab, setActiveTabState] = useState<SettingsTabId>(() => loadSettingsTab());
  function setActiveTab(tab: SettingsTabId): void {
    setActiveTabState(tab);
    saveSettingsTab(tab);
  }
  const enterDir = useEnterDirection(SETTINGS_TAB_ORDER, activeTab);

  // 共有設定 (他タブ/他アプリの変更も subscribeLlmConfig で反映)
  const [shared, setShared] = useState<SharedLlmConfigV1>(() => loadLlmConfig() ?? emptyLlmConfig());
  useEffect(() => subscribeLlmConfig((cfg) => setShared(cfg ?? emptyLlmConfig())), []);

  // tc-books固有のローカル設定
  const [local, setLocal] = useState<BooksLocalSettings>(() => loadLocalSettings());

  // ----- 帳簿一覧 (他タブ/ヘッダーのBookSwitcherでの変更も subscribeBooks で反映) -----
  const [books, setBooks] = useState<Book[]>(() => loadBooks());
  const [activeBookId, setActiveBookId] = useState<string>(() => getActiveBookId());
  useEffect(
    () =>
      subscribeBooks(() => {
        setBooks(loadBooks());
        setActiveBookId(getActiveBookId());
      }),
    [],
  );

  const [creatingBook, setCreatingBook] = useState(false);
  const [newBookName, setNewBookName] = useState("");
  const [newBookKind, setNewBookKind] = useState<BookKind>("household");

  function submitCreateBook(e: Event) {
    e.preventDefault();
    const trimmed = newBookName.trim();
    if (!trimmed) return;
    const book = createBook(trimmed, newBookKind);
    setActiveBook(book.id);
    setNewBookName("");
    setNewBookKind("household");
    setCreatingBook(false);
  }

  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [editingBookName, setEditingBookName] = useState("");

  function startRenameBook(book: Book) {
    setEditingBookId(book.id);
    setEditingBookName(book.name);
  }

  function cancelRenameBook() {
    setEditingBookId(null);
    setEditingBookName("");
  }

  function submitRenameBook(e: Event) {
    e.preventDefault();
    const trimmed = editingBookName.trim();
    if (!trimmed || !editingBookId) return;
    renameBook(editingBookId, trimmed);
    cancelRenameBook();
  }

  function handleChangeBookKind(book: Book, nextKind: BookKind) {
    if (nextKind === book.kind) return;
    const ok = confirm(
      `帳簿「${book.name}」の種別を「${BOOK_KIND_LABEL[nextKind]}」に変更しますか?\nクイック入力などの科目候補が新しい種別のものに変わります。過去の仕訳はそのまま残ります。`,
    );
    if (!ok) {
      // selectはbook.kindを value とする制御コンポーネントだが、ブラウザは
      // change時点でDOMの表示値を先に書き換えているため、キャンセル時は
      // 明示的に再描画してbook.kindへ戻す。
      setBooks(loadBooks());
      return;
    }
    updateBookKind(book.id, nextKind);
  }

  function handleDeleteBook(book: Book) {
    if (books.length <= 1) return;
    const ok = confirm(
      `帳簿「${book.name}」を削除しますか?\nこの帳簿の仕訳・勘定科目もすべて削除され、元に戻せません。`,
    );
    if (!ok) return;
    if (editingBookId === book.id) cancelRenameBook();
    deleteBook(book.id);
  }

  const [consumer, setConsumer] = useState<ConsumerStatus>(() => consumerStatus());
  const [consumerUpdatedAt, setConsumerUpdatedAt] = useState(0);
  useEffect(
    () =>
      onConsumerStatusChange((next) => {
        setConsumer(next);
        setConsumerUpdatedAt(Date.now());
      }),
    [],
  );

  const [backupPublished, setBackupPublished] = useState(() => hasPublishedBackup());
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === BACKUP_STATE_KEY) setBackupPublished(hasPublishedBackup());
    }
    window.addEventListener("storage", onStorage);
    // 同タブでの初回自動発行(起動5秒後)も拾えるよう、軽くポーリングもしておく。
    const timer = setInterval(() => setBackupPublished(hasPublishedBackup()), 3000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(timer);
    };
  }, []);

  // 共有設定への書き込みは常にこのヘルパー経由: 現在の値のstructuredClone
  // をmutateして保存する(lib/llmConfigEdit.tsのCRUD関数をそのまま渡せる)。
  // 他アプリ/他タブの変更を踏み越えて上書きしないよう、常に最新の`shared`
  // 状態からクローンする。
  function mutateShared(mutate: (config: SharedLlmConfigV1) => void): void {
    const next = structuredClone(shared);
    mutate(next);
    saveLlmConfig(next);
    setShared(next);
  }

  function updateLocal(next: BooksLocalSettings) {
    setLocal(next);
    saveLocalSettings(next);
  }

  // presetが削除された時、そのidを指していたタスクのローカルポインタは
  // "未設定(既定に従う)"へ落とす。
  function handlePresetRemoved(id: string): void {
    const patch: Partial<BooksLocalSettings> = {};
    if (local.visionPresetId === id) patch.visionPresetId = "";
    if (local.extractPresetId === id) patch.extractPresetId = "";
    if (Object.keys(patch).length > 0) updateLocal({ ...local, ...patch });
  }

  // ----- AI Network consumer 接続ライフサイクル -------------------------------
  const consumerRoom = shared.network.roomId.trim();
  useEffect(() => {
    if (!local.networkConsumerEnabled || !consumerRoom) {
      disconnectNetworkConsumer();
      return;
    }
    // ルームID入力中の連打を避けるためデバウンス。
    const timer = setTimeout(() => void connectNetworkConsumer(consumerRoom), 500);
    return () => clearTimeout(timer);
  }, [local.networkConsumerEnabled, consumerRoom]);

  const roomIdField = useDraftField(shared.network.roomId, (next) => mutateShared((config) => (config.network = { roomId: next })));

  return (
    <div class="settings-view">
      <div class="settings-inner">
        <h1 class="settings-title">
          <SettingsIcon size={20} /> 設定
        </h1>

        <div class="settings-tabs" role="tablist" aria-label="設定タブ">
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`settings-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`settings-panel-${tab.id}`}
                class={`settings-tab${selected ? " settings-tab--active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={15} /> {tab.label}
              </button>
            );
          })}
        </div>

        <div key={activeTab} class={paneEnterClass(enterDir)}>
          {/* ----- 帳簿 ----- */}
          {activeTab === "books" ? (
            <section
              class="settings-section"
              role="tabpanel"
              id="settings-panel-books"
              aria-labelledby="settings-tab-books"
            >
              <div class="settings-heading-row">
                <h2 class="settings-heading">
                  <BookOpenText size={16} /> 帳簿
                </h2>
                <button
                  type="button"
                  class="settings-btn settings-btn-ghost"
                  onClick={() => {
                    setCreatingBook((v) => !v);
                    setNewBookName("");
                    setNewBookKind("household");
                  }}
                >
                  {creatingBook ? <X size={15} /> : <Plus size={15} />}
                  {creatingBook ? "閉じる" : "新しい帳簿を作成"}
                </button>
              </div>
              <p class="settings-hint">
                帳簿ごとに仕訳・勘定科目が独立して管理されます。ヘッダーの帳簿名からいつでも切り替えられます。
              </p>

              {creatingBook ? (
                <form class="settings-card" onSubmit={submitCreateBook}>
                  <label class="settings-field">
                    <span>帳簿名</span>
                    <input
                      value={newBookName}
                      placeholder="例: 〇〇サークル"
                      onInput={(e) => setNewBookName(e.currentTarget.value)}
                      autoFocus
                    />
                  </label>
                  <label class="settings-field">
                    <span>種別</span>
                    <select value={newBookKind} onChange={(e) => setNewBookKind(e.currentTarget.value as BookKind)}>
                      {BOOK_KIND_ORDER.map((kind) => (
                        <option key={kind} value={kind}>
                          {BOOK_KIND_LABEL[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style="display:flex;justify-content:flex-end;">
                    <button type="submit" class="settings-btn settings-btn-ghost" disabled={!newBookName.trim()}>
                      <Plus size={15} /> 作成して切り替え
                    </button>
                  </div>
                </form>
              ) : null}

              <div class="settings-card-list">
                {books.map((book) => (
                  <div key={book.id} class="settings-card">
                    {editingBookId === book.id ? (
                      <form class="settings-card-head" onSubmit={submitRenameBook}>
                        <input
                          class="settings-card-label"
                          value={editingBookName}
                          onInput={(e) => setEditingBookName(e.currentTarget.value)}
                          autoFocus
                        />
                        <button
                          type="submit"
                          class="settings-icon-btn"
                          title="保存"
                          aria-label="保存"
                          disabled={!editingBookName.trim()}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          class="settings-icon-btn"
                          title="キャンセル"
                          aria-label="キャンセル"
                          onClick={cancelRenameBook}
                        >
                          <X size={14} />
                        </button>
                      </form>
                    ) : (
                      <div class="settings-card-head">
                        <span class="settings-card-label">{book.name}</span>
                        {book.id === activeBookId ? <span class="settings-badge">使用中</span> : null}
                        <button
                          type="button"
                          class="settings-icon-btn"
                          title="名前を変更"
                          aria-label="名前を変更"
                          onClick={() => startRenameBook(book)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          class="settings-icon-btn"
                          title={books.length <= 1 ? "最後の1冊は削除できません" : "削除"}
                          aria-label="削除"
                          disabled={books.length <= 1}
                          onClick={() => handleDeleteBook(book)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                    <div class="settings-field-hint settings-book-kind-row">
                      <span>種別:</span>
                      <select
                        class="settings-book-kind-select"
                        value={book.kind}
                        onChange={(e) => handleChangeBookKind(book, e.currentTarget.value as BookKind)}
                      >
                        {BOOK_KIND_ORDER.map((kind) => (
                          <option key={kind} value={kind}>
                            {BOOK_KIND_LABEL[kind]}
                          </option>
                        ))}
                      </select>
                      <span>・ 作成日: {formatBookDate(book.createdAt)}</span>
                    </div>
                  </div>
                ))}
                {books.length === 0 ? <p class="settings-empty">帳簿がありません。</p> : null}
              </div>
            </section>
          ) : null}

          {/* ----- AI接続 ----- */}
          {activeTab === "connection" ? (
            <section
              class="settings-section"
              role="tabpanel"
              id="settings-panel-connection"
              aria-labelledby="settings-tab-connection"
            >
              <h2 class="settings-heading">
                <Plug size={16} /> AI接続
              </h2>
              <p class="settings-hint">
                接続先(Base URL・APIキー)とモデルの設定です。同じオリジン上のtik-choco系アプリ間で共有されます。
              </p>
              <LlmConnectionPanel shared={shared} local={local} onMutate={mutateShared} onPresetRemoved={handlePresetRemoved} />
            </section>
          ) : null}

          {/* ----- AI Network ----- */}
          {activeTab === "network" ? (
            <section
              class="settings-section"
              role="tabpanel"
              id="settings-panel-network"
              aria-labelledby="settings-tab-network"
            >
              <h2 class="settings-heading">
                <Network size={16} /> AI Network
              </h2>
              <p class="settings-hint">P2Pネットワーク経由でLLM推論を共有・利用するための合言葉(Room ID)です。</p>

              <label class="settings-field">
                <span>Room ID</span>
                <input
                  value={roomIdField.draft}
                  onInput={(e) => roomIdField.onInput(e.currentTarget.value)}
                  onFocus={roomIdField.onFocus}
                  onBlur={roomIdField.onBlur}
                  placeholder="tc-llm"
                />
              </label>

              <div class="settings-role-group">
                <div class="settings-role-card">
                  <label class="settings-role-head">
                    <input
                      type="checkbox"
                      checked={local.networkConsumerEnabled}
                      onChange={(e) => updateLocal({ ...local, networkConsumerEnabled: e.currentTarget.checked })}
                    />
                    <span class="settings-role-title">
                      <Network size={15} />
                      AI NetworkのLLMを使う
                    </span>
                  </label>
                  <p class="settings-role-desc">
                    領収書OCR(画像)以外のテキストLLM呼び出しをP2P経由でルーム内のプロバイダに送ります。
                  </p>
                  {local.networkConsumerEnabled ? (
                    <div class="settings-role-body">
                      <ConsumerStatusIndicator status={consumer} updatedAt={consumerUpdatedAt} variant="detailed" messages={MESSAGES_JA} />
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {/* ----- タスク ----- */}
          {activeTab === "tasks" ? (
            <section class="settings-section" role="tabpanel" id="settings-panel-tasks" aria-labelledby="settings-tab-tasks">
              <h2 class="settings-heading">
                <Bot size={16} /> タスク
              </h2>

              <div class="task-model-item">
                <span data-tip="仕訳のAI推定など、他のタスクに割り当てのない呼び出しで使うモデルです。">既定</span>
                <div class="task-model-fields">
                  <div class="task-model-field">
                    <select
                      value={shared.defaultPresetId}
                      onChange={(e) => mutateShared((config) => (config.defaultPresetId = e.currentTarget.value))}
                      aria-label="既定"
                    >
                      <option value="">未設定</option>
                      {shared.presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label || p.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <ReasoningEffortSelect
                    value={local.defaultReasoningEffort}
                    onChange={(next) => updateLocal({ ...local, defaultReasoningEffort: next })}
                  />
                </div>
              </div>

              <div class="task-model-item">
                <span data-tip="領収書画像の文字起こしに使うモデルです。常に直接HTTP接続で実行されます(AI Networkのワイヤーは画像に対応していません)。">
                  領収書OCR
                </span>
                <div class="task-model-fields">
                  <div class="task-model-field">
                    <select
                      value={local.visionPresetId}
                      onChange={(e) => updateLocal({ ...local, visionPresetId: e.currentTarget.value })}
                      aria-label="領収書OCR"
                    >
                      <option value="">既定と同じ</option>
                      {shared.presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label || p.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <ReasoningEffortSelect
                    value={local.visionReasoningEffort}
                    onChange={(next) => updateLocal({ ...local, visionReasoningEffort: next })}
                  />
                </div>
              </div>

              <div class="task-model-item">
                <span data-tip="文字起こし結果をJSON形式の仕訳データに変換するテキストLLMです。未設定の場合は領収書OCR用と同じ接続先を使います。">
                  領収書解析
                </span>
                <div class="task-model-fields">
                  <div class="task-model-field">
                    <select
                      value={local.extractPresetId}
                      onChange={(e) => updateLocal({ ...local, extractPresetId: e.currentTarget.value })}
                      aria-label="領収書解析"
                    >
                      <option value="">領収書OCR用と同じ</option>
                      {shared.presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label || p.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <ReasoningEffortSelect
                    value={local.extractReasoningEffort}
                    onChange={(next) => updateLocal({ ...local, extractReasoningEffort: next })}
                  />
                </div>
              </div>
            </section>
          ) : null}

          {/* ----- バックアップ ----- */}
          {activeTab === "backup" ? (
            <section
              class="settings-section"
              role="tabpanel"
              id="settings-panel-backup"
              aria-labelledby="settings-tab-backup"
            >
              <h2 class="settings-heading">
                <Cloud size={16} /> バックアップ
              </h2>
              <p class="settings-hint">tc-storageへ自動バックアップ（暗号化）が有効です。仕訳や科目を変更すると自動的に反映されます。</p>
              <p class="settings-hint" role="status">
                {backupPublished ? "最終発行: 済み" : "最終発行: 未発行（起動後しばらくすると自動で発行されます）"}
              </p>
            </section>
          ) : null}

          {/* ----- はじめに ----- */}
          {activeTab === "onboarding" ? (
            <section
              class="settings-section"
              role="tabpanel"
              id="settings-panel-onboarding"
              aria-labelledby="settings-tab-onboarding"
            >
              <h2 class="settings-heading">
                <Sparkles size={16} /> はじめに
              </h2>
              <p class="settings-hint">初回起動時のセットアップガイドをもう一度表示できます。</p>
              <button type="button" class="settings-btn settings-btn-ghost" onClick={requestOnboarding}>
                <Sparkles size={15} /> セットアップガイドを表示
              </button>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
