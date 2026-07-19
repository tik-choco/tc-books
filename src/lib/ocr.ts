// TC Books — receipt OCR via direct-HTTP two-stage chat completion (worker: ocr)
//
// Mirrors tc-translate `src/lib/api.ts` readImageText: the P2P/mistai wire
// protocol's ChatMessage.content is string-only, so vision requests (which
// need the OpenAI content-part array of text + image_url) always go straight
// to `${baseUrl}/chat/completions` over fetch + SSE, never through the AI
// Network consumer relay. `resolvePreset` gives us the connection info; a
// missing preset means the user hasn't wired up an LLM endpoint yet.
//
// Two-stage pipeline (reworked from a single vision+JSON call, which measured
// under 20% real-world accuracy because vision models are bad at emitting
// well-formed JSON while also reading small print):
//   Stage 1 "transcribe" — a vision call whose ONLY job is a faithful plain
//     text transcription of the receipt (line structure preserved, unreadable
//     glyphs marked ▢, no JSON, no commentary). This plays to what vision
//     models are actually good at. Uses `localSettings.visionPresetId`
//     (falling back to the shared config's defaultPresetId).
//   Stage 2 "extract" — a text-only call (same endpoint) that turns the
//     Stage-1 transcript into the structured JSON schema. Decoupling
//     "reading" from "formatting" is the point of this rework. If the reply
//     isn't parseable JSON, Stage 2 is retried once with the failed reply
//     appended as context; a second failure returns the empty-fields
//     ReceiptScan rather than throwing. Uses `localSettings.extractPresetId`
//     when set and resolvable; otherwise reuses the already-resolved Stage-1
//     preset directly (NOT the shared defaultPresetId), so users who never
//     touch the new setting see unchanged behavior.

import { emptyLlmConfig, loadLlmConfig, resolvePreset } from "./llmConfig";
import type { ResolvedLlmTargetV1 } from "./llmConfig";
import { loadLocalSettings, type ReasoningEffort } from "./llmSettings";
import type { ReceiptScan, ReceiptScanItem } from "../types";

/**
 * Standard expense account ids the model may choose from, kept in sync by
 * hand with `accounts.ts`'s quickExpenseCategories() id set (see
 * docs/CONTRACTS.md). Duplicated here rather than imported so ocr.ts doesn't
 * take a dependency on the domain worker's accounts.ts.
 */
const CATEGORY_OPTIONS: { id: string; name: string }[] = [
  { id: "food", name: "食費" },
  { id: "dining", name: "外食" },
  { id: "daily", name: "日用品" },
  { id: "housing", name: "住居・家賃" },
  { id: "utilities", name: "水道光熱" },
  { id: "communication", name: "通信" },
  { id: "transport", name: "交通" },
  { id: "medical", name: "医療" },
  { id: "education", name: "教育" },
  { id: "entertainment", name: "娯楽" },
  { id: "clothing", name: "衣服・美容" },
  { id: "social", name: "交際費" },
  { id: "insurance", name: "保険" },
  { id: "tax", name: "税金" },
  { id: "supplies", name: "消耗品" },
  { id: "misc-expense", name: "雑費" },
];

const CATEGORY_IDS = new Set(CATEGORY_OPTIONS.map((option) => option.id));

const RETRY_MESSAGE =
  "その返答は有効なJSONではありませんでした。説明やコードフェンスを一切付けず、スキーマに完全に一致するJSONオブジェクトだけを返してください。";

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

export interface ScanReceiptOptions {
  /** 現在のステージのストリーミング全文 */
  onDelta?: (full: string) => void;
  /** ステージ切替通知: transcribe=文字起こし, extract=構造化 */
  onStage?: (stage: "transcribe" | "extract") => void;
  signal?: AbortSignal;
}

function buildTranscriptionSystemPrompt(): string {
  return [
    "You are an OCR transcription engine for tc-books receipt scanning.",
    "Produce a faithful plain-text transcription of the receipt/invoice in the image — nothing else.",
    "Preserve the original line structure: output one receipt line per output line, in the same order as printed.",
    "Keep each amount on the same line as (next to) its label, exactly as printed.",
    "Transcribe exactly what is visible, including Japanese text, verbatim; do not translate or normalize anything.",
    "Mark any part you cannot read with ▢.",
    "Do not add commentary, headers, explanations, or JSON of any kind — output only the transcribed text.",
  ].join(" ");
}

function buildExtractionSystemPrompt(): string {
  const categoryList = CATEGORY_OPTIONS.map((option) => `"${option.id}"(${option.name})`).join(", ");
  return [
    "You are tc-books receipt OCR structured-extraction.",
    "You will be given a plain-text transcription of a receipt/invoice (produced by a separate transcription step; ▢ marks unreadable parts). Extract structured data from it.",
    "Reply with ONLY the JSON object: the first character of your reply must be `{` and the last character must be `}`. No code fences, no explanations, no commentary, matching exactly this schema:",
    '{"date":"YYYY-MM-DD"|null,"vendor":string|null,"total":integer|null,"tax":integer|null,"items":[{"name":string,"amount":integer}],"category":string|null}',
    "date must be converted to the Gregorian calendar as YYYY-MM-DD (e.g. Japanese era dates like \"R6.7.11\" or \"令和6年7月11日\" become \"2024-07-11\"). If the date cannot be determined, use null.",
    "total must be the receipt's 合計 or 総合計 (grand total). Do NOT use 小計 (subtotal), お預り/お預かり (cash tendered), or お釣り (change) as the total.",
    "total and tax and each item amount must be integer yen (no currency symbols, no decimals, no thousands separators).",
    "items should list the individual line items on the receipt; use an empty array if none can be read.",
    `category must be one of these ids, chosen as the best match for what was purchased, or null if unclear: ${categoryList}.`,
    "Return null for any field you cannot read confidently. Do not guess.",
  ].join(" ");
}

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

function toDateOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function toNonEmptyStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toItems(value: unknown): ReceiptScanItem[] {
  if (!Array.isArray(value)) return [];
  const items: ReceiptScanItem[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const name = toNonEmptyStringOrNull(record.name);
    const amount = toIntegerOrNull(record.amount);
    if (name === null || amount === null) continue;
    items.push({ name, amount });
  }
  return items;
}

function toCategoryOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return CATEGORY_IDS.has(value) ? value : null;
}

/**
 * Parses a Stage-2 extraction reply into a `ReceiptScan`. Never throws: a
 * missing/malformed JSON block yields the empty-fields shape with `raw`/
 * `transcript` still populated so the caller can show the user what came
 * back.
 */
export function parseReceiptScan(raw: string, transcript: string): ReceiptScan {
  const empty: ReceiptScan = {
    date: null,
    vendor: null,
    total: null,
    tax: null,
    items: [],
    suggestedAccountId: null,
    raw,
    transcript,
  };

  const record = extractJsonRecord(raw);
  if (!record) return empty;

  return {
    date: toDateOrNull(record.date),
    vendor: toNonEmptyStringOrNull(record.vendor),
    total: toIntegerOrNull(record.total),
    tax: toIntegerOrNull(record.tax),
    items: toItems(record.items),
    suggestedAccountId: toCategoryOrNull(record.category),
    raw,
    transcript,
  };
}

/**
 * POSTs one non-streaming-to-caller chat completion request (SSE under the
 * hood) to `${resolved.baseUrl}/chat/completions` and resolves with the full
 * accumulated reply text, invoking `onDelta(full)` as chunks arrive.
 *
 * `temperature` is always forced to 0 (ignoring `resolved.temperature`):
 * Stage 1 needs the most literal possible transcription and Stage 2 needs
 * deterministic JSON, so neither stage benefits from the user's configured
 * temperature.
 *
 * `reasoningEffort` is the caller's task-level setting (visionReasoningEffort
 * for Stage 1, extractReasoningEffort for Stage 2 — see lib/llmSettings.ts)
 * and is always sent explicitly, 'none' included (see
 * tc-docs/drafts/llm-settings-common-v1.md §3.2).
 *
 * Abort: `signal` is passed straight to `fetch`; on abort the resulting
 * AbortError propagates unwrapped (checked via `(error as Error).name`)
 * rather than being folded into the "connection failed" message below, and
 * an aborted stream causes `reader.read()` to reject, stopping the read loop
 * promptly.
 */
async function streamCompletion(
  messages: ChatMessage[],
  resolved: ResolvedLlmTargetV1,
  reasoningEffort: ReasoningEffort,
  signal: AbortSignal | undefined,
  onDelta: ((full: string) => void) | undefined,
): Promise<string> {
  const baseUrl = resolved.baseUrl.trim().replace(/\/+$/, "");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (resolved.apiKey.trim()) {
    headers.Authorization = `Bearer ${resolved.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: resolved.model,
    stream: true,
    temperature: 0,
    reasoning_effort: reasoningEffort,
    messages,
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new Error(`LLM APIへの接続に失敗しました: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    const message =
      payload && typeof payload === "object" && payload.error && typeof payload.error.message === "string"
        ? payload.error.message
        : `LLM APIがエラーを返しました (status ${response.status})`;
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("LLMからの応答が空でした。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let delta = "";
      try {
        const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        delta = chunk.choices?.[0]?.delta?.content ?? "";
      } catch {
        continue;
      }

      if (delta) {
        full += delta;
        onDelta?.(full);
      }
    }
  }

  return full;
}

export async function scanReceipt(dataUrl: string, options?: ScanReceiptOptions): Promise<ReceiptScan> {
  const config = loadLlmConfig() ?? emptyLlmConfig();
  const localSettings = loadLocalSettings();
  const resolved = resolvePreset(config, localSettings.visionPresetId || undefined);
  if (!resolved) {
    throw new Error("設定タブでLLM接続先を設定してください。");
  }

  // Stage 2 uses its own preset if one is configured and still resolvable;
  // otherwise it reuses the Stage-1 resolved target directly (skipping
  // defaultPresetId) so existing users' behavior is unchanged.
  const extractResolved = localSettings.extractPresetId
    ? resolvePreset(config, localSettings.extractPresetId)
    : null;
  const extractTarget = extractResolved ?? resolved;

  // Stage 1: transcribe only. Vision models are good readers but bad JSON
  // formatters, so this call asks for nothing but plain text.
  options?.onStage?.("transcribe");
  const transcriptionMessages: ChatMessage[] = [
    { role: "system", content: buildTranscriptionSystemPrompt() },
    {
      role: "user",
      content: [
        { type: "text", text: "Transcribe this receipt image exactly as described in the system prompt." },
        { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
      ],
    },
  ];
  const transcriptRaw = await streamCompletion(
    transcriptionMessages,
    resolved,
    localSettings.visionReasoningEffort,
    options?.signal,
    options?.onDelta,
  );
  const transcript = transcriptRaw.trim();

  if (!transcript) {
    return {
      date: null,
      vendor: null,
      total: null,
      tax: null,
      items: [],
      suggestedAccountId: null,
      raw: "",
      transcript: "",
    };
  }

  // Stage 2: text-only structured extraction from the Stage-1 transcript.
  options?.onStage?.("extract");
  const extractionMessages: ChatMessage[] = [
    { role: "system", content: buildExtractionSystemPrompt() },
    { role: "user", content: transcript },
  ];

  let extractionRaw = await streamCompletion(
    extractionMessages,
    extractTarget,
    localSettings.extractReasoningEffort,
    options?.signal,
    options?.onDelta,
  );

  if (!extractJsonRecord(extractionRaw)) {
    // Malformed JSON: retry once, feeding the failed reply back as context.
    extractionMessages.push({ role: "assistant", content: extractionRaw });
    extractionMessages.push({ role: "user", content: RETRY_MESSAGE });
    extractionRaw = await streamCompletion(
      extractionMessages,
      extractTarget,
      localSettings.extractReasoningEffort,
      options?.signal,
      options?.onDelta,
    );
  }

  return parseReceiptScan(extractionRaw.trim(), transcript);
}
