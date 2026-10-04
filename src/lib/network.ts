import { createRoomConsumers, createSharedNodeScope, type MistNodeLike } from "@tik-choco/mistai";
import { getNode, subscribeEvent, NODE_ID_STORAGE_KEY } from "./mistClient";

// Keep the backup/storage singleton. mistai owns room multiplexing and providing.
class BooksMistNode implements MistNodeLike {
  private node: Awaited<ReturnType<typeof getNode>> | undefined;
  private handler: Parameters<MistNodeLike["onEvent"]>[0] | undefined;
  async init(): Promise<void> {
    this.node = await getNode();
    subscribeEvent((...args) => this.handler?.(...args));
  }
  onEvent(handler: Parameters<MistNodeLike["onEvent"]>[0]): void { this.handler = handler; }
  joinRoom(room: string): Promise<void> { return this.joinRoomAsync(room); }
  async joinRoomAsync(room: string): Promise<void> { await this.node!.joinRoomAsync(room); }
  leaveRoom(room?: string): void { if (room) this.node?.leaveRoom(room); }
  sendMessage(to: string | null | undefined, payload: Uint8Array, delivery?: number, room?: string): void {
    this.node?.sendMessage(to, payload, delivery, room);
  }
}
export const rooms = createRoomConsumers(createSharedNodeScope(() => new BooksMistNode()), {
  nodeIdStorageKey: NODE_ID_STORAGE_KEY,
});
