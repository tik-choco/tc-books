import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { emptyLlmConfig, LLM_CONFIG_KEY } from "@tik-choco/mistai/llm-config";
import { ConsumerService, createRoomConsumers } from "@tik-choco/mistai";
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

it.each(["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const)("streams room chat with task effort %s on llm_request", async reasoningEffort => {
  const local = loadLocalSettings();
  local.tasks.default = { ref: { providerId: "room", model: "remote-model" }, reasoningEffort };
  saveLocalSettings(local);
  const send = vi.fn<ConstructorParameters<typeof ConsumerService>[0]>();
  const consumer = new ConsumerService(send);
  const scoped = createRoomConsumers(() => { throw new Error("Unexpected transport initialization"); });
  vi.spyOn(scoped.roomConsumer("team"), "requestChat").mockImplementation((_room, messages, options) => consumer.request("provider", messages, options));
  vi.mocked(rooms.requestRoomChat).mockImplementationOnce(scoped.requestRoomChat);
  const messages = [{ role: "user" as const, content: "test" }];
  const onDelta = vi.fn();
  const reply = requestChatCompletion(undefined, messages, { onDelta });
  expect(rooms.requestRoomChat).toHaveBeenCalledWith("team", messages, { model: "remote-model", reasoningEffort, onDelta });
  const request = send.mock.calls[0][1];
  expect(request).toMatchObject({ type: "llm_request", model: "remote-model", messages, reasoning_effort: reasoningEffort });
  expect(request).not.toHaveProperty("temperature");
  if (request.type !== "llm_request") throw new Error("Expected llm_request");
  consumer.handleMessage({ v: 1, type: "llm_response_chunk", id: request.id, delta: "O", seq: 0 });
  expect(onDelta.mock.calls).toEqual([["O", "O"]]);
  consumer.handleMessage({ v: 1, type: "llm_response_chunk", id: request.id, delta: "K", seq: 1 });
  expect(onDelta.mock.calls).toEqual([["O", "O"], ["K", "OK"]]);
  consumer.handleMessage({ v: 1, type: "llm_response_done", id: request.id });
  expect(await reply).toBe("OK");
  expect(rooms.requestRoomOpenAi).not.toHaveBeenCalled();
});

it("lets an explicit room task effort override the default", async () => {
  const local = loadLocalSettings();
  local.tasks.default.reasoningEffort = "high"; saveLocalSettings(local);
  vi.mocked(rooms.requestRoomChat).mockResolvedValueOnce("OK");
  const messages = [{ role: "user" as const, content: "test" }];
  await requestChatCompletion({ providerId: "room", model: "remote-model" }, messages, { reasoningEffort: "none" });
  expect(rooms.requestRoomChat).toHaveBeenCalledWith("team", messages, { model: "remote-model", reasoningEffort: "none", onDelta: undefined });
  expect(rooms.requestRoomOpenAi).not.toHaveBeenCalled();
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
  local.tasks.vision = { ref: { providerId: "room", model: "remote-vision" }, reasoningEffort: "high" };
  local.tasks.extract = { ref: { providerId: "room", model: "remote-extract" }, reasoningEffort: "max" };
  saveLocalSettings(local);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  vi.mocked(rooms.requestRoomOpenAi).mockResolvedValue({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Receipt 100" } }] }) });
  const chunks = ["invalid", '{"total":', "100}"];
  const onDelta = vi.fn();
  vi.mocked(rooms.requestRoomChat)
    .mockImplementationOnce(async (_room, _messages, options) => {
      if (typeof options === "object") options.onDelta?.(chunks[0], chunks[0]);
      return chunks[0];
    })
    .mockImplementationOnce(async (_room, _messages, options) => {
      if (typeof options === "object") {
        options.onDelta?.(chunks[1], chunks[1]);
        options.onDelta?.(chunks[2], chunks[1] + chunks[2]);
      }
      return chunks[1] + chunks[2];
    });
  expect((await scanReceipt("data:image/png;base64,AA==", { onDelta })).total).toBe(100);
  expect(rooms.requestRoomOpenAi).toHaveBeenCalledTimes(1);
  const [room, request] = vi.mocked(rooms.requestRoomOpenAi).mock.calls[0];
  expect(room).toBe("team");
  expect(request.path).toBe("/chat/completions");
  const body = JSON.parse(request.body!);
  expect(body.model).toBe("remote-vision"); expect(body.stream).toBe(false);
  expect(body.reasoning_effort).toBe("high");
  expect(body.messages[1].content[1].image_url.url).toBe("data:image/png;base64,AA==");
  expect(body).not.toHaveProperty("temperature");
  expect(rooms.requestRoomChat).toHaveBeenCalledTimes(2);
  for (const [extractRoom, messages, options] of vi.mocked(rooms.requestRoomChat).mock.calls) {
    expect(extractRoom).toBe("team");
    expect(messages.every(message => typeof message.content === "string")).toBe(true);
    expect(options).toMatchObject({ model: "remote-extract", reasoningEffort: "max", onDelta: expect.any(Function) });
  }
  expect(vi.mocked(rooms.requestRoomChat).mock.calls[1][1].slice(-2)).toEqual([
    { role: "assistant", content: "invalid" }, { role: "user", content: expect.any(String) },
  ]);
  expect(onDelta.mock.calls).toEqual([["Receipt 100"], ["invalid"], ['{"total":'], ['{"total":100}']]);
  expect(fetch).not.toHaveBeenCalled();
});
