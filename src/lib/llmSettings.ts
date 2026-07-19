// App-local (non-shared) LLM settings for tc-books: which shared preset
// (tc-shared-llm-config-v1, see lib/llmConfig.ts) the vision/OCR feature
// uses, plus the AI Network consumer toggle. The actual connection info
// (providers) and model configs (presets) live in the co-owned shared key so
// they're reusable across the tik-choco app family; this module only owns
// tc-books' own pointers into that shared config.

const SETTINGS_KEY = "tc-books:settings-v1";

// reasoning_effort values offered per task (see
// tc-docs/drafts/llm-settings-common-v1.md §3.2). 'none' is a real API value
// (explicitly disables reasoning on servers that support it), not "omit the
// field" — requests always include reasoning_effort, 'none' included.
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
export const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high"];

const REASONING_EFFORT_SET: ReadonlySet<string> = new Set(REASONING_EFFORT_OPTIONS);

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORT_SET.has(value);
}

export interface BooksLocalSettings {
  /** 領収書OCRで使うpreset id。"" = defaultPresetIdに従う。 */
  visionPresetId: string;
  /** 領収書OCRのStage2(テキスト解析)で使うpreset id。"" = defaultPresetIdに従う。 */
  extractPresetId: string;
  /** AI Network(P2P) consumerを使うか(テキストLLMのみ、visionは常に直接HTTP)。 */
  networkConsumerEnabled: boolean;
  /** 既定タスク(仕訳のAI推定など)のreasoning_effort。常にリクエストへ明示送信する。 */
  defaultReasoningEffort: ReasoningEffort;
  /** 領収書OCR(文字起こし)のreasoning_effort。 */
  visionReasoningEffort: ReasoningEffort;
  /** 領収書解析(JSON構造化)のreasoning_effort。 */
  extractReasoningEffort: ReasoningEffort;
}

function defaultLocalSettings(): BooksLocalSettings {
  return {
    visionPresetId: "",
    extractPresetId: "",
    networkConsumerEnabled: false,
    defaultReasoningEffort: "none",
    visionReasoningEffort: "none",
    extractReasoningEffort: "none",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeSettings(value: Record<string, unknown>): BooksLocalSettings {
  return {
    visionPresetId: typeof value.visionPresetId === "string" ? value.visionPresetId : "",
    extractPresetId: typeof value.extractPresetId === "string" ? value.extractPresetId : "",
    networkConsumerEnabled: value.networkConsumerEnabled === true,
    defaultReasoningEffort: isReasoningEffort(value.defaultReasoningEffort) ? value.defaultReasoningEffort : "none",
    visionReasoningEffort: isReasoningEffort(value.visionReasoningEffort) ? value.visionReasoningEffort : "none",
    extractReasoningEffort: isReasoningEffort(value.extractReasoningEffort) ? value.extractReasoningEffort : "none",
  };
}

export function loadLocalSettings(): BooksLocalSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultLocalSettings();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return defaultLocalSettings();
    return sanitizeSettings(parsed);
  } catch {
    return defaultLocalSettings();
  }
}

export function saveLocalSettings(settings: BooksLocalSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("tc-books: failed to persist local settings", error);
  }
}
