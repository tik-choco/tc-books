// AI接続タブの中身: 接続先(provider)とモデル(preset)、互いに独立した
// フラットなカードグリッド + 追加タイル。インライン編集(blurでコミット、
// モデルselectの選択=コミットで行クローズ)。tc-translate の
// src/components/SettingsModal.tsx の「接続先/モデル」セクションを、
// tc-books のCRUD層(lib/llmConfigEdit.ts)・データ型(lib/llmConfig.ts)に
// 合わせて移植(i18n無し、TTS/STT/AI Network provider役割は無いため未移植)。
// 仕様: tc-docs/drafts/llm-settings-common-v1.md §3.1, §5.3。

import { useEffect, useRef, useState } from "preact/hooks";
import { Plus, X } from "lucide-preact";
import { fetchModels } from "@tik-choco/mistai";
import { createPreset, createProvider, deletePreset, deleteProvider, patchPreset, patchProvider } from "../lib/llmConfigEdit";
import { isNetworkProviderBaseUrl } from "../lib/networkModels";
import type { LlmProviderV1, ModelPresetV1, SharedLlmConfigV1 } from "../lib/llmConfig";
import type { BooksLocalSettings } from "../lib/llmSettings";
import "../styles/settings-llm.css";

function getHostLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

type LlmConnectionPanelProps = {
  shared: SharedLlmConfigV1;
  local: BooksLocalSettings;
  /** 共有設定をクローンしてmutateし、保存する。lib/llmConfigEdit.tsのCRUD関数をそのまま渡せる。 */
  onMutate: (mutate: (config: SharedLlmConfigV1) => void) => void;
  /** presetが削除された後、そのidを指していたタスクのローカルポインタ(visionPresetId等)をクリアするための通知。 */
  onPresetRemoved: (id: string) => void;
};

export function LlmConnectionPanel({ shared, local, onMutate, onPresetRemoved }: LlmConnectionPanelProps) {
  // providerId -> fetched models。接続先の編集行(接続テストを兼ねる)と
  // モデルのselect/手入力フォールバック両方で使う。遅延取得: その
  // providerを参照する行が最初に開かれた時に取得し、baseUrl/apiKeyが
  // コミットされたら無効化して再取得する。
  const [modelsByProviderId, setModelsByProviderId] = useState<Record<string, string[]>>({});
  const [loadingProviderId, setLoadingProviderId] = useState("");
  const [providerModelErrors, setProviderModelErrors] = useState<Record<string, string>>({});

  // --- 接続先 (provider) セクション: 一度に開けるインライン行は1つだけ。 ---
  const [editingProviderId, setEditingProviderId] = useState("");
  const [addingProvider, setAddingProvider] = useState(false);
  const [npLabel, setNpLabel] = useState("");
  const [npBaseUrl, setNpBaseUrl] = useState("");
  const [npApiKey, setNpApiKey] = useState("");

  // --- モデル (preset) セクション ---
  const [addingModel, setAddingModel] = useState(false);
  const [amLabel, setAmLabel] = useState("");
  const [amProviderId, setAmProviderId] = useState("");
  const [amModel, setAmModel] = useState("");

  const [editingPresetId, setEditingPresetId] = useState("");
  const [epLabel, setEpLabel] = useState("");
  const [epProviderId, setEpProviderId] = useState("");
  const [epModel, setEpModel] = useState("");
  const [epTemperature, setEpTemperature] = useState("");

  const providerFetchGenerationRef = useRef<Map<string, number>>(new Map());

  function closeAllInlineRows(): void {
    setEditingProviderId("");
    setAddingProvider(false);
    setEditingPresetId("");
    setAddingModel(false);
  }

  // 編集中のentityが(他タブ/他アプリの変更で)消えたら行を閉じる。
  useEffect(() => {
    if (editingProviderId && !shared.providers.some((provider) => provider.id === editingProviderId)) {
      setEditingProviderId("");
    }
    if (editingPresetId && !shared.presets.some((preset) => preset.id === editingPresetId)) {
      setEditingPresetId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared.providers, shared.presets]);

  // 明示的な「決定」ボタンは無く各フィールドがblurでコミットするので、
  // 行を閉じるのは外側クリック/Escapeのみ。ドラッグして行内のテキストを
  // 選択→行外でmouseupすると click の target が行外に解決されることがある
  // ため、mousedownの発生位置を記録して誤クローズを防ぐ。
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const mouseDownInsideRef = useRef(false);
  useEffect(() => {
    if (!editingProviderId && !addingProvider && !editingPresetId && !addingModel) return undefined;

    function handleDocumentMouseDown(event: MouseEvent): void {
      mouseDownInsideRef.current = Boolean(activeRowRef.current && activeRowRef.current.contains(event.target as Node));
    }
    function handleDocumentClick(event: MouseEvent): void {
      if (activeRowRef.current && activeRowRef.current.contains(event.target as Node)) return;
      if (mouseDownInsideRef.current) return;
      closeAllInlineRows();
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") closeAllInlineRows();
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [editingProviderId, addingProvider, editingPresetId, addingModel]);

  // providerのモデル一覧を取得する。接続テストも兼ねる(0件=エラー表示)。
  // 古い(取得中に別の取得が始まった)結果は破棄する。
  async function fetchProviderModels(provider: LlmProviderV1): Promise<string[]> {
    const generations = providerFetchGenerationRef.current;
    const myGeneration = (generations.get(provider.id) || 0) + 1;
    generations.set(provider.id, myGeneration);
    const isStale = () => generations.get(provider.id) !== myGeneration;

    setLoadingProviderId(provider.id);
    setProviderModelErrors((current) => ({ ...current, [provider.id]: "" }));

    let models: string[] = [];
    try {
      models = await fetchModels({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });
    } catch {
      models = [];
    }

    if (isStale()) return models;
    setModelsByProviderId((current) => ({ ...current, [provider.id]: models }));
    if (models.length === 0) {
      setProviderModelErrors((current) => ({ ...current, [provider.id]: "モデル一覧の取得に失敗しました。接続先を確認してください。" }));
    }
    setLoadingProviderId((current) => (current === provider.id ? "" : current));
    return models;
  }

  function ensureProviderModelsFetched(providerId: string, options: { force?: boolean } = {}): void {
    if (!providerId) return;
    if (!options.force && modelsByProviderId[providerId] !== undefined) return;
    const provider = shared.providers.find((entry) => entry.id === providerId);
    if (!provider || isNetworkProviderBaseUrl(provider.baseUrl)) return;
    void fetchProviderModels(provider);
  }

  function getModelSelectionState(providerId: string): { isLoading: boolean; models: string[]; mode: "select" | "manual" } {
    const isLoading = loadingProviderId === providerId;
    const models = modelsByProviderId[providerId] || [];
    return { isLoading, models, mode: isLoading || models.length > 0 ? "select" : "manual" };
  }

  function getProviderLabel(providerId: string): string {
    const provider = shared.providers.find((entry) => entry.id === providerId);
    if (!provider) return "(不明な接続先)";
    return provider.label || getHostLabel(provider.baseUrl);
  }

  function isNetworkPresetProvider(providerId: string): boolean {
    const provider = shared.providers.find((entry) => entry.id === providerId);
    return provider ? isNetworkProviderBaseUrl(provider.baseUrl) : false;
  }

  function getPresetBadges(preset: ModelPresetV1): string[] {
    const badges: string[] = [];
    if (shared.defaultPresetId === preset.id) badges.push("既定");
    if (local.visionPresetId === preset.id) badges.push("領収書OCR");
    if (local.extractPresetId === preset.id) badges.push("領収書解析");
    if (isNetworkPresetProvider(preset.providerId)) badges.push("AI Network由来");
    return badges;
  }

  // --- 接続先 (provider) ハンドラ ---

  function handleOpenEditProvider(provider: LlmProviderV1): void {
    closeAllInlineRows();
    setEditingProviderId(provider.id);
  }

  function handleUpdateProviderField(id: string, field: "label" | "baseUrl" | "apiKey", value: string): void {
    if (field === "baseUrl" && !value.trim()) return;
    onMutate((config) => patchProvider(config, id, { [field]: value }));
    if (field === "baseUrl" || field === "apiKey") {
      setModelsByProviderId((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      const provider = shared.providers.find((entry) => entry.id === id);
      const nextBaseUrl = field === "baseUrl" ? value : (provider?.baseUrl ?? "");
      if (provider && !isNetworkProviderBaseUrl(nextBaseUrl)) void fetchProviderModels({ ...provider, [field]: value });
    }
  }

  function handleOpenAddProvider(): void {
    closeAllInlineRows();
    setAddingProvider(true);
    setNpLabel("");
    setNpBaseUrl("");
    setNpApiKey("");
  }

  function handleCancelAddProvider(): void {
    setAddingProvider(false);
  }

  function handleSaveNewProvider(): void {
    const baseUrl = npBaseUrl.trim().replace(/\/$/, "");
    if (!baseUrl) return;
    onMutate((config) => {
      const id = createProvider(config, npLabel.trim() || baseUrl);
      patchProvider(config, id, { baseUrl, apiKey: npApiKey });
    });
    setAddingProvider(false);
  }

  function handleRemoveProviderRow(provider: LlmProviderV1): void {
    const presetsUsing = shared.presets.filter((preset) => preset.providerId === provider.id).length;
    if (presetsUsing > 0) {
      const ok = window.confirm(`この接続先を使っているモデルが${presetsUsing}件あります。削除しますか?`);
      if (!ok) return;
    }
    onMutate((config) => deleteProvider(config, provider.id));
    setModelsByProviderId((current) => {
      const next = { ...current };
      delete next[provider.id];
      return next;
    });
    setProviderModelErrors((current) => {
      const next = { ...current };
      delete next[provider.id];
      return next;
    });
    if (editingProviderId === provider.id) setEditingProviderId("");
    if (amProviderId === provider.id) {
      setAddingModel(false);
      setAmProviderId("");
      setAmModel("");
    }
    if (epProviderId === provider.id && editingPresetId) setEditingPresetId("");
  }

  // --- モデル (preset) ハンドラ ---

  function handleOpenAddModel(): void {
    closeAllInlineRows();
    setAddingModel(true);
    setAmLabel("");
    setAmProviderId("");
    setAmModel("");
  }

  function handleCancelAddModel(): void {
    setAddingModel(false);
  }

  function handleAmProviderChange(providerId: string): void {
    setAmProviderId(providerId);
    setAmModel("");
    ensureProviderModelsFetched(providerId, { force: true });
  }

  function handleSaveAddModel(modelOverride?: string): void {
    const model = (modelOverride ?? amModel).trim();
    if (!amProviderId || !model) return;
    if (!shared.providers.some((provider) => provider.id === amProviderId)) {
      setProviderModelErrors((current) => ({ ...current, [amProviderId]: "接続先が見つかりません。" }));
      return;
    }
    onMutate((config) => {
      const providerId = amProviderId;
      const id = createPreset(config, providerId, amLabel.trim() || model);
      patchPreset(config, id, { model });
    });
    setAddingModel(false);
  }

  function handleAmModelSelectChange(value: string): void {
    setAmModel(value);
    handleSaveAddModel(value);
  }

  function handleOpenEditPreset(preset: ModelPresetV1): void {
    closeAllInlineRows();
    setEditingPresetId(preset.id);
    setEpLabel(preset.label);
    setEpProviderId(preset.providerId);
    setEpModel(preset.model);
    setEpTemperature(String(preset.temperature ?? 0.7));
    ensureProviderModelsFetched(preset.providerId);
  }

  function handleEpLabelBlur(preset: ModelPresetV1): void {
    const label = epLabel.trim() || preset.model;
    if (label !== preset.label) onMutate((config) => patchPreset(config, preset.id, { label }));
  }

  function handleEpProviderChange(preset: ModelPresetV1, providerId: string): void {
    setEpProviderId(providerId);
    setEpModel("");
    onMutate((config) => patchPreset(config, preset.id, { providerId }));
    ensureProviderModelsFetched(providerId, { force: true });
  }

  function handleEpModelSelectChange(preset: ModelPresetV1, value: string): void {
    setEpModel(value);
    if (shared.providers.some((provider) => provider.id === epProviderId)) {
      onMutate((config) => patchPreset(config, preset.id, { model: value }));
    }
    setEditingPresetId("");
  }

  function handleEpModelManualBlur(preset: ModelPresetV1): void {
    const model = epModel.trim();
    if (model && model !== preset.model && shared.providers.some((provider) => provider.id === epProviderId)) {
      onMutate((config) => patchPreset(config, preset.id, { model }));
    }
    setEditingPresetId("");
  }

  function handleEpTemperatureBlur(preset: ModelPresetV1): void {
    const parsed = Number(epTemperature);
    if (Number.isFinite(parsed) && parsed !== (preset.temperature ?? 0.7)) {
      onMutate((config) => patchPreset(config, preset.id, { temperature: parsed }));
    }
  }

  function handleRemovePresetRow(id: string): void {
    const ok = window.confirm("このモデルを削除しますか?");
    if (!ok) return;
    onMutate((config) => deletePreset(config, id));
    onPresetRemoved(id);
    if (editingPresetId === id) setEditingPresetId("");
  }

  // --- 接続先 (provider) 行の描画 ---

  function renderProviderRow(provider: LlmProviderV1) {
    const isEditing = editingProviderId === provider.id;
    const isNetworkProvider = isNetworkProviderBaseUrl(provider.baseUrl);
    const hostLabel = getHostLabel(provider.baseUrl);
    const secondLine = isNetworkProvider ? "AI Networkのルームで検出された接続先です(直接編集不可)" : hostLabel;

    if (isEditing) {
      return (
        <div class="model-row model-row-editing" key={provider.id} ref={activeRowRef}>
          <div class="model-row-edit-fields">
            <input
              value={provider.label}
              onBlur={(event) => handleUpdateProviderField(provider.id, "label", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="名前"
              autoComplete="off"
            />
            <input
              value={provider.baseUrl}
              title={provider.baseUrl}
              onBlur={(event) => handleUpdateProviderField(provider.id, "baseUrl", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="http://localhost:1234/v1"
              autoComplete="off"
            />
            <input
              type="password"
              value={provider.apiKey || ""}
              onBlur={(event) => handleUpdateProviderField(provider.id, "apiKey", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="APIキー (sk-...)"
              autoComplete="off"
            />
            {providerModelErrors[provider.id] ? <p class="hint connection-form-warning">{providerModelErrors[provider.id]}</p> : null}
          </div>
        </div>
      );
    }

    return (
      <div class={`model-row${isNetworkProvider ? " model-row-network" : ""}`} key={provider.id}>
        <button type="button" class="model-row-main" onClick={() => handleOpenEditProvider(provider)}>
          <span class="model-row-label">{provider.label || hostLabel}</span>
          <span class="model-row-model">{secondLine}</span>
        </button>
        <span
          class="preset-chip-remove model-row-remove"
          role="button"
          tabIndex={0}
          title="削除"
          onClick={(event) => {
            event.stopPropagation();
            handleRemoveProviderRow(provider);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              handleRemoveProviderRow(provider);
            }
          }}
        >
          <X size={13} />
        </span>
      </div>
    );
  }

  function renderAddProviderRow() {
    return (
      <div class="model-row model-row-editing model-row-add" ref={activeRowRef}>
        <div class="model-row-edit-fields">
          <input value={npLabel} onInput={(event) => setNpLabel(event.currentTarget.value)} placeholder="名前" autoComplete="off" />
          <input
            value={npBaseUrl}
            onInput={(event) => setNpBaseUrl(event.currentTarget.value)}
            placeholder="http://localhost:1234/v1"
            autoComplete="off"
          />
          <input
            type="password"
            value={npApiKey}
            onInput={(event) => setNpApiKey(event.currentTarget.value)}
            placeholder="APIキー (sk-...)"
            autoComplete="off"
          />
        </div>
        <div class="model-row-add-actions">
          <button type="button" class="connection-form-btn connection-form-btn-primary" onClick={handleSaveNewProvider} disabled={!npBaseUrl.trim()}>
            <Plus size={13} />
            追加
          </button>
          <button type="button" class="connection-form-btn" onClick={handleCancelAddProvider}>
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  function renderAddProviderTile() {
    if (addingProvider) return renderAddProviderRow();
    return (
      <button type="button" class="grid-add-tile" onClick={handleOpenAddProvider}>
        <Plus size={16} />
        <span>接続先を追加</span>
      </button>
    );
  }

  // --- モデル (preset) 行の描画 ---

  function renderModelRow(preset: ModelPresetV1) {
    const isEditing = editingPresetId === preset.id;

    if (isEditing) {
      const { mode: epMode, isLoading: epLoading, models: providerModels } = getModelSelectionState(epProviderId);
      const modelError = epProviderId ? providerModelErrors[epProviderId] : "";
      return (
        <div class="model-row model-row-editing" key={preset.id} ref={activeRowRef}>
          <div class="model-row-edit-fields">
            <input
              value={epLabel}
              onInput={(event) => setEpLabel(event.currentTarget.value)}
              onBlur={() => handleEpLabelBlur(preset)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="名前"
              autoComplete="off"
            />
            <select value={epProviderId} onChange={(event) => handleEpProviderChange(preset, event.currentTarget.value)}>
              {shared.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label || getHostLabel(provider.baseUrl)}
                </option>
              ))}
            </select>
            <div class="connection-form-model-field">
              {epMode === "select" ? (
                <select value={epModel} onChange={(event) => handleEpModelSelectChange(preset, event.currentTarget.value)}>
                  <option value="" disabled>
                    {epLoading ? "取得中…" : "モデルを選択"}
                  </option>
                  {epModel && !providerModels.includes(epModel) ? <option value={epModel}>{epModel}</option> : null}
                  {providerModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={epModel}
                  onInput={(event) => setEpModel(event.currentTarget.value)}
                  onBlur={() => handleEpModelManualBlur(preset)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  placeholder="モデル名 (例: gpt-4o-mini)"
                  autoComplete="off"
                />
              )}
            </div>
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={epTemperature}
              onInput={(event) => setEpTemperature(event.currentTarget.value)}
              onBlur={() => handleEpTemperatureBlur(preset)}
              placeholder="温度 (temperature)"
              aria-label="温度 (temperature)"
              title="温度 (temperature)"
            />
            {modelError ? <p class="hint connection-form-warning">{modelError}</p> : null}
          </div>
        </div>
      );
    }

    const badges = getPresetBadges(preset);
    const isNetworkPreset = isNetworkPresetProvider(preset.providerId);
    return (
      <div class={`model-row${isNetworkPreset ? " model-row-network" : ""}`} key={preset.id}>
        <button type="button" class="model-row-main" onClick={() => handleOpenEditPreset(preset)}>
          <span class="model-row-label">{preset.label}</span>
          <span class="model-row-model">{preset.model}</span>
          <span class="model-row-provider">{getProviderLabel(preset.providerId)}</span>
        </button>
        {badges.length > 0 ? (
          <span class="model-row-badges">
            {badges.map((badge) => (
              <span key={badge} class="task-badge">
                {badge}
              </span>
            ))}
          </span>
        ) : null}
        <span
          class="preset-chip-remove model-row-remove"
          role="button"
          tabIndex={0}
          title="削除"
          onClick={(event) => {
            event.stopPropagation();
            handleRemovePresetRow(preset.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              handleRemovePresetRow(preset.id);
            }
          }}
        >
          <X size={13} />
        </span>
      </div>
    );
  }

  function renderAddModelRow() {
    const { mode: amMode, isLoading: amLoading, models: providerModels } = getModelSelectionState(amProviderId);
    const modelError = amProviderId ? providerModelErrors[amProviderId] : "";
    return (
      <div class="model-row model-row-editing model-row-add" ref={activeRowRef}>
        <div class="model-row-edit-fields">
          <input value={amLabel} onInput={(event) => setAmLabel(event.currentTarget.value)} placeholder="名前" autoComplete="off" />
          <select value={amProviderId} onChange={(event) => handleAmProviderChange(event.currentTarget.value)}>
            <option value="" disabled>
              接続先を選択
            </option>
            {shared.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label || getHostLabel(provider.baseUrl)}
              </option>
            ))}
          </select>
          <div class="connection-form-model-field">
            {!amProviderId ? (
              <select value="" disabled>
                <option value="">先に接続先を選択してください</option>
              </select>
            ) : amMode === "select" ? (
              <select value={amModel} onChange={(event) => handleAmModelSelectChange(event.currentTarget.value)}>
                <option value="" disabled>
                  {amLoading ? "取得中…" : "モデルを選択"}
                </option>
                {providerModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={amModel}
                onInput={(event) => setAmModel(event.currentTarget.value)}
                onBlur={() => handleSaveAddModel()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                placeholder="モデル名 (例: gpt-4o-mini)"
                autoComplete="off"
              />
            )}
          </div>
          {modelError ? <p class="hint connection-form-warning">{modelError}</p> : null}
        </div>
        <div class="model-row-add-actions">
          <button type="button" class="connection-form-btn" onClick={handleCancelAddModel}>
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  function renderAddModelTile() {
    if (shared.providers.length === 0) {
      return (
        <button type="button" class="grid-add-tile" disabled title="先に接続先を追加してください">
          <Plus size={16} />
          <span>モデルを追加</span>
        </button>
      );
    }
    if (addingModel) return renderAddModelRow();
    return (
      <button type="button" class="grid-add-tile" onClick={handleOpenAddModel}>
        <Plus size={16} />
        <span>モデルを追加</span>
      </button>
    );
  }

  return (
    <>
      <div class="server-list-header">
        <label>接続先</label>
      </div>
      <div class="settings-flat-section settings-flat-section-connection">
        {shared.providers.length === 0 && !addingProvider ? <p class="settings-hint">接続先が未設定です。</p> : null}
        <div class="model-row-list">
          {shared.providers.map((provider) => renderProviderRow(provider))}
          {renderAddProviderTile()}
        </div>
      </div>

      <div class="server-list-header">
        <label>モデル</label>
      </div>
      <div class="settings-flat-section settings-flat-section-models">
        {shared.providers.length > 0 && shared.presets.length === 0 && !addingModel ? (
          <p class="settings-hint">モデルが未設定です。</p>
        ) : null}
        <div class="model-row-list">
          {shared.presets.map((preset) => renderModelRow(preset))}
          {renderAddModelTile()}
        </div>
      </div>
    </>
  );
}
