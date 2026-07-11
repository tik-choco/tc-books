// Thin singleton wrapper around the vendored mistlib-wasm build (see
// scripts/fetch-mistlib.mjs). mistlib-wasm only supports one active
// MistNode per page, and its node.onEvent()/onMediaEvent() each accept a
// single handler that replaces any previous one — so this module owns the
// one real MistNode instance and re-broadcasts events to any number of
// listeners registered via subscribeEvent()/subscribeMediaEvent().
//
// Ported from tc-news's src/lib/mistClient.ts (see docs/CONTRACTS.md).

import {
  MistNode,
  EVENT_RAW,
  storage_add,
  storage_get,
  type MediaEventPayload,
} from "../vendor/mistlib/wrappers/web/index.js";

export {
  EVENT_NEIGHBORS,
  EVENT_PEER_CONNECTED,
  EVENT_PEER_DISCONNECTED,
  MEDIA_EVENT_TRACK_ADDED,
  MEDIA_EVENT_TRACK_REMOVED,
  DELIVERY_RELIABLE,
  DELIVERY_UNRELIABLE,
} from "../vendor/mistlib/wrappers/web/index.js";
export { EVENT_RAW };
export type { MediaEventPayload };

/** Fixed storage_add namespace for all tc-books shared-bus payloads (backups etc). */
const SHARED_STORAGE_NAME = "tc-shared";

// Also handed to @tik-choco/mistai's ConsumerClient (see lib/network.ts) as
// its nodeIdStorageKey so the AI Network session presents the same node
// identity as the rest of tc-books.
export const NODE_ID_STORAGE_KEY = "tc-books:node-id";

export function localNodeId(): string {
  let id = localStorage.getItem(NODE_ID_STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(NODE_ID_STORAGE_KEY, id);
  }
  return id;
}

// roomId is the on-the-wire swarm topic — the raw room id, unmodified — the
// event arrived on, or "" for node-wide events. Subscribers use it to ignore
// traffic from rooms other than the one they're bound to — without it, a peer
// that has joined several rooms would mix every room's messages into whichever
// room it is currently viewing (see the per-hook roomId filters).
type EventListener = (eventType: number, fromId: string, payload: unknown, roomId: string) => void;
type MediaListener = (eventType: number, payload: MediaEventPayload) => void;

let node: InstanceType<typeof MistNode> | null = null;
let initPromise: Promise<InstanceType<typeof MistNode>> | null = null;
const eventListeners = new Set<EventListener>();
const mediaListeners = new Set<MediaListener>();

export async function getNode(): Promise<InstanceType<typeof MistNode>> {
  if (node) return node;
  if (!initPromise) {
    initPromise = (async () => {
      const n = new MistNode(localNodeId());
      await n.init();
      n.onEvent((eventType, fromId, payload, roomId) => {
        eventListeners.forEach((l) => l(eventType, fromId, payload, roomId ?? ""));
      });
      n.onMediaEvent((eventType, payload) => {
        mediaListeners.forEach((l) => l(eventType, payload));
      });
      node = n;
      return n;
    })();
  }
  return initPromise;
}

/** Returns an unsubscribe function. */
export function subscribeEvent(listener: EventListener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

/** Returns an unsubscribe function. */
export function subscribeMediaEvent(listener: MediaListener): () => void {
  mediaListeners.add(listener);
  return () => mediaListeners.delete(listener);
}

export function decodeRawPayload(payload: unknown): unknown | null {
  try {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload as ArrayBuffer);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function isRawEvent(eventType: number): boolean {
  return eventType === EVENT_RAW;
}

/** Uploads `bytes` to the mistlib block store under the shared "tc-shared" namespace. Resolves with the CID. */
export function storageAdd(bytes: Uint8Array): Promise<string> {
  return storage_add(SHARED_STORAGE_NAME, bytes);
}

/** Fetches bytes previously uploaded via storageAdd (or storage_add), by CID. */
export function storageGet(cid: string): Promise<Uint8Array> {
  return storage_get(cid);
}
