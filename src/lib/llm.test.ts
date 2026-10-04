import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { emptyLlmConfig, LLM_CONFIG_KEY } from "@tik-choco/mistai/llm-config";
import { loadLocalSettings, saveLocalSettings } from "./llmSettings";
import { requestChatCompletion } from "./llm";
import { scanReceipt } from "./ocr";
import { rooms } from "./network";

vi.mock("./network", () => ({ rooms: { requestRoomChat: vi.fn(), requestRoomOpenAi: vi.fn() } }));

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  const config = emptyLlmConfig();
  config.providers = [
    { id: "http", label: "HTTP", baseUrl: "https://example.test/v1", apiKey: "key" },
    { id: "other", label: "Other", baseUrl: "https://other.test/v1", apiKey: "other-key" },
    { id: "room", label: "Room", baseUrl: "mist-network://team", apiKey: "" },
  ];
  config.defaultModel = { providerId: "http", model: "default-model" };
  localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
});
afterEach(() => vi.unstubAllGlobals());
const jsonReply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { "Content-Type": "application/json" } });

it("uses the chosen task ref and explicit none effort without temperature", async () => {
  const local = loadLocalSettings();
  local.tasks.default = { ref: { providerId: "other", model: "chosen-model" }, reasoningEffort: "none" };
  saveLocalSettings(local);
  const fetch = vi.fn().mockResolvedValue(jsonReply("OK")); vi.stubGlobal("fetch", fetch);
  expect(await requestChatCompletion(undefined, [{ role: "user", content: "test" }])).toBe("OK");
  expect(fetch.mock.calls[0][0]).toBe("https://other.test/v1/chat/completions");
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.model).toBe("chosen-model"); expect(body.reasoning_effort).toBe("none");
  expect(body).not.toHaveProperty("temperature");
});

it("routes room refs into their own room", async () => {
  vi.mocked(rooms.requestRoomChat).mockResolvedValue("OK");
  const messages = [{ role: "user" as const, content: "test" }];
  await requestChatCompletion({ providerId: "room", model: "remote-model" }, messages);
  expect(rooms.requestRoomChat).toHaveBeenCalledWith("team", messages, "remote-model", undefined);
});

it("resolves both receipt tasks independently with per-task effort", async () => {
  const local = loadLocalSettings();
  local.tasks.vision = { ref: { providerId: "other", model: "vision-model" }, reasoningEffort: "high" };
  local.tasks.extract = { ref: { providerId: "http", model: "extract-model" }, reasoningEffort: "max" };
  saveLocalSettings(local);
  const fetch = vi.fn().mockResolvedValueOnce(jsonReply("Receipt 100"))
    .mockResolvedValueOnce(jsonReply('{"total":100,"items":[]}')); vi.stubGlobal("fetch", fetch);
  expect((await scanReceipt("data:image/png;base64,AA==")).total).toBe(100);
  expect(fetch.mock.calls.map(call => call[0])).toEqual(["https://other.test/v1/chat/completions", "https://example.test/v1/chat/completions"]);
  const bodies = fetch.mock.calls.map(call => JSON.parse(call[1].body));
  expect(bodies.map(body => body.model)).toEqual(["vision-model", "extract-model"]);
  expect(bodies.map(body => body.reasoning_effort)).toEqual(["high", "max"]);
  bodies.forEach(body => expect(body).not.toHaveProperty("temperature"));
});

it("carries vision content through the room OpenAI tunnel", async () => {
  const local = loadLocalSettings();
  local.tasks.vision.ref = { providerId: "room", model: "remote-vision" }; saveLocalSettings(local);
  const fetch = vi.fn().mockResolvedValue(jsonReply('{"total":100}')); vi.stubGlobal("fetch", fetch);
  vi.mocked(rooms.requestRoomOpenAi).mockResolvedValue({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Receipt 100" } }] }) });
  await scanReceipt("data:image/png;base64,AA==");
  const [room, request] = vi.mocked(rooms.requestRoomOpenAi).mock.calls[0];
  expect(room).toBe("team");
  const body = JSON.parse(request.body!);
  expect(body.model).toBe("remote-vision"); expect(body.stream).toBe(false);
  expect(body.messages[1].content[1].image_url.url).toBe("data:image/png;base64,AA==");
  expect(body).not.toHaveProperty("temperature");
});
