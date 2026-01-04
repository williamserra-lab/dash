// src/lib/whatsappOutboxRunner.ts
// Operational runner for WhatsApp outbox.
// In DB mode (NEXTIA_DB_URL), reads from nextia_outbox table.
// In JSON mode, reads from data/whatsapp_outbox.json.
//
// Provider: Evolution API (when EVOLUTION_* env vars are set).
// DRY_RUN: OUTBOX_DRY_RUN=true OR options.dryRun=true.

import { listPendingOutboxForRun, updateOutboxStatusById } from "./whatsappOutboxStore";
import { recordCampaignSendStatus } from "./campaigns";
import { recordGroupCampaignSendStatus } from "./groupCampaigns";
import { markRunItemResult } from "./campaignRunItems";
import { markGroupRunItemResult } from "./groupCampaignRunItems";
import { getEvolutionConfig } from "./evolutionConfig";
import { evolutionSendText } from "./evolutionApi";
import { appendStoredMessage } from "./nextiaMessageStore";

export type OutboxRunOptions = {
  clientId?: string;
  limit?: number;
  dryRun?: boolean;
};


function sleepMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function intFromEnv(name: string, fallback: number) {
  const raw = String(process.env[name] || "").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

type AnyItem = Record<string, any>;

function boolFromEnv(v: string | undefined): boolean {
  const x = String(v || "").trim().toLowerCase();
  return x === "true" || x === "1" || x === "yes" || x === "y";
}

function digitsOnly(v: string): string {
  return String(v || "").replace(/\D+/g, "");
}

function mapToCampaignStatus(outboxStatus: "sent" | "failed" | string): "enviado" | "erro" {
  return outboxStatus === "sent" ? "enviado" : "erro";
}

export async function runWhatsappOutbox(opts?: OutboxRunOptions) {
  const clientId = String(opts?.clientId || "").trim() || undefined;
  const limit = typeof opts?.limit === "number" && opts.limit > 0 ? opts.limit : 25;
  const dryRun = Boolean(opts?.dryRun) || boolFromEnv(process.env.OUTBOX_DRY_RUN);

  const candidate = await listPendingOutboxForRun({ clientId, limit });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const results: { id: string; status: string; reason?: string }[] = [];

  const cfg = getEvolutionConfig();
  // Guardrails anti-ban (cadence). Only applied to real sends (not dry-run).
  const maxPerMinute = intFromEnv("NEXTIA_OUTBOX_MAX_PER_MINUTE", 20);
  const jitterMs = intFromEnv("NEXTIA_OUTBOX_JITTER_MS", 500);
  const failPauseThreshold = intFromEnv("NEXTIA_OUTBOX_FAIL_PAUSE_THRESHOLD", 3);
  const failPauseMs = intFromEnv("NEXTIA_OUTBOX_FAIL_PAUSE_MS", 60_000);
  const baseDelayMs = Math.max(0, Math.floor(60_000 / Math.max(1, maxPerMinute)));

  let consecutiveFailures = 0;


  for (const it of candidate) {
    const id = String((it as any).id || "").trim();
    if (!id) {
      skipped += 1;
      results.push({ id: "(missing)", status: "skipped", reason: "missing id" });
      continue;
    }

    const to = String((it as any).to || "").trim();
    const message = String((it as any).message || "").trim();

    if (!to || !message) {
      failed += 1;
      // Meta must respect type { provider?: any; context?: any }
      await updateOutboxStatusById(id, "failed", { context: { reason: "missing to/message" } });
      results.push({ id, status: "failed", reason: "missing to/message" });
      continue;
    }

    const context = ((it as AnyItem).context || {}) as AnyItem;
    const kind = String(context?.kind || "").trim();

    // DRY RUN
    if (dryRun) {
      sent += 1;
      await updateOutboxStatusById(id, "sent", { provider: { dryRun: true } });
      results.push({ id, status: "sent", reason: "dry_run" });

      // Close trails in simulation mode (best-effort, optional)
      if (kind === "campaign") {
        const campaignId = String(context?.campaignId || "");
        const contactId = String((it as any).contactId || context?.contactId || digitsOnly(to) || "");
        if (campaignId && contactId) {
          await recordCampaignSendStatus({
            clientId: String((it as any).clientId || ""),
            campaignId,
            contactId,
            identifier: to,
            status: "simulado",
          });
          const runId = String((context as any)?.runId || "");
          if (runId) {
            await markRunItemResult({
              clientId: String((it as any).clientId || ""),
              runId,
              campaignId,
              contactId,
              identifier: to,
              status: "simulated",
              sentAt: new Date().toISOString(),
            });
          }
        }
      }

      if (kind === "group_campaign") {
        const groupCampaignId = String(context?.groupCampaignId || "");
        const groupId = String(context?.groupId || "");
        const participantJid = String(context?.participantJid || "");
        if (groupCampaignId && groupId) {
          await recordGroupCampaignSendStatus({
            clientId: String((it as any).clientId || ""),
            groupCampaignId,
            groupId,
            participantJid: participantJid || null,
            status: "simulado",
          } as any);
          const runId = String((context as any)?.runId || "");
          if (runId) {
            await markGroupRunItemResult({
              clientId: String((it as any).clientId || ""),
              runId,
              groupCampaignId,
              groupId,
              status: "simulated",
              sentAt: new Date().toISOString(),
            });
          }
        }
      }

      continue;
    }

    // No provider config
    if (!cfg) {
      failed += 1;
      await updateOutboxStatusById(id, "failed", {
        provider: { error: "Missing EVOLUTION_* env vars (provider not configured)" },
      });
      results.push({ id, status: "failed", reason: "provider not configured" });
      continue;
    }

    try {
      const toDigits = digitsOnly(to);
      if (!toDigits) throw new Error("invalid destination");


      // Cadence: delay between sends to reduce WhatsApp ban risk.
      if (!dryRun) {
        if (consecutiveFailures >= failPauseThreshold) {
          await sleepMs(failPauseMs);
          consecutiveFailures = 0;
        }
        const delay = baseDelayMs + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0);
        if (delay > 0) await sleepMs(delay);
      }

      const res = await evolutionSendText(cfg, { number: toDigits, text: message });

      await updateOutboxStatusById(id, "sent", { provider: { evolution: res } });
      consecutiveFailures = 0;
      sent += 1;
      results.push({ id, status: "sent" });

      // Persist in message store (best-effort)
      const keyId = String(res?.key?.id || "").trim();
      const remoteJid = String(res?.key?.remoteJid || `${toDigits}@s.whatsapp.net`).trim();

      const tsRaw = (res as any)?.messageTimestamp;
      const messageTimestamp =
        typeof tsRaw === "number" ? tsRaw : typeof tsRaw === "string" ? Number(tsRaw) : null;

      if (keyId) {
        await appendStoredMessage({
          clientId: String((it as any).clientId || ""),
          instance: String(process.env.EVOLUTION_INSTANCE || cfg.instance || ""),
          remoteJid,
          keyId,
          fromMe: true,
          messageTimestamp,
          text: message,
          raw: res,
        });
      }

      // Close campaign trails, if applicable
      if (kind === "campaign") {
        const campaignId = String(context?.campaignId || "");
        const contactId = String((it as any).contactId || context?.contactId || toDigits || "");
        if (campaignId && contactId) {
          await recordCampaignSendStatus({
            clientId: String((it as any).clientId || ""),
            campaignId,
            contactId,
            identifier: to,
            status: mapToCampaignStatus("sent"),
          });
        }
      }

      if (kind === "group_campaign") {
        const groupCampaignId = String(context?.groupCampaignId || "");
        const groupId = String(context?.groupId || "");
        const participantJid = String(context?.participantJid || "");
        if (groupCampaignId && groupId) {
          await recordGroupCampaignSendStatus({
            clientId: String((it as any).clientId || ""),
            groupCampaignId,
            groupId,
            participantJid: participantJid || null,
            status: "enviado",
          } as any);
          const runId = String((context as any)?.runId || "");
          if (runId) {
            await markGroupRunItemResult({
              clientId: String((it as any).clientId || ""),
              runId,
              groupCampaignId,
              groupId,
              status: "sent",
              sentAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      failed += 1;
      await updateOutboxStatusById(id, "failed", { provider: { error: msg } });
      results.push({ id, status: "failed", reason: msg });

      // mark trail as failed (best-effort)
      const context2 = ((it as AnyItem).context || {}) as AnyItem;
      const kind2 = String(context2?.kind || "").trim();

      if (kind2 === "campaign") {
        const campaignId = String(context2?.campaignId || "");
        const contactId = String((it as any).contactId || context2?.contactId || digitsOnly(to) || "");
        if (campaignId && contactId) {
          await recordCampaignSendStatus({
            clientId: String((it as any).clientId || ""),
            campaignId,
            contactId,
            identifier: to,
            status: "erro",
          });
          const runId = String((context2 as any)?.runId || "");
          if (runId) {
            await markRunItemResult({
              clientId: String((it as any).clientId || ""),
              runId,
              campaignId,
              contactId,
              identifier: to,
              status: "failed",
              error: msg,
            });
          }
        }
      }

      if (kind2 === "group_campaign") {
        const groupCampaignId = String(context2?.groupCampaignId || "");
        const groupId = String(context2?.groupId || "");
        const participantJid = String(context2?.participantJid || "");
        if (groupCampaignId && groupId) {
          await recordGroupCampaignSendStatus({
            clientId: String((it as any).clientId || ""),
            groupCampaignId,
            groupId,
            participantJid: participantJid || null,
            status: "erro",
          } as any);
          const runId = String((context2 as any)?.runId || "");
          if (runId) {
            await markGroupRunItemResult({
              clientId: String((it as any).clientId || ""),
              runId,
              groupCampaignId,
              groupId,
              status: "failed",
              error: msg,
            });
          }
        }
      }
    }
  }

  return {
    ok: failed === 0,
    processed: candidate.length,
    sent,
    failed,
    skipped,
    items: results,
  };
}