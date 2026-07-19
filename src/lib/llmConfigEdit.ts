// Editing helpers for the AI接続 tab's provider/preset flat card grid: plain
// CRUD over `config.providers`/`config.presets`. Ported from tc-translate's
// src/lib/llmConfigEdit.ts (see tc-docs/drafts/llm-settings-common-v1.md
// §5.1) — the user explicitly manages a named list of connections/presets
// here, so unlike the one-time legacy-settings migration (which must only
// ever append via ensureProvider/ensurePreset, never overwrite another app's
// entries) this is ordinary user-driven CRUD, including delete. Callers are
// responsible for calling saveLlmConfig() afterwards.

import type { LlmProviderV1, ModelPresetV1, SharedLlmConfigV1 } from "./llmConfig";

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the Math.random fallback below
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createProvider(config: SharedLlmConfigV1, label: string): string {
  const provider: LlmProviderV1 = { id: newId(), label, baseUrl: "", apiKey: "" };
  config.providers.push(provider);
  return provider.id;
}

export function patchProvider(config: SharedLlmConfigV1, id: string, patch: Partial<Omit<LlmProviderV1, "id">>): void {
  const provider = config.providers.find((entry) => entry.id === id);
  if (provider) Object.assign(provider, patch);
}

/** Removes a provider. Any preset still referencing it keeps its (now dangling) providerId — resolvePreset degrades that to "no target" rather than throwing. */
export function deleteProvider(config: SharedLlmConfigV1, id: string): void {
  config.providers = config.providers.filter((entry) => entry.id !== id);
}

export function createPreset(config: SharedLlmConfigV1, providerId: string, label: string): string {
  const preset: ModelPresetV1 = { id: newId(), label, providerId, model: "", temperature: 0.7 };
  config.presets.push(preset);
  // First preset ever created becomes the default automatically — otherwise
  // every task (既定/OCR/解析) would keep resolving to nothing even though a
  // preset now exists.
  if (!config.defaultPresetId) config.defaultPresetId = preset.id;
  return preset.id;
}

export function patchPreset(config: SharedLlmConfigV1, id: string, patch: Partial<Omit<ModelPresetV1, "id">>): void {
  const preset = config.presets.find((entry) => entry.id === id);
  if (preset) Object.assign(preset, patch);
}

/** Removes a preset. If it was the default, the next remaining preset (if any) takes over; task pointers (visionPresetId etc.) referencing it are left to the caller to clear. */
export function deletePreset(config: SharedLlmConfigV1, id: string): void {
  config.presets = config.presets.filter((entry) => entry.id !== id);
  if (config.defaultPresetId === id) config.defaultPresetId = config.presets[0]?.id ?? "";
}
