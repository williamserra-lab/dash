// src/lib/evolutionWebhook.ts
// Recebe payloads de webhook do Evolution API e registra em disco (append-only),
// sem depender de banco. Mantém compatibilidade de build e facilita debug.

export const runtime = "nodejs";

import { NextRequest } from "next/server";
import crypto from "crypto";
import { getDataPath, readJsonArray, writeJsonArray } from "./jsonStore";

export type EvolutionInboxEntry = {
  id: string;
  at: string; // ISO
  instance?: string;
  event?: string;
  remoteJid?: string;
  fromMe?: boolean;
  keyId?: string;
  messageTimestamp?: number | string;
  text?: string;
  raw: unknown;
};

const INBOX_FILE = getDataPath("evolution_inbox.json");

function safeString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function extractText(msg: any): string | undefined {
  if (!msg) return undefined;

  // Baileys common shapes
  const direct = safeString(msg?.conversation);
  if (direct) return direct;

  const ext = safeString(msg?.extendedTextMessage?.text);
  if (ext) return ext;

  const imageCap = safeString(msg?.imageMessage?.caption);
  if (imageCap) return imageCap;

  const videoCap = safeString(msg?.videoMessage?.caption);
  if (videoCap) return videoCap;

  const documentCap = safeString(msg?.documentMessage?.caption);
  if (documentCap) return documentCap;

  const buttons = safeString(msg?.buttonsResponseMessage?.selectedDisplayText);
  if (buttons) return buttons;

  const list = safeString(msg?.listResponseMessage?.title) || safeString(msg?.listResponseMessage?.singleSelectReply?.selectedRowId);
  if (list) return list;

  return undefined;
}

function normalizePayload(payload: any): EvolutionInboxEntry[] {
  // Evolution costuma enviar { event, instance, data } ou payload direto de "data"
  const event = safeString(payload?.event) || safeString(payload?.type);
  const instance = safeString(payload?.instance) || safeString(payload?.instanceName);

  const candidates: any[] = [];

  if (payload?.data) candidates.push(payload.data);
  // Alguns formatos podem mandar "message" ou "messages"
  if (payload?.message) candidates.push(payload.message);
  if (Array.isArray(payload?.messages)) candidates.push(...payload.messages);

  // Se nada, trata o próprio payload como candidato
  if (candidates.length === 0) candidates.push(payload);

  const now = new Date().toISOString();
  const out: EvolutionInboxEntry[] = [];

  for (const c of candidates) {
    const key = c?.key || c?.data?.key || undefined;
    const msg = c?.message || c?.data?.message || undefined;

    const remoteJid =
      safeString(key?.remoteJid) ||
      safeString(c?.remoteJid) ||
      safeString(c?.data?.remoteJid);

    const fromMe =
      typeof key?.fromMe === "boolean"
        ? key.fromMe
        : typeof c?.fromMe === "boolean"
          ? c.fromMe
          : undefined;

    const keyId =
      safeString(key?.id) ||
      safeString(c?.keyId) ||
      safeString(c?.id);

    const messageTimestamp =
      c?.messageTimestamp ??
      c?.data?.messageTimestamp ??
      c?.timestamp;

    const text = extractText(msg) || extractText(c?.data?.message);

    out.push({
      id: crypto.randomUUID(),
      at: now,
      instance,
      event,
      remoteJid,
      fromMe,
      keyId,
      messageTimestamp,
      text,
      raw: c,
    });
  }

  return out;
}


// Exposição do normalizador para reutilização (ex.: bridge Evolution -> inbound canônico).
// Não muda comportamento: apenas reaproveita a mesma lógica de parse usada no recorder.
export function parseEvolutionWebhookPayload(payload: unknown): EvolutionInboxEntry[] {
  return normalizePayload(payload as any);
}

export async function recordEvolutionWebhook(payload: unknown): Promise<{ recorded: number }> {
  const entries = normalizePayload(payload as any);

  const existing = await readJsonArray<EvolutionInboxEntry>(INBOX_FILE);
  const merged = [...existing, ...entries];

  // Proteção simples contra crescimento infinito
  const MAX = 20000;
  const trimmed = merged.length > MAX ? merged.slice(merged.length - MAX) : merged;

  await writeJsonArray(INBOX_FILE, trimmed);

  return { recorded: entries.length };
}

// Verificação opcional via segredo compartilhado.
// Aceita:
// - Header: x-evolution-secret / x-webhook-secret / authorization: Bearer <secret>
// - Query: ?secret=<secret>
export async function verifyEvolutionWebhookSecret(req: NextRequest, expected: string): Promise<boolean> {
  const url = new URL(req.url);

  const q = url.searchParams.get("secret");
  if (q && timingSafeEqual(q, expected)) return true;

  const h1 = req.headers.get("x-evolution-secret");
  if (h1 && timingSafeEqual(h1, expected)) return true;

  const h2 = req.headers.get("x-webhook-secret");
  if (h2 && timingSafeEqual(h2, expected)) return true;

  const auth = req.headers.get("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1] && timingSafeEqual(m[1], expected)) return true;
  }

  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
