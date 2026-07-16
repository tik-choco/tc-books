// TC Books — AI journal-entry suggestion from free-form Japanese text (worker: suggest)
//
// Given a free-form sentence like "昨日セブンでコーヒー300円 現金" plus the
// caller's candidate accounts, asks the LLM (via llm.ts's requestChatCompletion,
// presetId always undefined so the shared config's defaultPresetId decides) to
// guess a description/date/amount/debit account/credit account. Defensive JSON
// parsing mirrors ocr.ts's style (stripCodeFences / extractJsonBlock /
// toIntegerOrNull) — duplicated here rather than imported since ocr.ts is
// owned by a different worker and this module must not depend on it.
//
// parseEntrySuggestion never throws: a missing/malformed JSON block, an
// account id outside the caller-supplied candidate set, a non-positive or
// non-integer amount, or a malformed date all fall back to null for that
// field. suggestEntry retries once (feeding the failed reply back as
// context, same pattern as ocr.ts's Stage 2) on an unparseable first reply;
// a second failure returns the all-null EntrySuggestion rather than
// throwing. Only requestChatCompletion's own errors (missing LLM config,
// connection failure, empty response) propagate as thrown Errors.

import { requestChatCompletion } from "./llm";
import type { AccountType } from "../types";

export interface SuggestAccountOption {
  id: string;
  name: string;
  type: AccountType;
}

export interface EntrySuggestionInput {
  /** ユーザーの自由文 (例 "昨日セブンでコーヒー300円 現金") */
  text: string;
  /** 基準日 YYYY-MM-DD ("昨日"等の相対日付の解決に使う) */
  today: string;
  /** 選択可能な勘定科目 (呼び出し側がactiveAccounts()等からmapして渡す) */
  accounts: SuggestAccountOption[];
}

export interface EntrySuggestion {
  /** 摘要 (簡潔な日本語。店名・品目を含める) */
  description: string | null;
  /** YYYY-MM-DD (テキストから読み取れなければnull) */
  date: string | null;
  /** 整数円 */
  amount: number | null;
  /** accounts内のidのみ有効、それ以外はnullに落とす */
  debitAccountId: string | null;
  /** 同上 */
  creditAccountId: string | null;
  /** LLM生テキスト (デバッグ/再パース用) */
  raw: string;
}

const RETRY_MESSAGE =
  "その返答は有効なJSONではありませんでした。説明やコードフェンスを一切付けず、スキーマに完全に一致するJSONオブジェクトだけを返してください。";

function stripCodeFences(text: string): string {
  return text.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "");
}

function extractJsonBlock(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

/** Strips fences, locates the outermost `{...}` block, and JSON.parses it. Returns null (never throws) if either step fails or the result isn't a plain object. */
function extractJsonRecord(raw: string): Record<string, unknown> | null {
  const withoutFences = stripCodeFences(raw);
  const block = extractJsonBlock(withoutFences);
  if (!block) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function toIntegerOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Math.round(Number(value));
  }
  return null;
}

/** Integer yen amounts must be positive; a rounded-down-to-zero-or-negative result is treated as unreadable. */
function toPositiveIntegerOrNull(value: unknown): number | null {
  const n = toIntegerOrNull(value);
  return n !== null && n > 0 ? n : null;
}

function toDateOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function toNonEmptyStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toAccountIdOrNull(value: unknown, validIds: ReadonlySet<string>): string | null {
  if (typeof value !== "string") return null;
  return validIds.has(value) ? value : null;
}

/**
 * Parses a suggestion reply into an `EntrySuggestion`. Never throws: a
 * missing/malformed JSON block yields the all-null-fields shape with `raw`
 * still populated so the caller can show/debug what came back. Account ids
 * outside `validIds` are dropped to null (the model may hallucinate an id
 * not present in the candidate list it was given).
 */
export function parseEntrySuggestion(raw: string, validIds: ReadonlySet<string>): EntrySuggestion {
  const empty: EntrySuggestion = {
    description: null,
    date: null,
    amount: null,
    debitAccountId: null,
    creditAccountId: null,
    raw,
  };

  const record = extractJsonRecord(raw);
  if (!record) return empty;

  return {
    description: toNonEmptyStringOrNull(record.description),
    date: toDateOrNull(record.date),
    amount: toPositiveIntegerOrNull(record.amount),
    debitAccountId: toAccountIdOrNull(record.debitAccountId, validIds),
    creditAccountId: toAccountIdOrNull(record.creditAccountId, validIds),
    raw,
  };
}

function buildSuggestSystemPrompt(input: EntrySuggestionInput): string {
  const accountList = input.accounts.map((a) => `"${a.id}"(${a.name}/${a.type})`).join(", ");
  return [
    "You are tc-books journal-entry suggestion, helping a user turn one free-form Japanese sentence into a single double-entry bookkeeping entry.",
    "Reply with ONLY the JSON object: the first character of your reply must be `{` and the last character must be `}`. No code fences, no explanations, no commentary, matching exactly this schema:",
    '{"description":string|null,"date":"YYYY-MM-DD"|null,"amount":integer|null,"debitAccountId":string|null,"creditAccountId":string|null}',
    "Double-entry direction: for an expense, debitAccountId is the expense account and creditAccountId is the payment method (an asset or liability account). For income/revenue received, debitAccountId is the account that received the money (an asset account) and creditAccountId is the revenue account.",
    `Choose debitAccountId and creditAccountId ONLY from this list of candidate accounts (format is "id"(name/type)): ${accountList || "(no candidates provided)"}. Use the exact id string.`,
    "For the accounts, always prefer the CLOSEST reasonable candidate over null: when the text describes spending money, pick the nearest expense candidate even if it is not a perfect fit (falling back to a generic one like 雑費/その他 when nothing specific matches), and likewise the nearest revenue candidate for money received. If no payment method is mentioned, assume cash (現金) when such a candidate exists. Use null for an account only when the text does not describe a money transaction at all.",
    `Today's date (basis for resolving relative dates like "昨日" / "先週金曜") is ${input.today}. Resolve any relative date in the text to an absolute YYYY-MM-DD date. If the text doesn't mention a date at all, use null.`,
    "amount must be integer yen (no currency symbols, no decimals, no thousands separators). Return null if it cannot be read confidently.",
    "description is a concise Japanese summary (摘要) of the transaction, including the vendor/item name where mentioned.",
    "Return null for date/amount when they cannot be read confidently — do not guess numbers or dates.",
  ].join(" ");
}

export async function suggestEntry(
  input: EntrySuggestionInput,
  options?: { onDelta?: (full: string) => void },
): Promise<EntrySuggestion> {
  const validIds = new Set(input.accounts.map((a) => a.id));
  const onDelta = options?.onDelta ? (_delta: string, full: string) => options.onDelta!(full) : undefined;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: buildSuggestSystemPrompt(input) },
    { role: "user", content: input.text },
  ];

  let raw = await requestChatCompletion(undefined, messages, { onDelta });

  if (!extractJsonRecord(raw)) {
    // Malformed JSON: retry once, feeding the failed reply back as context.
    messages.push({ role: "assistant", content: raw });
    messages.push({ role: "user", content: RETRY_MESSAGE });
    raw = await requestChatCompletion(undefined, messages, { onDelta });
  }

  return parseEntrySuggestion(raw, validIds);
}
