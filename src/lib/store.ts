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
//
// Receipt draft images: the on-disk (localStorage) representation of a
// ReceiptDraft never inlines the image data URL — it holds an `imageCid`
// (+`imageMime`) pointing at bytes uploaded via mistClient's storage_add
// (OPFS-backed, same-origin). Inline `imageDataUrl` is only read as a legacy
// dual-read fallback for drafts written before this change; readDraftsRaw()
// migrates any it finds to imageCid on first read (see uploadDraftImage/
// hydrateDraft below). The *in-memory* ReceiptDraft type (types.ts) that
// loadReceiptDrafts()/upsertReceiptDraft() expose to callers always carries a
// resolved imageDataUrl — callers (ReceiptImport.tsx) are unaware of the CID
// indirection.

import type { Account, AccountType, Book, BookKind, BooksBundle, IssuedReceipt, JournalEntry, JournalLine, MultiBookBundle, ReceiptDraft, ReceiptDraftForm } from "../types";
import { bytesToDataUrl, dataUrlToBytes } from "./image";
import { storageAdd, storageGet } from "./mistClient";

// Legacy (pre-multi-book) unsuffixed keys. Still used as the *prefix* for the
// namespaced per-book keys (`${LEGACY_ENTRIES_KEY}:${bookId}`) so
// subscribeBooks' storage-event prefix filter keeps working for both.
const LEGACY_ENTRIES_KEY = "tc-books:journal-v1";
const LEGACY_ACCOUNTS_KEY = "tc-books:accounts-v1";
const LEGACY_DRAFTS_KEY = "tc-books:receipt-drafts-v1";
const BOOKS_KEY = "tc-books:books-v1";
const CHANGE_EVENT = "tc-books-data-changed";

// 領収書発行 (receipt issuance). No legacy unsuffixed data ever existed for
// these, so they are not part of migrateLegacyDataIfPresent.
const ISSUED_RECEIPTS_KEY = "tc-books:issued-receipts-v1";
const RECEIPT_ISSUER_KEY = "tc-books:receipt-issuer-v1";

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
function issuedReceiptsKey(bookId: string): string {
  return `${ISSUED_RECEIPTS_KEY}:${bookId}`;
}
function receiptIssuerKey(bookId: string): string {
  return `${RECEIPT_ISSUER_KEY}:${bookId}`;
}

const MAX_DRAFTS = 10;
const RECEIPT_DRAFT_STAGES = ["preview", "result"];
const RECEIPT_DRAFT_FORM_FIELDS = ["date", "vendor", "amount", "categoryId", "methodId", "memo"] as const;

const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
const ENTRY_SOURCES = ["manual", "quick", "ocr", "receipt"];

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

function sanitizeIssuedReceipt(value: unknown): IssuedReceipt | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  if (!id) return null;
  const issueNo = typeof value.issueNo === "number" && Number.isFinite(value.issueNo) ? Math.trunc(value.issueNo) : 0;
  if (issueNo < 1) return null;
  const amount = typeof value.amount === "number" && Number.isFinite(value.amount) ? Math.trunc(value.amount) : 0;

  const receipt: IssuedReceipt = {
    id,
    issueNo,
    amount,
    payerName: typeof value.payerName === "string" ? value.payerName : "",
    issueDate: typeof value.issueDate === "string" ? value.issueDate : "",
    note: typeof value.note === "string" ? value.note : "",
    issuerName: typeof value.issuerName === "string" ? value.issuerName : "",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
  };
  if (typeof value.journalEntryId === "string" && value.journalEntryId) receipt.journalEntryId = value.journalEntryId;
  return receipt;
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

/**
 * localStorage 上の永続化形式。imageDataUrl は旧形式 (画像インライン) との
 * dual-read 用にのみ残る optional フィールド — 新規保存は必ず imageCid
 * (+imageMime) を使う。呼び出し側 (ReceiptImport.tsx) が扱う ReceiptDraft
 * (types.ts) とは別物: そちらは常に解決済みの imageDataUrl を持つ。
 */
interface StoredReceiptDraft {
  id: string;
  stage: ReceiptDraft["stage"];
  imageName: string;
  imageDataUrl?: string;
  imageCid?: string;
  imageMime?: string;
  form: ReceiptDraftForm | null;
  createdAt: string;
  updatedAt: string;
}

function sanitizeReceiptDraft(value: unknown): StoredReceiptDraft | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  if (!id) return null;
  const imageDataUrl = typeof value.imageDataUrl === "string" && value.imageDataUrl ? value.imageDataUrl : "";
  const imageCid = typeof value.imageCid === "string" && value.imageCid ? value.imageCid : "";
  if (!imageDataUrl && !imageCid) return null;
  const stage = typeof value.stage === "string" && RECEIPT_DRAFT_STAGES.includes(value.stage) ? (value.stage as ReceiptDraft["stage"]) : "preview";
  const form = sanitizeReceiptDraftForm(value.form);
  const now = new Date().toISOString();

  const draft: StoredReceiptDraft = {
    id,
    stage: stage === "result" && form === null ? "preview" : stage,
    imageName: typeof value.imageName === "string" ? value.imageName : "",
    form,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
  };
  if (imageDataUrl) draft.imageDataUrl = imageDataUrl;
  if (imageCid) draft.imageCid = imageCid;
  if (typeof value.imageMime === "string" && value.imageMime) draft.imageMime = value.imageMime;
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

function readIssuedReceiptsRaw(bookId: string): IssuedReceipt[] {
  try {
    const raw = localStorage.getItem(issuedReceiptsKey(bookId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.receipts)) return [];
    return parsed.receipts.map(sanitizeIssuedReceipt).filter((r): r is IssuedReceipt => r !== null);
  } catch {
    return [];
  }
}

function readReceiptIssuerNameRaw(bookId: string): string {
  try {
    const raw = localStorage.getItem(receiptIssuerKey(bookId));
    if (!raw) return "";
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.name !== "string") return "";
    return parsed.name;
  } catch {
    return "";
  }
}

function readDraftsRawSync(bookId: string): StoredReceiptDraft[] {
  try {
    const raw = localStorage.getItem(draftsKey(bookId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.drafts)) return [];
    return parsed.drafts.map(sanitizeReceiptDraft).filter((d): d is StoredReceiptDraft => d !== null);
  } catch {
    return [];
  }
}

// Memoizes in-flight/completed storage_add uploads by data URL content so
// that re-persisting a draft whose image hasn't changed (e.g. every debounced
// form-field save) doesn't re-upload the same bytes each time. Content is
// content-addressed anyway (same bytes -> same CID) so this is purely a perf
// optimization, never a correctness concern; it's an in-memory cache only
// (nothing persisted), so it can't grow across page loads.
const draftImageUploadCache = new Map<string, Promise<{ cid: string; mime: string }>>();

function uploadDraftImage(dataUrl: string): Promise<{ cid: string; mime: string }> {
  let pending = draftImageUploadCache.get(dataUrl);
  if (!pending) {
    pending = (async () => {
      const { bytes, mime } = dataUrlToBytes(dataUrl);
      const cid = await storageAdd(bytes);
      return { cid, mime };
    })();
    draftImageUploadCache.set(dataUrl, pending);
  }
  return pending;
}

/**
 * One-time migration: any stored draft still holding an inline imageDataUrl
 * (pre-CID format) gets its image uploaded via storage_add and rewritten to
 * imageCid/imageMime. Never throws; a draft whose upload fails is left in its
 * original (still fully readable via dual-read) inline form so no data is
 * lost. Returns the migrated array and persists it if anything changed.
 */
async function readDraftsRaw(bookId: string): Promise<StoredReceiptDraft[]> {
  const drafts = readDraftsRawSync(bookId);
  let migrated = false;
  const next = await Promise.all(
    drafts.map(async (draft) => {
      if (!draft.imageDataUrl || draft.imageCid) return draft;
      try {
        const { cid, mime } = await uploadDraftImage(draft.imageDataUrl);
        migrated = true;
        const rest: StoredReceiptDraft = { ...draft, imageCid: cid, imageMime: mime };
        delete rest.imageDataUrl;
        return rest;
      } catch (error) {
        console.warn(`tc-books: failed to migrate receipt draft image ${draft.id}`, error);
        return draft;
      }
    }),
  );
  if (migrated) persistDrafts(bookId, next);
  return next;
}

/** ReceiptDraft (呼び出し側向け・imageDataUrl解決済み) への変換。取得に失敗した場合はnull */
async function hydrateDraft(stored: StoredReceiptDraft): Promise<ReceiptDraft | null> {
  let imageDataUrl = stored.imageDataUrl ?? "";
  if (!imageDataUrl && stored.imageCid) {
    try {
      const bytes = await storageGet(stored.imageCid);
      imageDataUrl = bytesToDataUrl(bytes, stored.imageMime || "image/jpeg");
    } catch (error) {
      console.warn(`tc-books: failed to load receipt draft image ${stored.id}`, error);
      return null;
    }
  }
  if (!imageDataUrl) return null;
  return {
    id: stored.id,
    stage: stored.stage,
    imageName: stored.imageName,
    imageDataUrl,
    form: stored.form,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
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

function persistDrafts(bookId: string, drafts: StoredReceiptDraft[]): void {
  try {
    localStorage.setItem(draftsKey(bookId), JSON.stringify({ v: 1, drafts }));
    notifyChanged();
  } catch (error) {
    console.warn("tc-books: failed to persist receipt drafts", error);
  }
}

function persistIssuedReceipts(bookId: string, receipts: IssuedReceipt[]): void {
  try {
    localStorage.setItem(issuedReceiptsKey(bookId), JSON.stringify({ v: 1, receipts }));
    notifyChanged();
  } catch (error) {
    console.warn("tc-books: failed to persist issued receipts", error);
  }
}

function persistReceiptIssuerName(bookId: string, name: string): void {
  try {
    localStorage.setItem(receiptIssuerKey(bookId), JSON.stringify({ v: 1, name }));
    notifyChanged();
  } catch (error) {
    console.warn("tc-books: failed to persist receipt issuer name", error);
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

function sortDraftsByUpdatedAtDesc<T extends { updatedAt: string }>(drafts: T[]): T[] {
  return [...drafts].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** updatedAt降順。各下書きの画像は(旧形式ならインラインをそのまま、新形式ならstorage_getで)解決済み */
export async function loadReceiptDrafts(): Promise<ReceiptDraft[]> {
  const stored = sortDraftsByUpdatedAtDesc(await readDraftsRaw(getActiveBookId()));
  const hydrated = await Promise.all(stored.map(hydrateDraft));
  return hydrated.filter((d): d is ReceiptDraft => d !== null);
}

/**
 * 画像は毎回 storage_add でCID化してから imageCid(+imageMime) のみ永続化する
 * (imageDataUrlをlocalStorageにインラインで書くことはしない)。アップロードに
 * 失敗した場合は既存の下書きに触れず何もしない (console.warnのみ、データ喪失なし)。
 */
export async function upsertReceiptDraft(draft: ReceiptDraft): Promise<void> {
  const bookId = getActiveBookId();
  let uploaded: { cid: string; mime: string };
  try {
    uploaded = await uploadDraftImage(draft.imageDataUrl);
  } catch (error) {
    console.warn(`tc-books: failed to upload receipt draft image ${draft.id}`, error);
    return;
  }

  const existing = await readDraftsRaw(bookId);
  const stored: StoredReceiptDraft = {
    id: draft.id,
    stage: draft.stage,
    imageName: draft.imageName,
    imageCid: uploaded.cid,
    imageMime: uploaded.mime,
    form: draft.form,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
  const idx = existing.findIndex((d) => d.id === draft.id);
  if (idx >= 0) {
    existing[idx] = stored;
  } else {
    existing.push(stored);
  }
  const capped = sortDraftsByUpdatedAtDesc(existing).slice(0, MAX_DRAFTS);
  persistDrafts(bookId, capped);
}

export async function deleteReceiptDraft(id: string): Promise<void> {
  const bookId = getActiveBookId();
  const existing = await readDraftsRaw(bookId);
  persistDrafts(bookId, existing.filter((d) => d.id !== id));
}

function sortIssuedReceiptsByIssueNoDesc(receipts: IssuedReceipt[]): IssuedReceipt[] {
  return [...receipts].sort((a, b) => b.issueNo - a.issueNo);
}

/** アクティブ帳簿、issueNo降順 */
export function loadIssuedReceipts(): IssuedReceipt[] {
  return sortIssuedReceiptsByIssueNoDesc(readIssuedReceiptsRaw(getActiveBookId()));
}

/** id一致で置換、なければ追加 */
export function upsertIssuedReceipt(receipt: IssuedReceipt): void {
  const bookId = getActiveBookId();
  const existing = readIssuedReceiptsRaw(bookId);
  const idx = existing.findIndex((r) => r.id === receipt.id);
  if (idx >= 0) {
    existing[idx] = receipt;
  } else {
    existing.push(receipt);
  }
  persistIssuedReceipts(bookId, existing);
}

/** 紐づく仕訳は消さない (呼び出し側の責務でもない) */
export function deleteIssuedReceipt(id: string): void {
  const bookId = getActiveBookId();
  const existing = readIssuedReceiptsRaw(bookId);
  persistIssuedReceipts(bookId, existing.filter((r) => r.id !== id));
}

/** max(issueNo)+1、1件もなければ1 */
export function nextReceiptIssueNo(): number {
  const existing = readIssuedReceiptsRaw(getActiveBookId());
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((r) => r.issueNo)) + 1;
}

/** 保存が無ければ "" */
export function loadReceiptIssuerName(): string {
  return readReceiptIssuerNameRaw(getActiveBookId());
}

export function saveReceiptIssuerName(name: string): void {
  persistReceiptIssuerName(getActiveBookId(), name);
}

/** entries/accounts/drafts/レジストリのいずれかの変化でも発火。unsubscribeを返す */
export function subscribeBooks(cb: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (
      event.key === null ||
      event.key === BOOKS_KEY ||
      event.key.startsWith(LEGACY_ENTRIES_KEY) ||
      event.key.startsWith(LEGACY_ACCOUNTS_KEY) ||
      event.key.startsWith(LEGACY_DRAFTS_KEY) ||
      event.key.startsWith(ISSUED_RECEIPTS_KEY) ||
      event.key.startsWith(RECEIPT_ISSUER_KEY)
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
    localStorage.removeItem(issuedReceiptsKey(id));
    localStorage.removeItem(receiptIssuerKey(id));
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
