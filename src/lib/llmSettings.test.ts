import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLM_CONFIG_KEY, emptyLlmConfig, resolveModel } from "@tik-choco/mistai/llm-config";
import { loadLocalSettings, loadSharedConfig, SETTINGS_KEY } from "./llmSettings";
import { AI_MESSAGES } from "./llmMessages";

beforeEach(() => localStorage.clear());

function seed() {
  const config = emptyLlmConfig();
  config.providers = [
    { id: "http", label: "Endpoint", baseUrl: "https://example.test/v1", apiKey: "", models: ["cached"] },
    { id: "disabled", label: "Disabled", baseUrl: "https://disabled.test/v1", apiKey: "", enabled: false },
    { id: "mirror", label: "Room", baseUrl: "mist-network://team", apiKey: "" },
  ];
  config.presets = [
    { id: "p1", label: "Default", providerId: "http", model: "text-model", reasoningEffort: "high", temperature: .7 },
    { id: "p2", label: "OCR", providerId: "disabled", model: "image-model", reasoningEffort: "max" },
    { id: "p3", label: "Mirror", providerId: "mirror", model: "remote-model" },
  ];
  config.defaultPresetId = "p1";
  config.network.roomId = "team";
  config.tts = { providerId: "http", model: "speech-model", voice: "voice-a", speed: 1.2 };
  localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
  return config;
}

describe("model reference migration", () => {
  it("preserves legacy fields, task effort and disabled refs; ignores room mirrors", () => {
    const original = seed();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      visionPresetId: "p2", extractPresetId: "p1", visionReasoningEffort: "none",
      networkProviderEnabled: true, networkProviderPresetIds: ["p1", "p1", "p3"],
    }));
    const local = loadLocalSettings(), shared = loadSharedConfig();
    expect(shared.defaultModel).toEqual({ providerId: "http", model: "text-model" });
    expect(shared.presets).toEqual(original.presets);
    expect(shared.defaultPresetId).toBe(original.defaultPresetId);
    expect(shared.network).toEqual(original.network);
    expect(shared.tts).toEqual(original.tts);
    expect(local.tasks.vision).toEqual({ ref: { providerId: "disabled", model: "image-model" }, reasoningEffort: "none" });
    expect(local.tasks.extract.reasoningEffort).toBe("high");
    expect(local.tasks.default.reasoningEffort).toBe("high");
    expect(local.roomProvide.mirror).toEqual({ enabled: true, shared: [{ providerId: "http", model: "text-model" }] });
    expect(resolveModel(shared, local.tasks.vision.ref)?.model).toBe("text-model");
    expect(local.tasks.vision.ref?.providerId).toBe("disabled");
  });

  it("migrates once, retains dangling refs and the old OCR extraction fallback", () => {
    seed();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ visionPresetId: "p2" }));
    const local = loadLocalSettings();
    expect(local.tasks.extract.ref).toEqual(local.tasks.vision.ref);
    expect(local.tasks.vision.reasoningEffort).toBe("max");
    const before = [localStorage.getItem(SETTINGS_KEY), localStorage.getItem(LLM_CONFIG_KEY)];
    const writes = vi.spyOn(Storage.prototype, "setItem");
    loadLocalSettings(); loadSharedConfig();
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
    expect([localStorage.getItem(SETTINGS_KEY), localStorage.getItem(LLM_CONFIG_KEY)]).toEqual(before);
    const config = loadSharedConfig();
    config.providers = config.providers.filter(p => p.id !== "disabled");
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
    expect(loadLocalSettings().tasks.vision.ref).toEqual(local.tasks.vision.ref);
  });

  it("does not revive cleared refs or retired room mirrors", () => {
    seed();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ visionPresetId: "p3" }));
    expect(loadLocalSettings().tasks.vision.ref).toBeUndefined();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ tasks: {}, visionPresetId: "p2" }));
    expect(loadLocalSettings().tasks.vision.ref).toBeUndefined();
  });
});

describe("AI locale completeness", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{([^}]+)\}/g)].map(m => m[1]).sort();
  for (const [locale, messages] of Object.entries(AI_MESSAGES)) {
    it(`${locale} has every key, no orphan keys and matching placeholders`, () => {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(AI_MESSAGES.en).sort());
      for (const key of Object.keys(AI_MESSAGES.en) as Array<keyof typeof AI_MESSAGES.en>) {
        expect(messages[key]?.trim()).toBeTruthy();
        expect(placeholders(messages[key])).toEqual(placeholders(AI_MESSAGES.en[key]));
      }
    });
  }
});
