// Cross-app backup publisher. Continuously and automatically publishes a
// full-bundle JSON snapshot of *all* books (each book's journal entries +
// custom accounts — see MultiBookBundle in types.ts) onto the shared bus
// (lib/sharedBus.ts) under topic "books-backup", so tc-storage's drive (the
// sibling app, same origin in production) shows tc-books' data as a file
// without any user action. See protocol/docs/data-contracts/docs/SHARED_BUS.md
// for the shared-bus contract — tc-storage's consumer is built against the
// exact BooksBackupItem/BooksBackupMeta shape below (meta v:1, item id
// "tc-books-backup"), so keep that outer shape in sync deliberately rather
// than reshaping opportunistically. tc-storage treats the encrypted payload
// as an opaque file, so the inner JSON schema (MultiBookBundle v2, replacing
// the single-book BooksBundle v1) is free to evolve independently.
//
// Ported verbatim (structure + comments) from tc-town's
// src/lib/townBackupPublisher.ts (see docs/CONTRACTS.md). Encryption model
// mirrors tc-note's storage-drive-inbox publisher: the plaintext bundle is
// never uploaded to the mistlib block store as-is (it may be P2P-visible) —
// it's encrypted here with a fresh random AES-256-GCM key, the ciphertext is
// uploaded via mistClient's storageAdd to get a CID, and the key/iv travel
// inline in `meta` alongside the CID. Same-origin localStorage is the trust
// boundary for that inline key, per the established pattern.
//
// Change detection: loadMultiBookBundle()'s `exportedAt` timestamp changes on
// every build, so publishing unconditionally on every trigger would churn
// forever (new CID, new key, new bus event on every character/edit's
// debounce tick even when nothing meaningful changed). Instead this module
// hashes the bundle with `exportedAt` blanked out and compares that content
// signature against the last successfully published one (persisted in
// localStorage under tc-books:backup-publish-state-v1), skipping the publish
// (and leaving the stored signature untouched) when unchanged. The stored
// signature is only updated after a fully successful publish, so a failed
// attempt retries on the next trigger. subscribeBooks also fires on
// book-registry events (create/rename/switch active book), but those still
// go through this same signature check — a registry event with no actual
// content change (e.g. switching the active book) is a no-op publish.
//
// Best-effort throughout: guarded on Web Crypto availability, every failure
// is caught and logged via console.warn, never thrown — a failed publish
// must never break the app.

import { loadMultiBookBundle, subscribeBooks } from "./store";
import { publishShared } from "./sharedBus";
import { storageAdd } from "./mistClient";

const TOPIC = "books-backup";
const STATE_KEY = "tc-books:backup-publish-state-v1";
const ITEM_ID = "tc-books-backup";
const ITEM_NAME = "tc-books-backup.json";
const DEBOUNCE_MS = 2000;
const INITIAL_DELAY_MS = 5000; // must not block boot

// --- Small base64/hex encoding helpers -------------------------------------
// Inlined (rather than a shared crypto/cryptoEncoding.ts, which tc-books
// doesn't have) since booksBackupPublisher.ts is the only interop file that
// needs them. Copied verbatim from tc-town/src/crypto/cryptoEncoding.ts.

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// --- Fixed cross-app contract shapes ----------------------------------------

/** Fixed cross-app contract — tc-storage's books-backup consumer is built against this exact shape. */
export interface BooksBackupItem {
  id: "tc-books-backup";
  name: "tc-books-backup.json";
  mimeType: "application/json";
  /** Plaintext byte length. */
  size: number;
  /** SHA-256 hex of the plaintext bundle JSON bytes. */
  checksum: string;
  /** mistlib storage_add CID of the AES-256-GCM ciphertext. */
  cid: string;
  /** Base64 raw AES-256-GCM key material (fresh throwaway key per publish). */
  key: string;
  /** Base64 96-bit AES-GCM IV. */
  iv: string;
  /** ISO 8601 timestamp. */
  updatedAt: string;
}

/** Fixed cross-app contract — tc-storage's books-backup consumer is built against this exact shape. */
export interface BooksBackupMeta {
  v: 1;
  updatedAt: string;
  item: BooksBackupItem;
}

// --- Publish-state (last-published content signature) ----------------------

interface PublishState {
  v: 1;
  signature: string;
}

function readPublishState(): PublishState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const s = parsed as Record<string, unknown>;
    if (s.v !== 1 || typeof s.signature !== "string" || !s.signature) return null;
    return { v: 1, signature: s.signature };
  } catch {
    return null;
  }
}

function writePublishState(state: PublishState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("booksBackupPublisher: failed to persist publish state", error);
  }
}

// --- Bundle build + publish ---------------------------------------------------

const textEncoder = new TextEncoder();

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return hex(new Uint8Array(digest));
}

/** Encrypts and publishes the current backup bundle if its content changed since the last successful publish. Throws on failure — callers must catch. */
async function publishBundleUnsafe(): Promise<void> {
  if (typeof crypto === "undefined" || !crypto.subtle) return;

  const bundle = loadMultiBookBundle();

  // exportedAt is volatile (changes on every build) — exclude it from the
  // change-detection signature so an otherwise-identical bundle doesn't
  // trigger a republish.
  const signature = await sha256Hex(textEncoder.encode(JSON.stringify({ ...bundle, exportedAt: "" })));
  if (readPublishState()?.signature === signature) return;

  const json = JSON.stringify(bundle, null, 2);
  const plaintext = textEncoder.encode(json);
  const checksum = await sha256Hex(plaintext);

  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-GCM", false, ["encrypt"]);
  const cipherText = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, cryptoKey, plaintext as BufferSource),
  );

  const cid = await storageAdd(cipherText);

  const updatedAt = new Date().toISOString();
  const meta: BooksBackupMeta = {
    v: 1,
    updatedAt,
    item: {
      id: ITEM_ID,
      name: ITEM_NAME,
      mimeType: "application/json",
      size: plaintext.byteLength,
      checksum,
      cid,
      key: bytesToBase64(keyBytes),
      iv: bytesToBase64(iv),
      updatedAt,
    },
  };

  publishShared(TOPIC, "", meta as unknown as Record<string, unknown>);

  // Only recorded after every step above succeeded, so a failure anywhere
  // (network, storage_add, quota) leaves the old signature in place and the
  // next trigger retries from scratch.
  writePublishState({ v: 1, signature });
}

async function publishBundle(): Promise<void> {
  try {
    await publishBundleUnsafe();
  } catch (error) {
    console.warn("booksBackupPublisher: failed to publish books backup", error);
  }
}

// --- Serialized, debounced trigger -----------------------------------------
// Two debounce fires must never race each other into overlapping
// encrypt/storage_add/publish calls (which could publish an older bundle
// after a newer one) — every publish attempt is chained onto the previous
// one's completion, same as tc-storage's appNoteDocInbox `inFlight` pattern.

let inFlight: Promise<void> = Promise.resolve();

function enqueuePublish(): void {
  inFlight = inFlight.then(() => publishBundle()).catch(() => {});
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced re-publish trigger — call after any app-local data mutation that should eventually surface in the backup. */
function scheduleBooksBackupPublish(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    enqueuePublish();
  }, DEBOUNCE_MS);
}

let started = false;

/**
 * Starts the books-backup publisher: publishes once shortly after startup
 * (delayed so the lazy mist node connection never blocks boot), then
 * re-publishes (debounced) on every journal/account change across any book,
 * as well as book-registry events (create/rename/switch active book)
 * (lib/store.ts's subscribeBooks) — though a registry event that doesn't
 * change any book's content is skipped by the signature check above.
 * Idempotent — safe to call more than once (subsequent calls are no-ops).
 */
export function startBooksBackupPublisher(): void {
  if (started) return;
  started = true;

  if (typeof window !== "undefined") {
    setTimeout(() => enqueuePublish(), INITIAL_DELAY_MS);
  }

  subscribeBooks(() => scheduleBooksBackupPublish());
}

export { TOPIC as booksBackupTopic };
