import type { LlmSettingsLocale } from "@tik-choco/mistai/preact";

const en = {
  aiSettings: "AI settings", language: "Language", next: "Next", defaultTask: "General tasks",
  defaultTip: "Used for journal suggestions and other general AI calls.",
  visionTask: "Receipt OCR", visionTip: "Transcribes receipt images with the selected model.",
  extractTask: "Receipt extraction", extractTip: "Converts receipt text into structured journal data. Unassigned tasks follow the default model.",
  setupTip: "Add a connection and choose a default model in Tasks. Setup is optional; you can change it later in settings.",
  modelRequired: "Choose a model in AI settings before using this task.", emptyResponse: "The model returned an empty response.",
  connectionFailed: "Could not connect to the model: {message}", upstreamError: "The model API returned an error (status {status}).",
};
export const AI_MESSAGES: Record<LlmSettingsLocale, Record<keyof typeof en, string>> = {
  en,
  ja: {
    aiSettings: "AI設定", language: "言語", next: "次へ", defaultTask: "通常のタスク",
    defaultTip: "仕訳のAI推定など、通常のAI呼び出しに使います。",
    visionTask: "領収書OCR", visionTip: "選択したモデルで領収書画像を文字起こしします。",
    extractTask: "領収書解析", extractTip: "領収書の文字起こしを仕訳データに変換します。未割り当てのタスクは既定モデルに従います。",
    setupTip: "接続先を追加し、タスクで既定モデルを選んでください。設定は任意で、あとから設定画面で変更できます。",
    modelRequired: "このタスクを使う前にAI設定でモデルを選んでください。", emptyResponse: "モデルからの応答が空でした。",
    connectionFailed: "モデルへの接続に失敗しました: {message}", upstreamError: "モデルAPIがエラーを返しました (status {status})。",
  },
  "zh-CN": {
    aiSettings: "AI 设置", language: "语言", next: "下一步", defaultTask: "常规任务",
    defaultTip: "用于分录建议和其他常规 AI 请求。",
    visionTask: "收据识别", visionTip: "使用所选模型识别收据图片中的文字。",
    extractTask: "收据解析", extractTip: "将收据文字转换为结构化分录数据。未分配的任务使用默认模型。",
    setupTip: "添加连接，然后在任务中选择默认模型。此设置可跳过，之后可在设置中修改。",
    modelRequired: "使用此任务前，请在 AI 设置中选择模型。", emptyResponse: "模型返回了空响应。",
    connectionFailed: "无法连接到模型：{message}", upstreamError: "模型 API 返回错误（状态 {status}）。",
  },
  "zh-TW": {
    aiSettings: "AI 設定", language: "語言", next: "下一步", defaultTask: "一般任務",
    defaultTip: "用於分錄建議及其他一般 AI 請求。",
    visionTask: "收據辨識", visionTip: "使用所選模型辨識收據圖片中的文字。",
    extractTask: "收據解析", extractTip: "將收據文字轉換為結構化分錄資料。未指定的任務使用預設模型。",
    setupTip: "新增連線，然後在任務中選擇預設模型。此設定可略過，之後可在設定中修改。",
    modelRequired: "使用此任務前，請在 AI 設定中選擇模型。", emptyResponse: "模型傳回了空回應。",
    connectionFailed: "無法連線至模型：{message}", upstreamError: "模型 API 傳回錯誤（狀態 {status}）。",
  },
};

export function getAiLocale(): LlmSettingsLocale {
  let locale = typeof document === "undefined" ? "ja" : document.documentElement.lang || navigator.language;
  try { locale = localStorage.getItem("tc-books:ai-locale") || locale; } catch { /* Storage is optional. */ }
  return locale === "zh-TW" || locale === "zh-HK" ? "zh-TW" : locale.startsWith("zh") ? "zh-CN" : locale.startsWith("en") ? "en" : "ja";
}

export function aiMessages() { return AI_MESSAGES[getAiLocale()]; }
