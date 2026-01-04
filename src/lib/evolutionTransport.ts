// src/lib/evolutionTransport.ts
// Bridge between NextIA outbox and Evolution API.

import { getEvolutionConfig } from "./evolutionConfig";
import { evolutionSendText } from "./evolutionApi";
import { appendStoredMessage } from "./nextiaMessageStore";
import { updateOutboxStatusById } from "./whatsappOutboxStore";

function digitsOnly(v: string): string {
  return String(v || "").replace(/\D+/g, "");
}

export async function sendWhatsappTextViaEvolution(opts: {
  clientId: string;
  instance: string;
  to: string; // phone digits or jid
  text: string;
  outboxId?: string | null;
}): Promise<{
  ok: boolean;
  keyId?: string;
  remoteJid?: string;
  messageTimestamp?: number | null;
  error?: string;
}> {
  const cfg = getEvolutionConfig();
  if (!cfg) {
    return { ok: false, error: "Evolution env vars missing (EVOLUTION_*)." };
  }

  const toDigits = digitsOnly(opts.to);
  if (!toDigits) return { ok: false, error: "Invalid 'to'." };

  try {
    const res = await evolutionSendText(cfg, { number: toDigits, text: opts.text });

    const keyId = String(res?.key?.id || "").trim() || undefined;
    const remoteJid = String(res?.key?.remoteJid || `${toDigits}@s.whatsapp.net`).trim();

    const tsRaw = res?.messageTimestamp;
    const messageTimestamp =
      typeof tsRaw === "number" ? tsRaw : typeof tsRaw === "string" ? Number(tsRaw) : null;

    // Persist in message store (best-effort)
    if (keyId) {
      await appendStoredMessage({
        clientId: opts.clientId,
        instance: opts.instance,
        remoteJid,
        keyId,
        fromMe: true,
        messageTimestamp,
        text: opts.text,
        raw: res,
      });
    }

    // Close outbox item
    if (opts.outboxId) {
      await updateOutboxStatusById(opts.outboxId, "sent", { provider: { evolution: res } });
    }

    return { ok: true, keyId, remoteJid, messageTimestamp };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (opts.outboxId) {
      await updateOutboxStatusById(opts.outboxId, "failed", { provider: { error: msg } });
    }
    return { ok: false, error: msg };
  }
}
