// localStorage persistence + change notification for journal entries and
// custom accounts. Defensive parsing throughout: malformed/foreign data in
// localStorage must never throw, it just falls back to an empty collection
// (same style as tc-news's src/lib/articleStore.ts).
//
// Multi-book: every domain key (journal/accounts/receipt-drafts) is
// namespaced per book id (`<legacy-key>:<bookId>`). A small registry key
// (BOOKS_KEY) tracks the list of books plus which one is active; all public
// read/write functions below resolve to the *active* book's namespaced keys
// so existing callers (views) keep working unmodified. See ensureRegistry()
// for the legacy (pre-multi-book) migration.

import type { Account, AccountType, Book, BookKind, BooksBundle, JournalEntry, JournalLine, MultiBookBundle, ReceiptDraft, ReceiptDraftForm } from "../types";

// Legacy (pre-multi-book) unsuffixed keys. Still used as the *prefix* for the
// namespaced per-book keys (`${LEGACY_ENTRIES_KEY}:${bookId}`) so
// subscribeBooks' storage-event prefix filter keeps working for both.
const LEGACY_ENTRIES_KEY = "tc-books:journal-v1";
const LEGACY_ACCOUNTS_KEY = "tc-books:accounts-v1";
const LEGACY_DRAFTS_KEY = "tc-books:receipt-drafts-v1";
const BOOKS_KEY = "tc-books:books-v1";
const CHANGE_EVENT = "tc-books-data-changed";

const DEFAULT_BOOK_ID = "default";
const BOOK_KINDS: BookKind[] = ["household", "circle", "business"];

function entriesKey(bookId: string): string {
  return `${LEGACY_ENTRIES_KEY}:${bookId}`;
}
function accountsKey(bookId: string): string {
  return `${LEGACY_ACCOUNTS_KEY}:${bookId}`;
}
function draftsKey(bookId: string): string {
  return `${LEGACY_DRAFTS_KEY}:${bookId}`;
}

const MAX_DRAFTS = 10;
const RECEIPT_DRAFT_STAGES = ["preview", "result"];
const RECEIPT_DRAFT_FORM_FIELDS = ["date", "vendor", "amount", "categoryId", "methodId", "memo"] as const;

const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
const ENTRY_SOURCES = ["manual", "quick", "ocr"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeJournalLine(value: unknown): JournalLine | null {
  if (!isRecord(value)) return null;
  const accountId = typeof value.accountId === "string" ? value.accountId : "";
  if (!accountId) return null;
  const debit = typeof value.debit === "number" && Number.isFinite(value.debit) ? Math.trunc(value.debit) : 0;
  const credit = typeof value.credit === "number" && Number.isFinite(value.credit) ? Math.trunc(value.credit) : 0;
  return { accountId, debit: Math.max(0, debit), credit: Math.max(0, credit) };
}

function sanitizeEntry(value: unknown): JournalEntry | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  if (!id) return null;
  const date = typeof value.date === "string" ? value.date : "";
  const lines = Array.isArray(value.lines)
    ? value.lines.map(sanitizeJournalLine).filter((l): l is JournalLine => l !== null)
    : [];
  const source = typeof value.source === "string" && ENTRY_SOURCES.includes(value.source) ? (value.source as JournalEntry["source"]) : "manual";
  const now = new Date().toISOString();

  const entry: JournalEntry = {
    id,
    date,
    description: typeof value.description === "string" ? value.description : "",
    lines,
    source,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
  };
  if (typeof value.memo === "string") entry.memo = value.memo;
  return entry;
}

function sanitizeAccount(value: unknown): Account | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  if (!id) return null;
  const type = typeof value.type === "string" && (ACCOUNT_TYPES as string[]).includes(value.type) ? (value.type as AccountType) : null;
  if (!type) return null;

  const account: Account = {
    id,
    code: typeof value.code === "string" ? value.code : "",
    name: typeof value.name === "string" ? value.name : "",
    type,
  };
  if (typeof value.quickCategory === "boolean") account.quickCategory = value.quickCategory;
  if (typeof value.paymentMethod === "boolean") account.paymentMethod = value.paymentMethod;
  if (typeof value.isCustom === "boolean") account.isCustom = value.isCustom;
  if (typeof value.archived === "boolean") account.archived = value.archived;
  return account;
}

function sanitizeBook(value: unknown): Book | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  if (!id) return null;
  const kind = typeof value.kind === "string" && (BOOK_KINDS as string[]).includes(value.kind) ? (value.kind as BookKind) : "household";
  return {
    id,
    name: typeof value.name === "string" ? value.name : "",
    kind,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
  };
}

function defaultBook(): Book {
  return { id: DEFAULT_BOOK_ID, name: "家計", kind: "household", createdAt: new Date().toISOString() };
}

function sanitizeReceiptDraftForm(value: unknown): ReceiptDraftForm | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const form = {} as ReceiptDraftForm;
  for (const field of RECEIPT_DRAFT_FORM_FIELDS) {
    form[field] = typeof value[field] === "string" ? value[field] : "";
  }
  return form;
}

function sanitizeReceiptDraft(value: unknown): ReceiptDraft | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  if (!id) return null;
  const imageDataUrl = typeof value.imageDataUrl === "string" ? value.imageDataUrl : "";
  if (!imageDataUrl) return null;
  const stage = typeof value.stage === "string" && RECEIPT_DRAFT_STAGES.includes(value.stage) ? (value.stage as ReceiptDraft["stage"]) : "preview";
  const form = sanitizeReceiptDraftForm(value.form);
  const now = new Date().toISOString();

  const draft: ReceiptDraft = {
    id,
    stage: stage === "result" && form === null ? "preview" : stage,
    imageName: typeof value.imageName === "string" ? value.imageName : "",
    imageDataUrl,
    form,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
  };
  return draft;
}

function readEntriesRaw(bookId: string): JournalEntry[] {
  try {
    const raw = localStorage.getItem(entriesKey(bookId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.map(sanitizeEntry).filter((e): e is JournalEntry => e !== null);
  } catch {
    return [];
  }
}

function readAccountsRaw(bookId: string): Account[] {
  try {
    const raw = localStorage.getItem(accountsKey(bookId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.accounts)) return [];
    return parsed.accounts.map(sanitizeAccount).filter((a): a is Account => a !== null);
  } catch {
    return [];
  }
}

function readDraftsRaw(bookId: string): ReceiptDraft[] {
  try {
    const raw = localStorage.getItem(draftsKey(bookId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.drafts)) return [];
    return parsed.drafts.map(sanitizeReceiptDraft).filter((d): d is ReceiptDraft => d !== null);
  } catch {
    return [];
  }
}

function notifyChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // window unavailable (non-browser test context without dispatch support)
  }
}

function persistEntries(bookId: string, entries: JournalEntry[]): void {
  try {
    localStorage.setItem(entriesKey(bookId), JSON.stringify({ v: 1, entries }));
    notifyChanged();
  } catch (error) {
    console.warn("tc-books: failed to persist journal entries", error);
  }
}

function persistAccounts(bookId: string, accounts: Account[]): void {
  try {
    localStorage.setItem(accountsKey(bookId), JSON.stringify({ v: 1, accounts }));
    notifyChanged();
  } catch (error) {
    console.warn("tc-books: failed to persist custom accounts", error);
  }
}

function persistDrafts(bookId: string, drafts: ReceiptDraft[]): void {
  try {
    localStorage.setItem(draftsKey(bookId), JSON.stringify({ v: 1, drafts }));
    notifyChanged();
  } catch (error) {
    console.warn("tc-books: failed to persist receipt drafts", error);
  }
}

// --- Books registry ----------------------------------------------------
// Tracks the list of books plus which one is active. Lazily created on
// first access (ensureRegistry) with a one-time migration of legacy
// (pre-multi-book) unsuffixed keys into a "default" book's namespaced keys.

interface BooksRegistry {
  v: 1;
  books: Book[];
  activeBookId: string;
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistRegistry(registry: BooksRegistry): void {
  try {
    localStorage.setItem(BOOKS_KEY, JSON.stringify(registry));
  } catch (error) {
    console.warn("tc-books: failed to persist books registry", error);
  }
}

/**
 * One-shot migration: if legacy unsuffixed data keys exist, copy their raw
 * (unparsed) value verbatim to the given book's namespaced key, then remove
 * the legacy key. Idempotent (no-op once the legacy key is gone) and never
 * throws.
 */
function migrateLegacyDataIfPresent(bookId: string): void {
  const migrations: Array<[string, string]> = [
    [LEGACY_ENTRIES_KEY, entriesKey(bookId)],
    [LEGACY_ACCOUNTS_KEY, accountsKey(bookId)],
    [LEGACY_DRAFTS_KEY, draftsKey(bookId)],
  ];
  for (const [legacyKey, namespacedKey] of migrations) {
    try {
      const raw = localStorage.getItem(legacyKey);
      if (raw === null) continue;
      localStorage.setItem(namespacedKey, raw);
      localStorage.removeItem(legacyKey);
    } catch (error) {
      console.warn(`tc-books: failed to migrate legacy key ${legacyKey}`, error);
    }
  }
}

function createDefaultRegistry(): BooksRegistry {
  const registry: BooksRegistry = { v: 1, books: [defaultBook()], activeBookId: DEFAULT_BOOK_ID };
  migrateLegacyDataIfPresent(DEFAULT_BOOK_ID);
  persistRegistry(registry);
  return registry;
}

/**
 * Lazily creates the books registry (migrating legacy data into a "default"
 * book) if it doesn't exist yet or is malformed, and sanitizes it otherwise
 * (empty books -> default book; dangling activeBookId -> first book).
 * Idempotent, never throws. Called at the top of every public read/write
 * function below (directly, or transitively via getActiveBookId()).
 */
function ensureRegistry(): BooksRegistry {
  const raw = safeGetItem(BOOKS_KEY);
  if (!raw) return createDefaultRegistry();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createDefaultRegistry();
  }
  if (!isRecord(parsed)) return createDefaultRegistry();

  const rawBooksLen = Array.isArray(parsed.books) ? parsed.books.length : -1;
  const sanitizedBooks = Array.isArray(parsed.books)
    ? parsed.books.map(sanitizeBook).filter((b): b is Book => b !== null)
    : [];
  const books = sanitizedBooks.length > 0 ? sanitizedBooks : [defaultBook()];
  const activeBookId =
    typeof parsed.activeBookId === "string" && books.some((b) => b.id === parsed.activeBookId)
      ? parsed.activeBookId
      : books[0].id;

  const sanitized: BooksRegistry = { v: 1, books, activeBookId };
  const changed = sanitizedBooks.length !== rawBooksLen || activeBookId !== parsed.activeBookId;
  if (changed) persistRegistry(sanitized);
  return sanitized;
}

function sortEntries(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

/** 日付降順・同日はcreatedAt降順 */
export function loadEntries(): JournalEntry[] {
  return sortEntries(readEntriesRaw(getActiveBookId()));
}

export function upsertEntry(entry: JournalEntry): void {
  const bookId = getActiveBookId();
  const existing = readEntriesRaw(bookId);
  const idx = existing.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }
  persistEntries(bookId, existing);
}

export function deleteEntry(id: string): void {
  const bookId = getActiveBookId();
  const existing = readEntriesRaw(bookId);
  persistEntries(bookId, existing.filter((e) => e.id !== id));
}

export function loadCustomAccounts(): Account[] {
  return readAccountsRaw(getActiveBookId());
}

export function upsertCustomAccount(account: Account): void {
  const bookId = getActiveBookId();
  const existing = readAccountsRaw(bookId);
  const idx = existing.findIndex((a) => a.id === account.id);
  if (idx >= 0) {
    existing[idx] = account;
  } else {
    existing.push(account);
  }
  persistAccounts(bookId, existing);
}

export function deleteCustomAccount(id: string): void {
  const bookId = getActiveBookId();
  const existing = readAccountsRaw(bookId);
  persistAccounts(bookId, existing.filter((a) => a.id !== id));
}

function sortDraftsByUpdatedAtDesc(drafts: ReceiptDraft[]): ReceiptDraft[] {
  return [...drafts].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** updatedAt降順 */
export function loadReceiptDrafts(): ReceiptDraft[] {
  return sortDraftsByUpdatedAtDesc(readDraftsRaw(getActiveBookId()));
}

export function upsertReceiptDraft(draft: ReceiptDraft): void {
  const bookId = getActiveBookId();
  const existing = readDraftsRaw(bookId);
  const idx = existing.findIndex((d) => d.id === draft.id);
  if (idx >= 0) {
    existing[idx] = draft;
  } else {
    existing.push(draft);
  }
  const capped = sortDraftsByUpdatedAtDesc(existing).slice(0, MAX_DRAFTS);
  persistDrafts(bookId, capped);
}

export function deleteReceiptDraft(id: string): void {
  const bookId = getActiveBookId();
  const existing = readDraftsRaw(bookId);
  persistDrafts(bookId, existing.filter((d) => d.id !== id));
}

/** entries/accounts/drafts/レジストリのいずれかの変化でも発火。unsubscribeを返す */
export function subscribeBooks(cb: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (
      event.key === null ||
      event.key === BOOKS_KEY ||
      event.key.startsWith(LEGACY_ENTRIES_KEY) ||
      event.key.startsWith(LEGACY_ACCOUNTS_KEY) ||
      event.key.startsWith(LEGACY_DRAFTS_KEY)
    ) {
      cb();
    }
  }
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** バックアップ用スナップショット (アクティブ帳簿のみ) */
export function loadBooksBundle(): BooksBundle {
  return {
    v: 1,
    entries: loadEntries(),
    customAccounts: loadCustomAccounts(),
    exportedAt: new Date().toISOString(),
  };
}

// --- Multi-book public API ----------------------------------------------

/** レジストリ順の全帳簿一覧 */
export function loadBooks(): Book[] {
  return ensureRegistry().books;
}

export function getActiveBookId(): string {
  return ensureRegistry().activeBookId;
}

export function getActiveBook(): Book {
  const registry = ensureRegistry();
  return registry.books.find((b) => b.id === registry.activeBookId) ?? registry.books[0];
}

/** 未知IDはno-op。変更時はレジストリ保存+変更イベント発火 */
export function setActiveBook(id: string): void {
  const registry = ensureRegistry();
  if (!registry.books.some((b) => b.id === id)) return;
  if (registry.activeBookId === id) return;
  persistRegistry({ ...registry, activeBookId: id });
  notifyChanged();
}

/** 新規帳簿を作成してレジストリに追加する。アクティブ化はしない (呼び出し側の責務) */
export function createBook(name: string, kind: BookKind): Book {
  const registry = ensureRegistry();
  const book: Book = {
    id: crypto.randomUUID(),
    name,
    kind,
    createdAt: new Date().toISOString(),
  };
  persistRegistry({ ...registry, books: [...registry.books, book] });
  notifyChanged();
  return book;
}

export function renameBook(id: string, name: string): void {
  const registry = ensureRegistry();
  const idx = registry.books.findIndex((b) => b.id === id);
  if (idx < 0) return;
  const books = [...registry.books];
  books[idx] = { ...books[idx], name };
  persistRegistry({ ...registry, books });
  notifyChanged();
}

/** 未知IDまたは未知kindはno-op */
export function updateBookKind(id: string, kind: BookKind): void {
  const registry = ensureRegistry();
  if (!(BOOK_KINDS as string[]).includes(kind)) return;
  const idx = registry.books.findIndex((b) => b.id === id);
  if (idx < 0) return;
  const books = [...registry.books];
  books[idx] = { ...books[idx], kind };
  persistRegistry({ ...registry, books });
  notifyChanged();
}

/**
 * 帳簿を削除する。最後の1冊は削除拒否 (no-op + console.warn)。
 * アクティブ帳簿を削除した場合は残りの先頭をアクティブにする。
 */
export function deleteBook(id: string): void {
  const registry = ensureRegistry();
  if (registry.books.length <= 1) {
    console.warn("tc-books: refusing to delete the last remaining book");
    return;
  }
  const books = registry.books.filter((b) => b.id !== id);
  if (books.length === registry.books.length) return; // unknown id: no-op

  const activeBookId = registry.activeBookId === id ? books[0].id : registry.activeBookId;
  persistRegistry({ v: 1, books, activeBookId });

  try {
    localStorage.removeItem(entriesKey(id));
    localStorage.removeItem(accountsKey(id));
    localStorage.removeItem(draftsKey(id));
  } catch (error) {
    console.warn("tc-books: failed to remove deleted book's data", error);
  }
  notifyChanged();
}

/** バックアップ用スナップショット (全帳簿分)。各帳簿のentriesはloadEntriesと同じソート順 */
export function loadMultiBookBundle(): MultiBookBundle {
  const { books } = ensureRegistry();
  return {
    v: 2,
    books: books.map((book) => ({
      book,
      entries: sortEntries(readEntriesRaw(book.id)),
      customAccounts: readAccountsRaw(book.id),
    })),
    exportedAt: new Date().toISOString(),
  };
}
