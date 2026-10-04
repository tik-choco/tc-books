import { useState } from "preact/hooks";
import { LlmSettings, type LlmSettingsLocale } from "@tik-choco/mistai/preact";
import { localSettingsAdapter } from "../lib/llmSettings";
import { AI_MESSAGES, getAiLocale } from "../lib/llmMessages";
import "../styles/ai-settings.css";

export function BooksAiSettings({ initialTab = "connection" }: { initialTab?: "connection" | "tasks" | "sharing" }) {
  const [locale, setLocale] = useState(getAiLocale);
  const t = AI_MESSAGES[locale];
  return <LlmSettings
    title={t.aiSettings}
    initialTab={initialTab}
    locale={locale}
    localSettings={localSettingsAdapter}
    tasks={[
      { id: "default", label: t.defaultTask, tip: t.defaultTip, reasoning: true },
      { id: "vision", label: t.visionTask, tip: t.visionTip, reasoning: true },
      { id: "extract", label: t.extractTask, tip: t.extractTip, reasoning: true },
    ]}
    headerSection={<label class="books-ai-language">
      <span>{t.language}</span>
      <select value={locale} onChange={event => {
        const next = event.currentTarget.value as LlmSettingsLocale;
        setLocale(next);
        try { localStorage.setItem("tc-books:ai-locale", next); } catch { /* Storage is optional. */ }
        window.dispatchEvent(new Event("tc-books:ai-locale-change"));
      }}>
        <option value="ja">日本語</option><option value="en">English</option>
        <option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option>
      </select>
    </label>}
  />;
}
