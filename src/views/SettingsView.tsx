import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  BookOpenText,
  Check,
  Cloud,
  Pencil,
  Plug,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  X,
} from "lucide-preact";
import { requestOnboarding } from "../lib/onboarding";
import { paneEnterClass, useEnterDirection } from "../hooks/useEnterDirection";
import { BooksAiSettings } from "../components/BooksAiSettings";
import { aiMessages } from "../lib/llmMessages";
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

function formatBookDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ja-JP");
}

// ----- Settings tabs -------------------------------------------------------
// Tab selection is remembered across visits (localStorage, parsed defensively
// — same pattern as llmSettings.ts).

type SettingsTabId = "books" | "ai" | "backup" | "onboarding";

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string; icon: typeof Plug }> = [
  { id: "books", label: "帳簿", icon: BookOpenText },
  { id: "ai", label: aiMessages().aiSettings, icon: Plug },
  { id: "backup", label: "バックアップ", icon: Cloud },
  { id: "onboarding", label: "はじめに", icon: Sparkles },
];

const SETTINGS_TAB_ORDER: SettingsTabId[] = SETTINGS_TABS.map((tab) => tab.id);

const SETTINGS_TAB_STORAGE_KEY = "tc-books:settings-tab";

function loadSettingsTab(): SettingsTabId {
  try {
    const raw = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
    if (raw && SETTINGS_TABS.some((tab) => tab.id === raw)) return raw as SettingsTabId;
    if (["llm", "ocr", "connection", "network", "tasks"].includes(raw ?? "")) return "ai";
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back to default.
  }
  return "ai";
}

function saveSettingsTab(tab: SettingsTabId): void {
  try {
    localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab);
  } catch {
    // Non-fatal — the tab just won't be remembered next visit.
  }
}

export function SettingsView(): JSX.Element {
  const [aiLabel, setAiLabel] = useState(() => aiMessages().aiSettings);
  useEffect(() => {
    const update = () => setAiLabel(aiMessages().aiSettings);
    window.addEventListener("tc-books:ai-locale-change", update);
    return () => window.removeEventListener("tc-books:ai-locale-change", update);
  }, []);
  const [activeTab, setActiveTabState] = useState<SettingsTabId>(() => loadSettingsTab());
  function setActiveTab(tab: SettingsTabId): void {
    setActiveTabState(tab);
    saveSettingsTab(tab);
  }
  const enterDir = useEnterDirection(SETTINGS_TAB_ORDER, activeTab);

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
                <Icon size={15} /> {tab.id === "ai" ? aiLabel : tab.label}
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

          {activeTab === "ai" ? (
            <div role="tabpanel" id="settings-panel-ai" aria-labelledby="settings-tab-ai">
              <BooksAiSettings />
            </div>
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
