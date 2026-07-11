// ヘッダーの帳簿切替ドロップダウン。アクティブ帳簿名+開閉インジケータを表示し、
// クリックで全帳簿一覧を開く。選択すると setActiveBook() で即切り替え(変更イベント
// は subscribeBooks 経由で全ビューに伝播する、docs/CONTRACTS.md 参照)。
// 末尾の「新しい帳簿」からインラインの作成フォームを開ける。
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { BookOpenText, Check, ChevronDown, Plus, X } from "lucide-preact";
import type { Book, BookKind } from "../types";
import { createBook, getActiveBookId, loadBooks, setActiveBook, subscribeBooks } from "../lib/store";
import "../styles/bookSwitcher.css";

/** 帳簿種別の表示ラベル。SettingsView の「帳簿」タブとも共有する。 */
export const BOOK_KIND_LABEL: Record<BookKind, string> = {
  household: "家庭用",
  circle: "サークル用",
  business: "会社・事業用",
};

export const BOOK_KIND_ORDER: BookKind[] = ["household", "circle", "business"];

export function BookSwitcher(): JSX.Element {
  const [books, setBooks] = useState<Book[]>(() => loadBooks());
  const [activeId, setActiveId] = useState<string>(() => getActiveBookId());
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<BookKind>("household");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      subscribeBooks(() => {
        setBooks(loadBooks());
        setActiveId(getActiveBookId());
      }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeAll();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAll();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function closeAll() {
    setOpen(false);
    setCreating(false);
  }

  function resetNewBookForm() {
    setNewName("");
    setNewKind("household");
  }

  function selectBook(id: string) {
    if (id !== activeId) setActiveBook(id);
    closeAll();
  }

  function submitNewBook(e: Event) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const book = createBook(trimmed, newKind);
    setActiveBook(book.id);
    resetNewBookForm();
    closeAll();
  }

  const activeBook = books.find((b) => b.id === activeId) ?? books[0];

  return (
    <div class="book-switcher" ref={rootRef}>
      <button
        type="button"
        class="book-switcher-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="帳簿を切り替え"
      >
        <BookOpenText size={15} />
        <span class="book-switcher-label">{activeBook?.name ?? "帳簿"}</span>
        <ChevronDown size={14} class={`book-switcher-chevron${open ? " book-switcher-chevron--open" : ""}`} />
      </button>

      {open ? (
        <div class="book-switcher-menu">
          <ul class="book-switcher-list" role="listbox" aria-label="帳簿一覧">
            {books.map((book) => (
              <li key={book.id}>
                <button
                  type="button"
                  class={`book-switcher-item${book.id === activeId ? " book-switcher-item--active" : ""}`}
                  role="option"
                  aria-selected={book.id === activeId}
                  onClick={() => selectBook(book.id)}
                >
                  <span class="book-switcher-item-name">{book.name}</span>
                  {book.id === activeId ? <Check size={14} /> : null}
                </button>
              </li>
            ))}
          </ul>

          {creating ? (
            <form class="book-switcher-form" onSubmit={submitNewBook}>
              <label class="book-switcher-field">
                <span>帳簿名</span>
                <input
                  value={newName}
                  placeholder="例: 〇〇サークル"
                  onInput={(e) => setNewName(e.currentTarget.value)}
                  autoFocus
                />
              </label>
              <label class="book-switcher-field">
                <span>種別</span>
                <select value={newKind} onChange={(e) => setNewKind(e.currentTarget.value as BookKind)}>
                  {BOOK_KIND_ORDER.map((kind) => (
                    <option key={kind} value={kind}>
                      {BOOK_KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <div class="book-switcher-form-actions">
                <button
                  type="button"
                  class="book-switcher-btn"
                  onClick={() => {
                    setCreating(false);
                    resetNewBookForm();
                  }}
                >
                  <X size={13} /> キャンセル
                </button>
                <button type="submit" class="book-switcher-btn book-switcher-btn--primary" disabled={!newName.trim()}>
                  <Plus size={13} /> 作成
                </button>
              </div>
            </form>
          ) : (
            <button type="button" class="book-switcher-new" onClick={() => setCreating(true)}>
              <Plus size={14} /> 新しい帳簿
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
