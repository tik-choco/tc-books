import { afterEach, expect, it, vi } from "vitest";
import { encode, decode, EVENT_RAW } from "@tik-choco/mistai";
import { DELIVERY_RELIABLE_UNORDERED } from "@tik-choco/mistlib-web";
import { rooms } from "./network";

const transport = vi.hoisted(() => ({
  event: undefined as undefined | ((type: number, from: string, payload: unknown, room: string) => void),
  join: vi.fn().mockResolvedValue(undefined),
  leave: vi.fn(),
  send: vi.fn(),
}));
vi.mock("./mistClient", () => ({
  NODE_ID_STORAGE_KEY: "test-books-node",
  getNode: async () => ({ joinRoomAsync: transport.join, leaveRoom: transport.leave, sendMessage: transport.send }),
  subscribeEvent: (handler: typeof transport.event) => { transport.event = handler; return () => {}; },
}));

afterEach(() => { rooms.disconnectRoom("team"); localStorage.clear(); vi.clearAllMocks(); });

it("routes peer events and forwards delivery methods through the shared node", async () => {
  const handle = rooms.nodeScope("test-books-node");
  await handle.init();
  await handle.joinRoom("team");
  const bytes = new Uint8Array([1, 2, 3]);
  handle.sendMessage("peer", bytes, DELIVERY_RELIABLE_UNORDERED, "team");
  expect(transport.send).toHaveBeenCalledWith("peer", bytes, DELIVERY_RELIABLE_UNORDERED, "team");

  const consumer = rooms.roomConsumer("team");
  await consumer.connect("team");
  const sentBefore = transport.send.mock.calls.length;
  // Use WASM event codes directly to catch incorrect constant mappings.
  transport.event!(5, "peer", new TextEncoder().encode("entered"), "");
  expect(transport.send).toHaveBeenCalledTimes(sentBefore);
  transport.event!(2, "peer", new TextEncoder().encode("joined"), "");
  expect(transport.send.mock.calls.slice(sentBefore).some(call =>
    call[0] === "peer" && decode(call[1])?.type === "consumer_hello"
  )).toBe(true);

  transport.event!(EVENT_RAW, "peer", encode({ v: 1, type: "provider_hello", models: ["one"] }), "team");
  expect(consumer.status.phase).toBe("connected");
  transport.event!(6, "peer", new TextEncoder().encode("left"), "");
  expect(consumer.status.phase).toBe("connected");
  transport.event!(3, "peer", new TextEncoder().encode("left"), "");
  expect(consumer.status.phase).toBe("searching");
  handle.leaveRoom("team");
});
