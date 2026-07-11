// Settings screen. Used to be one long scrolling page; it's now a tabbed
// layout (LLM / 領収書OCR / AI Network / バックアップ / はじめに) so a user
// looking for one setting doesn't have to scroll past the other four. Owns:
//   - 共有LLM設定 (tc-shared-llm-config-v1, lib/llmConfig.ts) — providers/
//     presets/defaultPreset/network.roomId, co-owned with the rest of the
//     tik-choco app family. Edits merge-never-delete (ensureProvider/
//     ensurePreset for additions; existing entries are only ever patched in
//     place, never removed here — see docs/CONTRACTS.md).
//   - tc-books設定 (lib/llmSettings.ts) — which preset the receipt-OCR vision
//     feature uses, plus the AI Network(P2P) consumer toggle.
//   - バックアップ — read-only status for the automatic encrypted
//     tc-storage backup (lib/booksBackupPublisher.ts).
// Modeled on tc-town's / tc-news's src/views/SettingsView.tsx (tab structure)
// and tc-translate's src/lib/llmConfigEdit.ts, trimmed to tc-books' simpler
// local-settings shape (no TTS/STT, no per-role preset pointers, no i18n layer).

import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  BookOpenText,
  Bot,
  Check,
  Cloud,
  Cpu,
  Network,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  X,
} from "lucide-preact";
import { fetchModels } from "@tik-choco/mistai";
import {
  emptyLlmConfig,
  ensurePreset,
  ensureProvider,
  loadLlmConfig,
  saveLlmConfig,
  subscribeLlmConfig,
  type LlmProviderV1,
  type ModelPresetV1,
  type SharedLlmConfigV1,
} from "../lib/llmConfig";
import { loadLocalSettings, saveLocalSettings, type BooksLocalSettings } from "../lib/llmSettings";
import { requestOnboarding } from "../lib/onboarding";
import { paneEnterClass, useEnterDirection } from "../hooks/useEnterDirection";
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
import "../styles/settings.css";

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

/** モデル名の入力欄。「候補取得」ボタンで fetchModels を呼び datalist に反映する。
 * 取得に失敗した場合は無視して手入力にフォールバックする。 */
function ModelInput(props: {
  listId: string;
  value: string;
  baseUrl: string;
  apiKey: string;
  onChange: (model: string) => void;
}): JSX.Element {
  const { listId, value, baseUrl, apiKey, onChange } = props;
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!baseUrl.trim()) return;
    setLoading(true);
    try {
      const models = await fetchModels({ baseUrl, apiKey });
      setOptions(models);
    } catch {
      // 失敗は無視: 手入力にフォールバックする
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="settings-model-field">
      <input list={listId} value={value} placeholder="gpt-4o-mini" onInput={(e) => onChange(e.currentTarget.value)} />
      <datalist id={listId}>
        {options.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <button
        type="button"
        class={`settings-icon-btn${loading ? " settings-icon-btn-loading" : ""}`}
        onClick={refresh}
        disabled={loading || !baseUrl.trim()}
        title="モデル候補を取得"
        aria-label="モデル候補を取得"
      >
        <RefreshCw size={14} />
      </button>
    </div>
  );
}

function formatBookDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ja-JP");
}

function consumerStatusLabel(status: ConsumerStatus): string {
  switch (status.phase) {
    case "joining":
      return "Roomに接続中…";
    case "searching":
      return "プロバイダを検索中…";
    case "connected":
      return `プロバイダに接続済み${status.models?.length ? `（${status.models.join(", ")}）` : ""}`;
    case "error":
      return `接続エラー: ${status.message}`;
    default:
      return "未接続";
  }
}

// ----- Settings tabs -------------------------------------------------------
// Tab selection is remembered across visits (localStorage, parsed defensively
// — same pattern as llmSettings.ts).

type SettingsTabId = "books" | "llm" | "ocr" | "network" | "backup" | "onboarding";

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string; icon: typeof Plug }> = [
  { id: "books", label: "帳簿", icon: BookOpenText },
  { id: "llm", label: "LLM", icon: Plug },
  { id: "ocr", label: "領収書OCR", icon: Bot },
  { id: "network", label: "AI Network", icon: Network },
  { id: "backup", label: "バックアップ", icon: Cloud },
  { id: "onboarding", label: "はじめに", icon: Sparkles },
];

const SETTINGS_TAB_ORDER: SettingsTabId[] = SETTINGS_TABS.map((tab) => tab.id);

const SETTINGS_TAB_STORAGE_KEY = "tc-books:settings-tab";

function loadSettingsTab(): SettingsTabId {
  try {
    const raw = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
    if (raw && SETTINGS_TABS.some((tab) => tab.id === raw)) return raw as SettingsTabId;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back to default.
  }
  return "llm";
}

function saveSettingsTab(tab: SettingsTabId): void {
  try {
    localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab);
  } catch {
    // Non-fatal — the tab just won't be remembered next visit.
  }
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
  useEffect(() => onConsumerStatusChange(setConsumer), []);

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

  function updateShared(next: SharedLlmConfigV1) {
    setShared(next);
    saveLlmConfig(next);
  }

  function updateLocal(next: BooksLocalSettings) {
    setLocal(next);
    saveLocalSettings(next);
  }

  // ----- Providers (共有・追加はensureProviderでmerge-never-delete) -----------
  function addProvider() {
    const next: SharedLlmConfigV1 = { ...shared, providers: [...shared.providers] };
    ensureProvider(next, { label: "新しいプロバイダ", baseUrl: "", apiKey: "" });
    updateShared(next);
  }

  function updateProvider(id: string, patch: Partial<LlmProviderV1>) {
    updateShared({
      ...shared,
      providers: shared.providers.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider)),
    });
  }

  // ----- Presets (共有・追加はensurePresetでmerge-never-delete) ---------------
  function addPreset() {
    const firstProvider = shared.providers[0];
    if (!firstProvider) return;
    const next: SharedLlmConfigV1 = { ...shared, presets: [...shared.presets] };
    ensurePreset(next, { label: "新しいプリセット", providerId: firstProvider.id, model: "", temperature: 0.7 });
    updateShared(next);
  }

  function updatePreset(id: string, patch: Partial<ModelPresetV1>) {
    updateShared({
      ...shared,
      presets: shared.presets.map((preset) => (preset.id === id ? { ...preset, ...patch } : preset)),
    });
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

          {/* ----- LLM プロバイダ / プリセット ----- */}
          {activeTab === "llm" ? (
            <section class="settings-section" role="tabpanel" id="settings-panel-llm" aria-labelledby="settings-tab-llm">
              <div class="settings-heading-row">
                <h2 class="settings-heading">
                  <Plug size={16} /> LLM プロバイダ
                </h2>
                <button type="button" class="settings-btn settings-btn-ghost" onClick={addProvider}>
                  <Plus size={15} /> プロバイダを追加
                </button>
              </div>
              <p class="settings-hint">
                接続先(Base URL)とAPIキー。同じオリジン上のtik-choco系アプリ間で共有される設定です。
              </p>

              <div class="settings-card-list">
                {shared.providers.map((provider) => (
                  <div key={provider.id} class="settings-card">
                    <label class="settings-field">
                      <span>名前</span>
                      <input
                        value={provider.label}
                        placeholder="ローカルLLM"
                        onInput={(e) => updateProvider(provider.id, { label: e.currentTarget.value })}
                      />
                    </label>
                    <label class="settings-field">
                      <span>Base URL</span>
                      <input
                        value={provider.baseUrl}
                        placeholder="http://localhost:1234/v1"
                        onInput={(e) => updateProvider(provider.id, { baseUrl: e.currentTarget.value })}
                      />
                    </label>
                    <label class="settings-field">
                      <span>APIキー</span>
                      <input
                        type="password"
                        autocomplete="off"
                        value={provider.apiKey}
                        placeholder="sk-..."
                        onInput={(e) => updateProvider(provider.id, { apiKey: e.currentTarget.value })}
                      />
                    </label>
                  </div>
                ))}
                {shared.providers.length === 0 ? <p class="settings-empty">プロバイダが未設定です。</p> : null}
              </div>

              <div class="settings-heading-row">
                <h2 class="settings-heading">
                  <Cpu size={16} /> モデルプリセット
                </h2>
                <button
                  type="button"
                  class="settings-btn settings-btn-ghost"
                  onClick={addPreset}
                  disabled={shared.providers.length === 0}
                >
                  <Plus size={15} /> プリセットを追加
                </button>
              </div>
              <p class="settings-hint">
                {shared.providers.length === 0 ? "先にプロバイダを追加してください。" : "プロバイダに紐づくモデル設定。"}
              </p>

              <div class="settings-card-list">
                {shared.presets.map((preset) => {
                  const provider = shared.providers.find((p) => p.id === preset.providerId);
                  return (
                    <div key={preset.id} class="settings-card">
                      <div class="settings-card-head">
                        <input
                          class="settings-card-label"
                          value={preset.label}
                          placeholder="プリセット名"
                          onInput={(e) => updatePreset(preset.id, { label: e.currentTarget.value })}
                        />
                        {preset.id === shared.defaultPresetId ? <span class="settings-badge">既定</span> : null}
                      </div>

                      <label class="settings-field">
                        <span>プロバイダ</span>
                        <select
                          value={preset.providerId}
                          onChange={(e) => updatePreset(preset.id, { providerId: e.currentTarget.value })}
                        >
                          {shared.providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label || p.id}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label class="settings-field">
                        <span>モデル</span>
                        <ModelInput
                          listId={`settings-models-${preset.id}`}
                          value={preset.model}
                          baseUrl={provider?.baseUrl ?? ""}
                          apiKey={provider?.apiKey ?? ""}
                          onChange={(model) => updatePreset(preset.id, { model })}
                        />
                      </label>

                      <label class="settings-field">
                        <span>温度 (temperature)</span>
                        <input
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          value={preset.temperature ?? 0.7}
                          onInput={(e) => {
                            const parsed = Number.parseFloat(e.currentTarget.value);
                            updatePreset(preset.id, { temperature: Number.isFinite(parsed) ? parsed : 0.7 });
                          }}
                        />
                      </label>
                    </div>
                  );
                })}
                {shared.presets.length === 0 ? <p class="settings-empty">プリセットが未設定です。</p> : null}
              </div>

              <label class="settings-field">
                <span>既定プリセット</span>
                <select
                  value={shared.defaultPresetId}
                  onChange={(e) => updateShared({ ...shared, defaultPresetId: e.currentTarget.value })}
                >
                  <option value="">未設定</option>
                  {shared.presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label || p.id}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          ) : null}

          {/* ----- 領収書OCR ----- */}
          {activeTab === "ocr" ? (
            <section class="settings-section" role="tabpanel" id="settings-panel-ocr" aria-labelledby="settings-tab-ocr">
              <h2 class="settings-heading">
                <Bot size={16} /> 領収書OCR
              </h2>

              <label class="settings-field">
                <span>領収書OCR用プリセット</span>
                <select
                  value={local.visionPresetId}
                  onChange={(e) => updateLocal({ ...local, visionPresetId: e.currentTarget.value })}
                >
                  <option value="">既定プリセットに従う</option>
                  {shared.presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label || p.id}
                    </option>
                  ))}
                </select>
                <span class="settings-field-hint">
                  領収書の画像読み取りは常に直接HTTP接続で実行されます(AI Networkのワイヤーは画像非対応のため)。
                </span>
              </label>

              <label class="settings-field">
                <span>領収書解析用プリセット</span>
                <select
                  value={local.extractPresetId}
                  onChange={(e) => updateLocal({ ...local, extractPresetId: e.currentTarget.value })}
                >
                  <option value="">領収書OCR用プリセットに従う</option>
                  {shared.presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label || p.id}
                    </option>
                  ))}
                </select>
                <span class="settings-field-hint">
                  読み取った文字起こしをJSONに変換するテキストLLM。未設定の場合は領収書OCR用プリセットと同じ接続先を使います。
                </span>
              </label>
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
              <label class="settings-field">
                <span>ルームID</span>
                <input
                  value={shared.network.roomId}
                  placeholder="tc-llm"
                  onInput={(e) => updateShared({ ...shared, network: { roomId: e.currentTarget.value } })}
                />
                <span class="settings-field-hint">P2Pネットワーク経由でLLM推論を利用する際の合言葉です。</span>
              </label>

              <label class="settings-checkbox-field">
                <input
                  type="checkbox"
                  checked={local.networkConsumerEnabled}
                  onChange={(e) => updateLocal({ ...local, networkConsumerEnabled: e.currentTarget.checked })}
                />
                <span>AI Network(P2P)経由でテキストLLMを利用する</span>
              </label>

              {local.networkConsumerEnabled ? (
                <p class="settings-hint" role="status">
                  {consumerStatusLabel(consumer)}
                </p>
              ) : null}
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
