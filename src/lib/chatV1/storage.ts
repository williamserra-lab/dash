// src/lib/chatV1/storage.ts
// Lightweight, file-backed storage for Chat V1 (operational console).
// NOTE: This is intentionally simple and transparent. It can be replaced by DB later.

import { promises as fs } from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";

export type ChatAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  path: string; // server path (relative)
  createdAt: string;
};

export type ChatContact = {
  id: string;
  name: string;
  whatsapp?: string; // digits only
  email?: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  contactId?: string;
  attachments?: ChatAttachment[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cached: boolean;
    // When true, totals are heuristic (provider didn't return usage or the flow didn't call a provider).
    isEstimated?: boolean;
    // Optional: what would have been charged if the response wasn't served from cache.
    // (Kept for transparency without impacting accounting.)
    estimatedTotalTokens?: number;
  };
};

export type ChatThread = {
  id: string;
  clientId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  contactId?: string;
  lastMessagePreview?: string;
};

type JsonFile<T> = { version: number; updatedAt: string; data: T };

const BASE_DIR = path.join(process.cwd(), "data", "chat_v1");

function safeClientId(clientId: string) {
  return (clientId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as JsonFile<T>;
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) return fallback;
    return (parsed as any).data as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const payload: JsonFile<T> = { version: 1, updatedAt: new Date().toISOString(), data };
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

export function estimateTokens(text: string): number {
  // Simple, deterministic heuristic: ~4 chars per token (roughly).
  // Good enough for operational visibility and cache economics.
  const t = (text || "").trim();
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / 4));
}

export function makeCacheKey(args: { clientId: string; threadId: string; contactId?: string; prompt: string; context: string }) {
  const h = createHash("sha256");
  h.update(args.clientId);
  h.update("|");
  h.update(args.threadId);
  h.update("|");
  h.update(args.contactId || "");
  h.update("|");
  h.update(args.context || "");
  h.update("|");
  h.update(args.prompt || "");
  return h.digest("hex");
}

function clientDir(clientId: string) {
  return path.join(BASE_DIR, safeClientId(clientId));
}

function threadsFile(clientId: string) {
  return path.join(clientDir(clientId), "threads.json");
}

function contactsFile(clientId: string) {
  return path.join(clientDir(clientId), "contacts.json");
}

function cacheFile(clientId: string) {
  return path.join(clientDir(clientId), "cache.json");
}

function messagesFile(clientId: string, threadId: string) {
  const safeThread = (threadId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(clientDir(clientId), "threads", safeThread, "messages.json");
}

export async function listThreads(clientId: string): Promise<ChatThread[]> {
  return await readJson(threadsFile(clientId), []);
}

export async function getThread(clientId: string, threadId: string): Promise<ChatThread | null> {
  const all = await listThreads(clientId);
  return all.find((t) => t.id === threadId) || null;
}

export async function createThread(clientId: string, title?: string, contactId?: string): Promise<ChatThread> {
  const now = new Date().toISOString();
  const thread: ChatThread = {
    id: randomUUID(),
    clientId,
    title: (title || "Nova conversa").trim() || "Nova conversa",
    createdAt: now,
    updatedAt: now,
    contactId: contactId || undefined,
    lastMessagePreview: "",
  };

  const all = await listThreads(clientId);
  all.unshift(thread);
  await writeJson(threadsFile(clientId), all);
  return thread;
}

export async function updateThread(clientId: string, threadId: string, patch: Partial<ChatThread>): Promise<ChatThread | null> {
  const all = await listThreads(clientId);
  const idx = all.findIndex((t) => t.id === threadId);
  if (idx < 0) return null;
  const next = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  all[idx] = next;
  await writeJson(threadsFile(clientId), all);
  return next;
}

export async function listMessages(clientId: string, threadId: string): Promise<ChatMessage[]> {
  return await readJson(messagesFile(clientId, threadId), []);
}

export async function appendMessage(clientId: string, threadId: string, msg: ChatMessage): Promise<void> {
  const all = await listMessages(clientId, threadId);
  all.push(msg);
  await writeJson(messagesFile(clientId, threadId), all);

  // Update thread preview
  const preview = (msg.content || "").slice(0, 140);
  await updateThread(clientId, threadId, { lastMessagePreview: preview });
}

export async function listContacts(clientId: string): Promise<ChatContact[]> {
  return await readJson(contactsFile(clientId), []);
}

export async function upsertContact(clientId: string, input: Partial<ChatContact> & { name: string }): Promise<ChatContact> {
  const now = new Date().toISOString();
  const all = await listContacts(clientId);
  const id = (input.id || "").trim() || randomUUID();

  const normalizedWhatsapp =
    typeof input.whatsapp === "string" ? input.whatsapp.replace(/\D/g, "") : undefined;

  const existingIdx = all.findIndex((c) => c.id === id);
  const next: ChatContact = {
    id,
    name: (input.name || "").trim(),
    whatsapp: normalizedWhatsapp || undefined,
    email: typeof input.email === "string" ? input.email.trim().toLowerCase() : undefined,
    createdAt: existingIdx >= 0 ? all[existingIdx].createdAt : now,
    updatedAt: now,
    active: input.active === false ? false : true,
  };

  if (!next.name) throw new Error("Nome do contato é obrigatório.");

  if (existingIdx >= 0) all[existingIdx] = next;
  else all.unshift(next);

  await writeJson(contactsFile(clientId), all);
  return next;
}

export async function deleteContact(clientId: string, contactId: string): Promise<boolean> {
  const all = await listContacts(clientId);
  const before = all.length;
  const after = all.filter((c) => c.id !== contactId);
  if (after.length === before) return false;
  await writeJson(contactsFile(clientId), after);
  return true;
}

type CacheEntry = {
  key: string;
  value: { assistant: string; usage: ChatMessage["usage"] };
  createdAt: string;
  lastAccessAt: string;
  expiresAt: string;
  sizeBytes: number;
};

const CACHE_TTL_MS = 86400000; // 24h sliding TTL (renews on hit)
const CACHE_MAX_ENTRIES = 2000;
const CACHE_MAX_BYTES = 26214400; // 25 MB per client

function calcEntrySizeBytes(e: Pick<CacheEntry, "key" | "value">): number {
  // Rough but deterministic: JSON size of key+value
  try {
    return Buffer.byteLength(JSON.stringify(e), "utf8");
  } catch {
    // Fallback: assistant content length
    return Buffer.byteLength(String((e as any)?.value?.assistant || ""), "utf8");
  }
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function parseMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function pruneCache(all: CacheEntry[], nowMs: number): CacheEntry[] {
  // Drop expired first
  let entries = all.filter((e) => {
    const exp = parseMs(e.expiresAt);
    return exp === 0 ? false : exp > nowMs;
  });

  // Ensure sizeBytes exists
  entries = entries.map((e) => {
    if (typeof e.sizeBytes === "number" && e.sizeBytes >= 0) return e;
    return { ...e, sizeBytes: calcEntrySizeBytes({ key: e.key, value: e.value }) };
  });

  // Sort by lastAccessAt desc (LRU: most recent first)
  entries.sort((a, b) => parseMs(b.lastAccessAt) - parseMs(a.lastAccessAt));

  // Enforce max entries
  if (entries.length > CACHE_MAX_ENTRIES) {
    entries = entries.slice(0, CACHE_MAX_ENTRIES);
  }

  // Enforce max bytes
  let total = entries.reduce((acc, e) => acc + (e.sizeBytes || 0), 0);
  if (total <= CACHE_MAX_BYTES) return entries;

  const kept: CacheEntry[] = [];
  for (const e of entries) {
    if (kept.length === 0) {
      kept.push(e);
      total = e.sizeBytes || 0;
      continue;
    }
    if (total + (e.sizeBytes || 0) > CACHE_MAX_BYTES) continue;
    kept.push(e);
    total += e.sizeBytes || 0;
  }

  // If even the first entry exceeds maxBytes, keep it anyway (better than empty)
  return kept.length ? kept : entries.slice(0, 1);
}

export async function getCache(clientId: string, key: string): Promise<CacheEntry | null> {
  const nowMs = Date.now();
  const file = cacheFile(clientId);
  const all: CacheEntry[] = await readJson(file, []);

  // Prune first (keeps file bounded over time)
  let pruned = pruneCache(all, nowMs);

  const idx = pruned.findIndex((e) => e.key === key);
  if (idx < 0) {
    // Persist pruning if it changed
    if (pruned.length !== all.length) await writeJson(file, pruned);
    return null;
  }

  const hit = pruned[idx];

  // Sliding TTL: renew on hit
  const renewed: CacheEntry = {
    ...hit,
    lastAccessAt: toIso(nowMs),
    expiresAt: toIso(nowMs + CACHE_TTL_MS),
  };

  // Move to front (LRU)
  pruned.splice(idx, 1);
  pruned.unshift(renewed);

  // Re-prune to enforce bytes/entries after renewal
  pruned = pruneCache(pruned, nowMs);
  await writeJson(file, pruned);

  return renewed;
}

export async function setCache(
  clientId: string,
  entry: { key: string; value: { assistant: string; usage: ChatMessage["usage"] } }
): Promise<void> {
  const nowMs = Date.now();
  const nowIso = toIso(nowMs);
  const file = cacheFile(clientId);

  const all: CacheEntry[] = await readJson(file, []);
  const filtered = all.filter((e) => e.key !== entry.key);

  const next: CacheEntry = {
    key: entry.key,
    value: entry.value,
    createdAt: nowIso,
    lastAccessAt: nowIso,
    expiresAt: toIso(nowMs + CACHE_TTL_MS),
    sizeBytes: calcEntrySizeBytes(entry),
  };

  filtered.unshift(next);

  const pruned = pruneCache(filtered, nowMs);
  await writeJson(file, pruned);
}

export async function saveUploadedFile(args: {
  clientId: string;
  threadId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<ChatAttachment> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const safeName = args.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const rel = path.join("data", "chat_v1", safeClientId(args.clientId), "threads", args.threadId, "uploads", `${id}_${safeName}`);
  const abs = path.join(process.cwd(), rel);

  await ensureDir(path.dirname(abs));
  await fs.writeFile(abs, args.buffer);

  return {
    id,
    filename: args.filename,
    mimeType: args.mimeType || "application/octet-stream",
    size: args.buffer.length,
    path: rel.replace(/\\/g, "/"),
    createdAt: now,
  };
}
