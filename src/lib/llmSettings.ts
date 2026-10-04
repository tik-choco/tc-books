// Connections are shared by mistai; tasks and providing belong to this app.
import {
  emptyLlmConfig, isModelRef, loadLlmConfig, migrateSharedLlmConfig,
  presetIdToRef, providerKind, roomIdFromBaseUrl, saveLlmConfig,
  type ModelRefV1, type SharedLlmConfigV1,
} from "@tik-choco/mistai/llm-config";
import {
  REASONING_EFFORT_OPTIONS,
  type LlmLocalSettings, type LlmSettingsLocalAdapter, type ReasoningEffort, type TaskModelV1,
} from "@tik-choco/mistai/preact";

export type { ReasoningEffort };
export type BooksLocalSettings = LlmLocalSettings;
export const SETTINGS_KEY = "tc-books:settings-v1";
const taskIds = ["default", "vision", "extract"] as const;
const listeners = new Set<() => void>();

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function effort(value: unknown): ReasoningEffort {
  return REASONING_EFFORT_OPTIONS.includes(value as ReasoningEffort) ? value as ReasoningEffort : "none";
}
export function loadSharedConfig(): SharedLlmConfigV1 {
  const config = loadLlmConfig() ?? emptyLlmConfig();
  if (migrateSharedLlmConfig(config).changed) saveLlmConfig(config);
  return config;
}
function uniqueRefs(values: unknown[]): ModelRefV1[] {
  const seen = new Set<string>();
  return values.filter(isModelRef).filter(ref => {
    const key = JSON.stringify([ref.providerId, ref.model]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function loadLocalSettings(): BooksLocalSettings {
  const config = loadSharedConfig();
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    if (record(parsed)) raw = parsed;
  } catch { /* Missing or invalid app settings use the shared default. */ }
  const tasks: Record<string, TaskModelV1> = {};
  const migrated = record(raw.tasks);
  const previousTasks = migrated ? raw.tasks as Record<string, unknown> : {};
  for (const id of taskIds) {
    const previous = record(previousTasks[id]) ? previousTasks[id] as Record<string, unknown> : {};
    // Legacy extraction without an assignment followed OCR; capture it once.
    const oldId = id === "extract" ? raw.extractPresetId || raw.visionPresetId : raw[`${id}PresetId`];
    const presetId = typeof oldId === "string" ? oldId : "";
    const preset = config.presets.find(p => p.id === (presetId || config.defaultPresetId));
    const ref = migrated ? (isModelRef(previous.ref) ? previous.ref : undefined) : presetIdToRef(config, presetId);
    tasks[id] = {
      ...(ref ? { ref } : {}),
      reasoningEffort: effort(migrated ? previous.reasoningEffort : raw[`${id}ReasoningEffort`] ?? preset?.reasoningEffort),
    };
  }
  const roomProvide: BooksLocalSettings["roomProvide"] = {};
  if (record(raw.roomProvide)) {
    for (const [id, value] of Object.entries(raw.roomProvide)) {
      if (record(value)) roomProvide[id] = { enabled: value.enabled === true, shared: uniqueRefs(Array.isArray(value.shared) ? value.shared : []) };
    }
  }
  if (!migrated) {
    const room = config.providers.find(p => providerKind(p) === "room" && roomIdFromBaseUrl(p.baseUrl) === config.network.roomId.trim());
    if (room && !roomProvide[room.id]) {
      const ids = Array.isArray(raw.networkProviderPresetIds) ? raw.networkProviderPresetIds : [];
      roomProvide[room.id] = {
        enabled: raw.networkProviderEnabled === true,
        shared: uniqueRefs(ids.filter((id): id is string => typeof id === "string").map(id => presetIdToRef(config, id)))
          .filter(ref => config.providers.some(p => p.id === ref.providerId && providerKind(p) === "http")),
      };
    }
  }
  const settings = { tasks, roomProvide, recentModels: uniqueRefs(Array.isArray(raw.recentModels) ? raw.recentModels : []).slice(0, 8) };
  if (!migrated) saveLocalSettings(settings);
  return settings;
}
export function saveLocalSettings(settings: BooksLocalSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    listeners.forEach(cb => cb());
  } catch (error) {
    console.warn("tc-books: failed to persist local settings", error);
  }
}
export function subscribeLocalSettings(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (event: StorageEvent) => { if (event.key === SETTINGS_KEY || event.key === null) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}
export const localSettingsAdapter: LlmSettingsLocalAdapter = {
  get: loadLocalSettings, set: saveLocalSettings, subscribe: subscribeLocalSettings,
};
