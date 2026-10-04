import { streamChatCompletion, type ChatMessage } from "@tik-choco/mistai";
import { providerKind, resolveModel, roomIdFromBaseUrl, type ModelRefV1 } from "@tik-choco/mistai/llm-config";
import { loadLocalSettings, loadSharedConfig, type ReasoningEffort } from "./llmSettings";
import { aiMessages } from "./llmMessages";
import { rooms } from "./network";

export async function requestChatCompletion(
  ref: ModelRefV1 | undefined,
  messages: ChatMessage[],
  options?: { onDelta?: (delta: string, full: string) => void; reasoningEffort?: ReasoningEffort },
): Promise<string> {
  const local = loadLocalSettings();
  const target = resolveModel(loadSharedConfig(), ref ?? local.tasks.default.ref);
  if (!target) throw new Error(aiMessages().modelRequired);
  let full = "";
  const content = providerKind(target) === "room"
    ? await rooms.requestRoomChat(roomIdFromBaseUrl(target.baseUrl), messages, target.model, options?.onDelta)
    : await streamChatCompletion(
      { ...target, reasoningEffort: options?.reasoningEffort ?? local.tasks.default.reasoningEffort },
      messages,
      options?.onDelta ? delta => { full += delta; options.onDelta!(delta, full); } : undefined,
    );
  if (!content.trim()) throw new Error(aiMessages().emptyResponse);
  return content;
}
