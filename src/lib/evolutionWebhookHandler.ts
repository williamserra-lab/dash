// src/lib/evolutionWebhookHandler.ts
import { NextRequest, NextResponse } from "next/server";

import { appendStoredMessage } from "@/lib/nextiaMessageStore";
import { getEvolutionTenantClientId } from "@/lib/evolutionConfig";
import { findClientIdByInstanceName } from "@/lib/whatsappInstances";
import { backfillConversationFromEvolution } from "@/lib/evolutionBackfill";
import { getClientById } from "@/lib/clientsRegistry";
import { handleWhatsappInboundFlow } from "@/lib/whatsappInboundFlow";
import { seenRecently } from "@/lib/recentDedupe";
import { isMarketingOptOutCommand } from "@/lib/marketingOptOut";
import { getContactByIdentifier, upsertContactFromInbound, setContactOptOut } from "@/lib/contacts";
import { sendWhatsappSystemMessage } from "@/lib/whatsapp";
import { logAnalyticsEvent } from "@/lib/analytics";

function getSecret(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get("secret");
}

function extractInstanceName(payload: any): string | null {
  const raw = payload?.raw ?? payload;
  const candidates = [
    payload?.instance,
    payload?.data?.instance,
    raw?.instance,
    raw?.data?.instance,
    raw?.event?.instance,
    raw?.data?.event?.instance,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function safeString(v: any): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function pickText(raw: any): string | null {
  // Evolution payloads vary; try common locations
  const msg =
    raw?.message ??
    raw?.messages?.[0]?.message ??
    raw?.data?.message ??
    raw?.data?.messages?.[0]?.message;
  if (!msg) return null;

  if (typeof msg?.conversation === "string") return msg.conversation;
  if (typeof msg?.extendedTextMessage?.text === "string") return msg.extendedTextMessage.text;

  const cap = msg?.imageMessage?.caption || msg?.videoMessage?.caption || msg?.documentMessage?.caption;
  if (typeof cap === "string" && cap.trim()) return cap;

  return null;
}

function looksLikeMessagePayload(payload: any): boolean {
  const raw = payload?.raw ?? payload;
  const key = raw?.key ?? raw?.data?.key ?? raw?.data?.messages?.[0]?.key ?? raw?.messages?.[0]?.key;
  const remoteJid = key?.remoteJid || raw?.remoteJid || raw?.data?.remoteJid;
  const msg =
    raw?.message ??
    raw?.messages?.[0]?.message ??
    raw?.data?.message ??
    raw?.data?.messages?.[0]?.message;
  return Boolean(remoteJid && msg);
}

function extractKey(raw: any): any {
  return raw?.key ?? raw?.data?.key ?? raw?.data?.messages?.[0]?.key ?? raw?.messages?.[0]?.key ?? {};
}

function extractRemoteJid(raw: any): string {
  const key = extractKey(raw);
  return safeString(key?.remoteJid || raw?.remoteJid || raw?.data?.remoteJid || "");
}

function extractKeyId(raw: any): string {
  const key = extractKey(raw);
  return safeString(key?.id || raw?.keyId || raw?.id || raw?.data?.id || "");
}

function extractFromMe(raw: any): boolean {
  const key = extractKey(raw);
  return Boolean(key?.fromMe ?? raw?.fromMe ?? raw?.data?.fromMe ?? false);
}

function extractMessageTimestamp(raw: any, payload: any): number | null {
  const tsRaw = raw?.messageTimestamp ?? raw?.data?.messageTimestamp ?? payload?.messageTimestamp;
  if (typeof tsRaw === "number") return tsRaw;
  if (typeof tsRaw === "string") {
    const n = Number(tsRaw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractParticipant(raw: any): string {
  const key = extractKey(raw);
  return safeString(key?.participant || raw?.participant || raw?.data?.participant || "");
}

function extractMentionedJids(raw: any): string[] {
  const msg =
    raw?.message ??
    raw?.messages?.[0]?.message ??
    raw?.data?.message ??
    raw?.data?.messages?.[0]?.message;

  const mentioned = msg?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (Array.isArray(mentioned)) return mentioned.filter((x) => typeof x === "string");
  return [];
}

function getGroupInboundMode(): "ignore" | "trigger" | "full" {
  // Legacy shortcut: NEXTIA_IGNORE_GROUP_MESSAGES=true behaves as mode=ignore.
  const legacyIgnore = String(process.env.NEXTIA_IGNORE_GROUP_MESSAGES || "false").toLowerCase() === "true";
  if (legacyIgnore) return "ignore";

  const mode = safeString(process.env.NEXTIA_GROUP_INBOUND_MODE || "").trim().toLowerCase();
  if (mode === "ignore" || mode === "trigger" || mode === "full") return mode as any;

  // Safe default: only process group inbound when explicitly triggered.
  return "trigger";
}

function parseMsEnv(name: string, defaultMs: number): number {
  const raw = safeString((process.env as any)[name]).trim();
  if (!raw) return defaultMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return defaultMs;
  return Math.floor(n);
}

function isTriggeredGroupMessage(input: { text: string; mentionedJids: string[] }): boolean {
  const t = (input.text || "").trim();
  if (!t) return false;

  const prefix = safeString(process.env.NEXTIA_GROUP_TRIGGER_PREFIX || "").trim() || "!nextia";
  if (prefix && t.toLowerCase().startsWith(prefix.toLowerCase())) return true;

  const regexRaw = safeString(process.env.NEXTIA_GROUP_TRIGGER_REGEX || "").trim();
  if (regexRaw) {
    try {
      const r = new RegExp(regexRaw, "i");
      if (r.test(t)) return true;
    } catch {
      // ignore invalid regex
    }
  }

  const botJid = safeString(process.env.NEXTIA_BOT_JID || "").trim();
  if (botJid && input.mentionedJids.includes(botJid)) return true;

  return false;
}


function getSoftDedupeTtlMs(): number {
  // Set NEXTIA_SOFT_DEDUPE_TTL_MS=0 to disable.
  const raw = safeString(process.env.NEXTIA_SOFT_DEDUPE_TTL_MS).trim();
  if (!raw) return 15000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 15000;
  return Math.floor(n);
}

function buildSoftDedupeKey(input: {
  clientId: string;
  instance: string;
  remoteJid: string;
  keyId: string;
  messageTimestamp: number | null;
  text: string | null;
}): string {
  // Prefer stable id if present.
  if (input.keyId) {
    return `msg:${input.clientId}:${input.instance}:${input.keyId}`;
  }

  // Fallback: fingerprint (best-effort).
  const ts = input.messageTimestamp == null ? "" : String(input.messageTimestamp);
  const t = (input.text || "").trim().slice(0, 64);
  return `msg:${input.clientId}:${input.instance}:${input.remoteJid}:${ts}:${t}`;
}

// Exported so /api/webhooks/evolution/[event] can reuse the same implementation.
export async function handleEvolutionWebhook(req: NextRequest, forcedEvent?: string) {
  const traceId = `evwh_trc_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 10)}`;
  console.info(`[EVWH] incoming`, { traceId, method: req.method, url: req.url });
  // 1) secret (optional)
  const expected = (process.env.EVOLUTION_WEBHOOK_SECRET || "").trim();
  if (expected) {
    const got = getSecret(req);
    if (!got || got !== expected) {
      return NextResponse.json({ ok: false, error: "invalid webhook secret" }, { status: 401 });
    }
  }


  // 2) payload (precisa vir antes da inferência de tenant por instância)
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }


  // 2.1) evento (pré-tenant) — proteção contra 400 em eventos que NÃO são mensagem
  // O Evolution envia vários eventos (contacts.update, chats.update, connection.update, etc.).
  // Esses eventos normalmente NÃO têm dados suficientes para inferir tenant (clientId) no Nextia.
  // Regra segura:
  // - Se vier "event/type" e NÃO for "messages.upsert" => ignora cedo (200).
  // - Se NÃO vier "event/type" => só continua se o payload "parece mensagem"; senão ignora cedo (200).
  const preEvent = safeString(forcedEvent || payload?.event || payload?.type || "");
  if (preEvent && preEvent !== "messages.upsert") {
    console.info(`[EVWH] ignored`, { traceId, event: preEvent });
    return NextResponse.json({ ok: true, ignored: true, event: preEvent });
  }
  if (!preEvent && !looksLikeMessagePayload(payload)) {
    console.info(`[EVWH] ignored`, { traceId, event: "unknown" });
    return NextResponse.json({ ok: true, ignored: true, event: "unknown" });
  }

  // 3) tenant
  // Prefer explicit env (single-tenant this host), fallback to helper (multi-tenant legacy)
  const clientIdEnv = safeString(process.env.EVOLUTION_TENANT_CLIENT_ID) || safeString(getEvolutionTenantClientId());
  let clientId = clientIdEnv;

  // Multi-números: tenta inferir clientId pela instância do webhook quando EVOLUTION_TENANT_CLIENT_ID não está setado.
  if (!clientId) {
    const inst = extractInstanceName(payload);
    if (inst) {
      try {
        const inferred = await findClientIdByInstanceName(inst);
        if (inferred) clientId = inferred;
      } catch {
        // best-effort
      }
    }
  }

  if (!clientId) {
    console.error(`[EVWH] tenant_error`, { traceId });
    return NextResponse.json(
      { error: "EVOLUTION_TENANT_CLIENT_ID não configurado e não foi possível inferir clientId pela instância." },
      { status: 400 }
    );
  }

  const client = await getClientById(clientId);
  if (!client) {
    return NextResponse.json({ ok: false, error: "Cliente não encontrado." }, { status: 404 });
  }

  const instance = safeString(payload?.instance || process.env.EVOLUTION_INSTANCE || "Evolution");
  let event = safeString(forcedEvent || payload?.event || payload?.type || "");

  // Compatibility: when "Webhook por Eventos" is OFF, some setups send message payload without event/type.
  if (!event && looksLikeMessagePayload(payload)) {
    event = "messages.upsert";
  }

  // Evita tempestade de webhooks (status/update). Só reagimos a mensagens novas.
  if (event !== "messages.upsert") {
    console.info(`[EVWH] ignored`, { traceId, event });
    return NextResponse.json({ ok: true, ignored: true, event });
  }

  const raw = payload?.raw ?? payload;
  const remoteJid = extractRemoteJid(raw);
  const keyId = extractKeyId(raw);
  const fromMe = extractFromMe(raw);
  const messageTimestamp = extractMessageTimestamp(raw, payload);
  const text = pickText(raw);

  // Group inbound control (WhatsApp groups can create chaos if treated as 1:1 chat).
  // Modes:
  // - ignore: ignore all group inbound (useful for campaign-only groups)
  // - trigger: process only when explicitly triggered (default)
  // - full: process all group inbound (not recommended)
  //
  // Env:
  // - NEXTIA_IGNORE_GROUP_MESSAGES=true           (legacy shortcut => mode=ignore)
  // - NEXTIA_GROUP_INBOUND_MODE=trigger|ignore|full
  // - NEXTIA_GROUP_TRIGGER_PREFIX=!nextia        (used when mode=trigger)
  // - NEXTIA_GROUP_TRIGGER_REGEX=...             (optional, used when mode=trigger)
  // - NEXTIA_BOT_JID=...                         (optional, mention detection)
  // - NEXTIA_GROUP_COOLDOWN_MS=30000             (group-wide cooldown)
  // - NEXTIA_GROUP_USER_COOLDOWN_MS=15000        (per-sender cooldown)
  const isGroup = remoteJid && remoteJid.endsWith("@g.us");
  if (isGroup) {
    const mode = getGroupInboundMode();

    if (mode === "ignore") {
      console.info("[EVOLUTION WEBHOOK] ignored group message", { clientId, instance, remoteJid, keyId });
      return NextResponse.json({ ok: true, ignored: true, reason: "group_message" });
    }

    if (mode === "trigger") {
      const mentionedJids = extractMentionedJids(raw);
      const triggered = isTriggeredGroupMessage({ text: text || "", mentionedJids });

      if (!triggered) {
        console.info("[EVOLUTION WEBHOOK] ignored group message (not triggered)", { clientId, instance, remoteJid, keyId });
        return NextResponse.json({ ok: true, ignored: true, reason: "group_not_triggered" });
      }

      // Cooldown to prevent spam/loops in groups.
      const groupCooldownMs = parseMsEnv("NEXTIA_GROUP_COOLDOWN_MS", 30000);
      const userCooldownMs = parseMsEnv("NEXTIA_GROUP_USER_COOLDOWN_MS", 15000);
      const participant = extractParticipant(raw);

      if (groupCooldownMs > 0 && seenRecently(`grp:${clientId}:${instance}:${remoteJid}`, groupCooldownMs)) {
        console.warn("[EVOLUTION WEBHOOK] group cooldown suppressed", { clientId, instance, remoteJid, keyId, groupCooldownMs });
        return NextResponse.json({ ok: true, ignored: true, reason: "group_cooldown" });
      }

      if (participant && userCooldownMs > 0 && seenRecently(`grpusr:${clientId}:${instance}:${remoteJid}:${participant}`, userCooldownMs)) {
        console.warn("[EVOLUTION WEBHOOK] group sender cooldown suppressed", {
          clientId,
          instance,
          remoteJid,
          keyId,
          participant,
          userCooldownMs,
        });
        return NextResponse.json({ ok: true, ignored: true, reason: "group_sender_cooldown" });
      }
    }
  }

  // Persist message event (best-effort). IMPORTANT: only insert when we have required fields.
  let inserted = false;
  if (remoteJid && keyId) {
    inserted = await appendStoredMessage({
      clientId,
      instance,
      remoteJid,
      keyId,
      fromMe,
      messageTimestamp,
      text,
      raw: payload,
    });
  }

  // Telemetry for debugging duplications / replays (does not log secrets).
  console.info("[EVOLUTION WEBHOOK] inbound", {
    event,
    clientId,
    instance,
    remoteJid,
    keyId,
    fromMe,
    inserted,
    messageTimestamp,
    textLen: typeof text === "string" ? text.length : 0,
  });

  // Backfill to tap gaps (best-effort)
  if (remoteJid && inserted) {
    try {
      await backfillConversationFromEvolution({ clientId, instance, remoteJid, limit: 150 });
    } catch {
      // ignore
    }
  }

  // Only react to inbound text from customer; also ignore duplicates
  if (!inserted || fromMe || !remoteJid || !text) {
    return NextResponse.json({ ok: true, stored: inserted, reacted: false });
  }

  // Soft dedupe (second line of defense)
  const ttlMs = getSoftDedupeTtlMs();
  const dedupeKey = buildSoftDedupeKey({ clientId, instance, remoteJid, keyId, messageTimestamp, text });
  if (seenRecently(dedupeKey, ttlMs)) {
    console.warn("[EVOLUTION WEBHOOK] duplicate suppressed", { clientId, instance, remoteJid, keyId, ttlMs });
    return NextResponse.json({ ok: true, stored: inserted, reacted: false, duplicate: true });
  }

  // Marketing opt-out (1:1): se o usuário pedir para sair, marcamos optOutMarketing=true
  // e respondemos sem chamar LLM.
  if (!isGroup && isMarketingOptOutCommand(text)) {
    try {
      const existingContact = await getContactByIdentifier(clientId, remoteJid);
      const contact =
        existingContact ??
        (await upsertContactFromInbound({
          clientId,
          channel: "whatsapp",
          identifier: remoteJid,
          lastMessage: text,
          interactionDate: messageTimestamp ? new Date(messageTimestamp * 1000).toISOString() : undefined,
        }));

      if (!contact.optOutMarketing) {
        await setContactOptOut(contact.id, true);
      }

      await sendWhatsappSystemMessage({
        clientId,
        to: remoteJid,
        contactId: contact.id,
        message:
          "Ok. Você foi descadastrado e não receberá mais campanhas. Se precisar falar com a loja, é só mandar mensagem aqui.",
      });

      await logAnalyticsEvent({
        type: "marketing_optout",
        clientId,
        contactId: contact.id,
        identifier: contact.identifier,
        payload: {
          source: "inbound",
          remoteJid,
          instance,
          keyId,
        },
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({ ok: true, stored: Boolean(remoteJid && keyId), reacted: true, mode: "optout" });
    } catch (err) {
      console.error("[EVOLUTION WEBHOOK] failed to process opt-out", err);
      // Falhou o fluxo de opt-out — não derruba o webhook; segue para o fluxo normal.
    }
  }

  // Process through core flow (deterministic + llm + outbox)
  const result = await handleWhatsappInboundFlow({
    client,
    clientId,
    to: safeString(process.env.EVOLUTION_INSTANCE || "Evolution"),
    from: remoteJid,
    body: text,
    source: "evolution_webhook",
    raw,
    instance,
  });

  return NextResponse.json({
    ok: true,
    stored: Boolean(remoteJid && keyId),
    reacted: true,
    mode: result.mode,
  });
}
