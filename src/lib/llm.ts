// Chat-completion entry point for tc-books. Callers (OCR/vision aside, which
// always goes direct-HTTP per docs/CONTRACTS.md) call requestChatCompletion()
// with a preset id (resolved against the shared tc-shared-llm-config-v1
// config, see lib/llmConfig.ts) and don't care whether the request goes
// direct-to-API (via @tik-choco/mistai's streamChatCompletion) or over the AI
// Network (via the ConsumerClient in lib/network.ts). Both branches stream
// deltas through onDelta and resolve with the full reply. Modeled on
// tc-news's src/lib/llm.ts (itself modeled on tc-town's), minus the i18n
// layer — tc-books hardcodes Japanese UI copy per docs/CONTRACTS.md.

import {
  MistaiError,
  formatMistaiError,
  MESSAGES_JA,
  streamChatCompletion,
  type ChatMessage,
  type OpenAIConfig,
} from "@tik-choco/mistai";
import { emptyLlmConfig, loadLlmConfig, normalizeBaseUrl, resolvePreset, type ResolvedLlmTargetV1 } from "./llmConfig";
import { loadLocalSettings } from "./llmSettings";
import { consumerStatus, requestNetworkChat } from "./network";

export interface RequestChatOptions {
  onDelta?: (delta: string, full: string) => void;
}

// Maps a resolved preset+provider onto the shared library's upstream config.
// reasoningEffort is forwarded only when set and non-empty — an explicit ""
// means the preset opted out of sending the reasoning_effort parameter
// entirely.
function apiConfig(target: ResolvedLlmTargetV1): OpenAIConfig {
  const reasoningEffort = target.reasoningEffort?.trim();
  return {
    baseUrl: normalizeBaseUrl(target.baseUrl),
    apiKey: target.apiKey,
    model: target.model.trim(),
    temperature: target.temperature ?? 0.7,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

/**
 * Resolves `presetId` (or, if omitted / not found, the shared config's
 * defaultPresetId) against tc-shared-llm-config-v1 and requests a chat
 * completion. Routes through the AI Network consumer when it's enabled
 * (tc-books-local toggle) and currently connected (forwarding the preset's
 * model as the requested model, "" meaning "let the provider use its own");
 * otherwise calls the preset's provider directly. Throws a Japanese-language
 * Error if no preset/provider can be resolved, or on network/HTTP/empty-
 * response failure (formatted via formatMistaiError).
 */
export async function requestChatCompletion(
  presetId: string | undefined,
  messages: ChatMessage[],
  options?: { onDelta?: (delta: string, full: string) => void },
): Promise<string> {
  const cfg = loadLlmConfig() ?? emptyLlmConfig();
  const resolved = resolvePreset(cfg, presetId || undefined);
  if (!resolved) {
    throw new Error("LLM設定が見つかりません。設定画面でプロバイダとプリセットを追加してください。");
  }
  const local = loadLocalSettings();

  try {
    if (local.networkConsumerEnabled && consumerStatus().phase === "connected") {
      const content = await requestNetworkChat(
        cfg.network.roomId,
        messages,
        resolved.model.trim() || undefined,
        options?.onDelta,
      );
      if (!content.trim()) {
        throw new MistaiError("UPSTREAM_BAD_RESPONSE", "LLMの応答が空でした");
      }
      return content;
    }

    // streamChatCompletion's onDelta hands us the fragment only; accumulate
    // the running text ourselves so callers get the (delta, full) pair.
    let full = "";
    const onDelta = options?.onDelta;
    const content = await streamChatCompletion(
      apiConfig(resolved),
      messages,
      onDelta
        ? (delta) => {
            full += delta;
            onDelta(delta, full);
          }
        : undefined,
    );

    if (!content.trim()) {
      throw new MistaiError("UPSTREAM_BAD_RESPONSE", "LLMの応答が空でした");
    }

    return content;
  } catch (err) {
    throw new Error(formatMistaiError(err, MESSAGES_JA, "LLM呼び出しに失敗しました"));
  }
}
