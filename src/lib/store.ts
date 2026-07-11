// localStorage persistence + change notification for journal entries and
// custom accounts. Defensive parsing throughout: malformed/foreign data in
// localStorage must never throw, it just falls back to an empty collection
// (same style as tc-news's src/lib/articleStore.ts).

import type { Account, AccountType, BooksBundle, JournalEntry, JournalLine, ReceiptDraft, ReceiptDraftForm } from "../types";

const ENTRIES_KEY = "tc-books:journal-v1";
const ACCOUNTS_KEY = "tc-books:accounts-v1";
const DRAFTS_KEY = "tc-books:receipt-drafts-v1";
const CHANGE_EVENT = "tc-books-data-changed";

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

function readEntriesRaw(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(ENTRIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.map(sanitizeEntry).filter((e): e is JournalEntry => e !== null);
  } catch {
    return [];
  }
}

function readAccountsRaw(): Account[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.accounts)) return [];
    return parsed.accounts.map(sanitizeAccount).filter((a): a is Account => a !== null);
  } catch {
    return [];
  }
}

function readDraftsRaw(): ReceiptDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
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

function persistEntries(entries: JournalEntry[]): void {
  try {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify({ v: 1, entries }));
    notifyChanged();
  } catch (error) {
    console.warn("tc-books: failed to persist journal entries", error);
  }
}

function persistAccounts(accounts: Account[]): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify({ v: 1, accounts }));
    notifyChanged();
  } catch (error) {
    console.warn("tc-books: failed to persist custom accounts", error);
  }
}

function persistDrafts(drafts: ReceiptDraft[]): void {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ v: 1, drafts }));
    notifyChanged();
  } catch (error) {
    console.warn("tc-books: failed to persist receipt drafts", error);
  }
}

function sortEntries(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

/** 日付降順・同日はcreatedAt降順 */
export function loadEntries(): JournalEntry[] {
  return sortEntries(readEntriesRaw());
}

export function upsertEntry(entry: JournalEntry): void {
  const existing = readEntriesRaw();
  const idx = existing.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }
  persistEntries(existing);
}

export function deleteEntry(id: string): void {
  const existing = readEntriesRaw();
  persistEntries(existing.filter((e) => e.id !== id));
}

export function loadCustomAccounts(): Account[] {
  return readAccountsRaw();
}

export function upsertCustomAccount(account: Account): void {
  const existing = readAccountsRaw();
  const idx = existing.findIndex((a) => a.id === account.id);
  if (idx >= 0) {
    existing[idx] = account;
  } else {
    existing.push(account);
  }
  persistAccounts(existing);
}

export function deleteCustomAccount(id: string): void {
  const existing = readAccountsRaw();
  persistAccounts(existing.filter((a) => a.id !== id));
}

function sortDraftsByUpdatedAtDesc(drafts: ReceiptDraft[]): ReceiptDraft[] {
  return [...drafts].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** updatedAt降順 */
export function loadReceiptDrafts(): ReceiptDraft[] {
  return sortDraftsByUpdatedAtDesc(readDraftsRaw());
}

export function upsertReceiptDraft(draft: ReceiptDraft): void {
  const existing = readDraftsRaw();
  const idx = existing.findIndex((d) => d.id === draft.id);
  if (idx >= 0) {
    existing[idx] = draft;
  } else {
    existing.push(draft);
  }
  const capped = sortDraftsByUpdatedAtDesc(existing).slice(0, MAX_DRAFTS);
  persistDrafts(capped);
}

export function deleteReceiptDraft(id: string): void {
  const existing = readDraftsRaw();
  persistDrafts(existing.filter((d) => d.id !== id));
}

/** entries/accountsどちらの変化でも発火。unsubscribeを返す */
export function subscribeBooks(cb: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key && event.key !== ENTRIES_KEY && event.key !== ACCOUNTS_KEY && event.key !== DRAFTS_KEY) return;
    cb();
  }
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** バックアップ用スナップショット */
export function loadBooksBundle(): BooksBundle {
  return {
    v: 1,
    entries: loadEntries(),
    customAccounts: loadCustomAccounts(),
    exportedAt: new Date().toISOString(),
  };
}
