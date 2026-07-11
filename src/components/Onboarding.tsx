// First-run wizard shown by app.tsx as a modal overlay: welcome -> LLM
// connection (optional, used for receipt OCR) -> feature tour. Every step is
// skippable and closing at any point counts as "done" (the flag is owned by
// the caller via `onClose`) — the settings screen can re-open it any time.
// Ported from tc-town's src/components/Onboarding.tsx, trimmed to tc-books'
// simpler shape (no character creation step, no OptionsPicker dependency).

import { useState } from "preact/hooks";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ChartColumnBig,
  Check,
  Cloud,
  Cpu,
  House,
  NotebookPen,
  Plug,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-preact";
import { fetchModels, formatMistaiError, MESSAGES_JA, streamChatCompletion } from "@tik-choco/mistai";
import {
  emptyLlmConfig,
  ensureProvider,
  loadLlmConfig,
  normalizeBaseUrl,
  resolvePreset,
  saveLlmConfig,
} from "../lib/llmConfig";
import "../styles/onboarding.css";

const STEP_COUNT = 3;

interface LlmDraft {
  baseUrl: string;
  apiKey: string;
  model: string;
}

type TestState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "ok" }
  | { phase: "error"; message: string };

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

/** モデル名の入力欄。「候補取得」ボタンで fetchModels を呼び datalist に反映する。
 * 取得に失敗した場合は無視して手入力にフォールバックする。 */
function ModelField(props: {
  value: string;
  baseUrl: string;
  apiKey: string;
  onChange: (model: string) => void;
}) {
  const { value, baseUrl, apiKey, onChange } = props;
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!baseUrl.trim()) return;
    setLoading(true);
    try {
      const models = await fetchModels({ baseUrl, apiKey });
      setOptions(models);
    } catch {
      // 失敗は無視: 手入力にフォールバックする
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="ob-model-row">
      <input
        class="ob-input"
        list="ob-model-options"
        type="text"
        placeholder="例: gpt-4o-mini"
        value={value}
        onInput={(e) => onChange(inputValue(e))}
      />
      <datalist id="ob-model-options">
        {options.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <button
        class="ob-icon-btn"
        type="button"
        onClick={() => void refresh()}
        disabled={loading || !baseUrl.trim()}
        title="候補取得"
        aria-label="候補取得"
      >
        <RefreshCw size={14} />
      </button>
    </div>
  );
}

export function Onboarding(props: { onClose: () => void }) {
  const [step, setStep] = useState(0);

  // LLM draft starts from the shared config's current default preset so
  // re-running the wizard shows (and edits) the real current connection
  // instead of blank fields.
  const [llm, setLlm] = useState<LlmDraft>(() => {
    const target = resolvePreset(loadLlmConfig() ?? emptyLlmConfig());
    return {
      baseUrl: target?.baseUrl ?? "",
      apiKey: target?.apiKey ?? "",
      model: target?.model ?? "",
    };
  });
  const [testState, setTestState] = useState<TestState>({ phase: "idle" });

  function updateLlm(patch: Partial<LlmDraft>) {
    setLlm((prev) => ({ ...prev, ...patch }));
    // Edited connection values invalidate a previous test result.
    setTestState({ phase: "idle" });
  }

  /** Persists the draft into the default preset (the one used for receipt OCR): edits it in place if one already exists, otherwise creates a provider+preset and sets it as default. */
  function saveLlmDraft() {
    const cfg = loadLlmConfig() ?? emptyLlmConfig();
    const providerId = ensureProvider(cfg, { baseUrl: llm.baseUrl, apiKey: llm.apiKey });
    const existingDefault = cfg.presets.find((p) => p.id === cfg.defaultPresetId);
    if (existingDefault) {
      existingDefault.providerId = providerId;
      existingDefault.model = llm.model.trim();
    } else {
      const preset = { id: crypto.randomUUID(), label: "デフォルト", providerId, model: llm.model.trim() };
      cfg.presets.push(preset);
      cfg.defaultPresetId = preset.id;
    }
    saveLlmConfig(cfg);
  }

  async function handleTest() {
    if (testState.phase === "busy") return;
    setTestState({ phase: "busy" });
    try {
      await streamChatCompletion(
        {
          baseUrl: normalizeBaseUrl(llm.baseUrl),
          apiKey: llm.apiKey,
          model: llm.model.trim(),
          temperature: 0.7,
        },
        [{ role: "user", content: "接続テストです。「OK」とだけ返してください。" }],
      );
      setTestState({ phase: "ok" });
    } catch (error) {
      setTestState({ phase: "error", message: formatMistaiError(error, MESSAGES_JA, "LLM呼び出しに失敗しました") });
    }
  }

  function handleLlmNext() {
    // 空欄のまま次へ進む場合は保存しない(未設定のまま手入力運用を続けられる)。
    if (llm.baseUrl.trim() || llm.model.trim()) {
      saveLlmDraft();
    }
    setStep(2);
  }

  return (
    <div class="ob-overlay">
      <div class="ob-card" role="dialog" aria-modal="true" aria-label="はじめてのセットアップ">
        <button class="ob-close" type="button" onClick={props.onClose} title="閉じる" aria-label="閉じる">
          <X size={18} />
        </button>

        {step === 0 && (
          <div class="ob-body">
            <div class="ob-hero">
              <Sparkles size={36} />
            </div>
            <h2 class="ob-title">TC Books へようこそ！</h2>
            <p class="ob-text">
              TC Books は複式簿記ベースの家計簿アプリです。クイック入力やレシート読み取りでかんたんに記帳でき、
              仕訳帳・元帳・レポートで家計の流れを把握できます。データはすべて端末内(ブラウザ)に保存されます。
            </p>
            <p class="ob-text">
              準備は任意で1つだけ：レシート読み取り(OCR)に使う<strong>LLMの接続設定</strong>です。
              LLMを設定しなくても手入力ですべての機能が使えますし、あとから設定画面でいつでも変更できます。
            </p>
          </div>
        )}

        {step === 1 && (
          <div class="ob-body">
            <div class="ob-step-head">
              <Cpu size={22} />
              <h2 class="ob-title">LLMの接続設定（任意）</h2>
            </div>
            <p class="ob-text">
              レシート画像の読み取り(OCR)に使う LLM を設定します。OpenAI 互換の API ならどれでも使えます
              （OpenAI、LM Studio、Ollama など）。使わない場合はこのままスキップできます。
            </p>

            <div class="ob-field">
              <label class="ob-label">ベースURL</label>
              <input
                class="ob-input"
                type="text"
                placeholder="例: https://api.openai.com/v1 / http://localhost:1234/v1"
                value={llm.baseUrl}
                onInput={(e) => updateLlm({ baseUrl: inputValue(e) })}
              />
            </div>
            <div class="ob-field">
              <label class="ob-label">APIキー（不要なら空欄）</label>
              <input
                class="ob-input"
                type="password"
                placeholder="sk-..."
                value={llm.apiKey}
                onInput={(e) => updateLlm({ apiKey: inputValue(e) })}
              />
            </div>
            <div class="ob-field">
              <label class="ob-label">モデル</label>
              <ModelField
                value={llm.model}
                baseUrl={llm.baseUrl}
                apiKey={llm.apiKey}
                onChange={(model) => updateLlm({ model })}
              />
            </div>

            <div class="ob-test-row">
              <button
                class="ob-btn"
                type="button"
                onClick={() => void handleTest()}
                disabled={testState.phase === "busy" || !llm.baseUrl.trim()}
              >
                {testState.phase === "busy" ? <span class="spinner" /> : <Plug size={16} />}
                {testState.phase === "busy" ? "接続中..." : "接続テスト"}
              </button>
              {testState.phase === "ok" && (
                <span class="ob-test-ok">
                  <Check size={16} />
                  接続できました！
                </span>
              )}
            </div>
            {testState.phase === "error" && <p class="ob-error">接続に失敗しました: {testState.message}</p>}
          </div>
        )}

        {step === 2 && (
          <div class="ob-body">
            <div class="ob-step-head">
              <Check size={22} />
              <h2 class="ob-title">準備完了です！</h2>
            </div>
            <ul class="ob-feature-list">
              <li>
                <House size={16} />
                <span>
                  <strong>家計簿</strong> — クイック入力とレシート読み取りでかんたん記帳
                </span>
              </li>
              <li>
                <NotebookPen size={16} />
                <span>
                  <strong>仕訳帳</strong> — 複式簿記の仕訳を一覧・編集
                </span>
              </li>
              <li>
                <BookOpenText size={16} />
                <span>
                  <strong>元帳</strong> — 勘定科目ごとの明細と残高
                </span>
              </li>
              <li>
                <ChartColumnBig size={16} />
                <span>
                  <strong>レポート</strong> — 月次の収支・資産の推移をグラフで確認
                </span>
              </li>
              <li>
                <Cloud size={16} />
                <span>
                  <strong>バックアップ</strong> — 暗号化して自動でtc-storageへ保存
                </span>
              </li>
            </ul>
            <p class="ob-text ob-text-subtle">記帳データはすべて端末内に保存されます。それでは、楽しんでください！</p>
          </div>
        )}

        <footer class="ob-footer">
          <div class="ob-dots" aria-hidden="true">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} class={"ob-dot" + (i === step ? " is-active" : "")} />
            ))}
          </div>
          <div class="ob-footer-actions">
            {step > 0 && (
              <button class="ob-btn" type="button" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={16} />
                戻る
              </button>
            )}
            {step === 0 && (
              <button class="ob-btn ob-btn-accent" type="button" onClick={() => setStep(1)}>
                はじめる
                <ArrowRight size={16} />
              </button>
            )}
            {step === 1 && (
              <button class="ob-btn ob-btn-accent" type="button" onClick={handleLlmNext}>
                保存して次へ
                <ArrowRight size={16} />
              </button>
            )}
            {step === 2 && (
              <button class="ob-btn ob-btn-accent" type="button" onClick={props.onClose}>
                <Check size={16} />
                完了
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
