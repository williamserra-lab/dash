// src/lib/whatsappInboundFlow.ts
// Core inbound flow used by multiple webhook adapters (Evolution, generic inbound).
// Goal: single source of truth for deterministic + LLM behavior.

import { getAssistantSettings, type AssistantSettings } from "@/lib/assistantSettings";
import { listMediaByClient } from "@/lib/mediaAssets";
import { getContactByIdentifier, upsertContactFromInbound } from "@/lib/contacts";
import { runLLMWithUsage, type LLMProvider } from "@/lib/llm";
import { logAnalyticsEvent } from "@/lib/analytics";
import { deliveryPricingToPromptText, getDeliveryPricing } from "@/lib/deliveryPricing";
import { listProducts } from "@/lib/productsCatalog";
import { enqueueWhatsappText } from "@/lib/whatsappOutboxStore";
import { resolveLlmDecision } from "@/lib/llmPolicy";
import { addUsage } from "@/lib/llmBudget";
import { sendWhatsappTextViaEvolution } from "@/lib/evolutionTransport";
import { buildInboundDegradedReply, buildInboundBlockedReply } from "@/lib/degradedReplies";
import { logTelemetry, nowIso } from "@/lib/telemetry";
import { decideInboundDeterministic, persistDeterministicState } from "@/lib/conversationStateMachine";
import type { ClientRecord } from "@/lib/clientsRegistry";

type AIVerbosity = "conciso" | "equilibrado" | "prolixo";
type AIPersonality = "profissional" | "amigavel" | "direto" | "vendedor_consultivo";

function getNowIso() {
  return new Date().toISOString();
}

function normalizePhone(raw: string): string {
  return String(raw || "").replace(/\D+/g, "");
}

function env(name: string): string {
  return (process.env[name] || "").trim();
}

function pickDefaultProvider(): LLMProvider {
  const forced = env("LLM_PROVIDER") || env("NEXTIA_LLM_PROVIDER");
  if (forced === "groq" || forced === "openai" || forced === "ollama") return forced;
  return "openai";
}

function mapVerbosity(v?: string | null): AIVerbosity {
  if (v === "conciso" || v === "prolixo" || v === "equilibrado") return v;
  return "equilibrado";
}

function mapPersonality(p?: string | null): AIPersonality {
  if (p === "profissional" || p === "amigavel" || p === "direto" || p === "vendedor_consultivo") return p;
  return "profissional";
}


function buildSystemPrompt(opts: {
  baseSystemPrompt: string;
  personality: AIPersonality;
  verbosity: AIVerbosity;
  promptRules?: string | null;
  productsText?: string | null;
  priceTableText?: string | null;
  deliveryPricingText?: string | null;
}): string {
  const personalityHint =
    opts.personality === "vendedor_consultivo"
      ? "vendedor consultivo (orienta, sugere, ajuda a escolher, mas sem empurrar demais)"
      : opts.personality === "direto"
      ? "direto (objetivo, curto, sem enrolar)"
      : opts.personality === "amigavel"
      ? "amigável (educado, humano, simpático)"
      : "profissional (claro, organizado, cordial)";

  const verbosityHint =
    opts.verbosity === "conciso" ? "conciso (poucas palavras)" : opts.verbosity === "prolixo" ? "prolixo (detalhado)" : "equilibrado";

  const priceTableBlock = opts.priceTableText
    ? `\n\nTABELA OFICIAL (COPIADA DO ARQUIVO):\n${opts.priceTableText}\n`
    : "";

  const productsBlock = opts.productsText
    ? `

CATÁLOGO DE PRODUTOS (fonte de verdade; NÃO invente itens, preços, sabores ou opções):
${opts.productsText}`
    : "";

  const deliveryPricingBlock = opts.deliveryPricingText
    ? `

TABELA DE FRETE (COPIADA DO SISTEMA):
${opts.deliveryPricingText}
`
    : "";

  const deliveryPolicyBlock = `\n\nPOLÍTICA DE ENTREGA:\n- Se o cliente pedir delivery, sempre confirme o endereço e informe o valor do frete (se houver).\n- Se o cliente pedir retirada, confirme o horário estimado e o local.\n`;

  return `
${opts.baseSystemPrompt}

PERSONALIDADE: ${personalityHint}
ESTILO: ${verbosityHint}

REGRAS DO CLIENTE:
${opts.promptRules || "- (nenhuma regra extra)"}
${productsBlock}
${priceTableBlock}
${deliveryPricingBlock}

${deliveryPolicyBlock}
`.trim();
}

async function extractOfficialPriceTableText(clientId: string): Promise<string | null> {
  const media = await listMediaByClient(clientId);
  const official = media.find((m) => {
    const meta = m.meta && typeof m.meta === "object" ? (m.meta as Record<string, unknown>) : null;
    const isOfficial = Boolean(meta && (meta["isOfficialPriceTable"] === true || meta["officialPriceTable"] === true));
    return isOfficial;
  });

  if (!official) return null;

  const text = typeof official.extractedText === "string" ? official.extractedText : null;
  if (!text || !text.trim()) return null;
  return text.trim();
}

export type WhatsappInboundFlowInput = {
  client: ClientRecord;
  clientId: string;
  to: string;
  from: string;
  body: string;
  source?: string | null;
  raw?: unknown;
  instance?: string | null;
};

export type WhatsappInboundFlowResult =
  | { ok: true; mode: "deterministic" }
  | { ok: true; mode: "llm"; reply: string; contactId: string; degraded: boolean };

export async function handleWhatsappInboundFlow(input: WhatsappInboundFlowInput): Promise<WhatsappInboundFlowResult> {
  const toNorm = normalizePhone(input.to || "");
  const fromNorm = normalizePhone(input.from || "");
  const body = String(input.body || "");

  const clientId = input.clientId;

  await logAnalyticsEvent({
    clientId,
    type: "client_whatsapp_inbound",
    createdAt: getNowIso(),
    payload: { from: fromNorm, to: toNorm, body },
  });

  const existing = await getContactByIdentifier(clientId, fromNorm);

  const contactFinal =
    existing ??
    (await upsertContactFromInbound({
      clientId,
      channel: "whatsapp",
      identifier: fromNorm,
      name: undefined,
      lastMessage: body,
      interactionDate: getNowIso(),
    }));

  if (existing) {
    await upsertContactFromInbound({
      clientId,
      channel: "whatsapp",
      identifier: fromNorm,
      name: existing.name,
      lastMessage: body,
      interactionDate: getNowIso(),
    });
  }

  // Deterministic conversation state machine (MVP)
  const instanceEv = String(input.instance || process.env.EVOLUTION_INSTANCE || "NextIA");
  const convKey = { clientId, instance: instanceEv, remoteJid: fromNorm };
  // Carrega settings e mídias antes da decisão (menu inicial, bloqueios, etc.)
  const assistantSettingsRec = await getAssistantSettings(clientId);
  const assistantSettings = (assistantSettingsRec ?? ({ clientId } as any)) as AssistantSettings;
  const mediaAssets = (await listMediaByClient(clientId)).filter((m) => Boolean(m.enabled));

  const decision = await decideInboundDeterministic({
    key: convKey,
    text: body,
    assistantSettings,
    mediaAssets,
  });

  const wasIntroduced = Boolean((decision.updatedState as any)?.hasIntroduced);

  // Persist state early (best-effort) so follow-up/ops can rely on DB even if LLM fails
  await persistDeterministicState({ key: convKey, state: decision.updatedState, transitioned: decision.transitioned });

  if (decision.mode === "deterministic") {
    const replyText = decision.replyText;

    try {
      const outboxItem = await enqueueWhatsappText({
        clientId,
        to: fromNorm,
        message: replyText,
        messageType: "assistant_reply",
        contactId: contactFinal.id,
        context: {
          kind: "assistant_reply",
          source: input.source || "whatsapp_inbound",
          conversation: { to: toNorm || null, from: fromNorm },
          traces: null,
          deterministic: true,
        },
      });

      const sendImmediate = String(process.env.OUTBOX_SEND_IMMEDIATE || "true").trim().toLowerCase() !== "false";

      if (sendImmediate) {
        await sendWhatsappTextViaEvolution({
          clientId,
          instance: instanceEv,
          to: fromNorm,
          text: replyText,
          outboxId: outboxItem.id,
        });
      }
    } catch (e) {
      console.error("[WHATSAPP INBOUND FLOW] deterministic outbox/send falhou:", e);
    }

    return { ok: true, mode: "deterministic" };
  }

  // Token cost guardrail: avoid calling LLM for trivial acknowledgements.
  // IMPORTANT: this runs only after the deterministic state machine declined to handle the message.
  {
    const t = String(body || "").trim().toLowerCase();
    const trivial =
      t.length > 0 &&
      t.length <= 12 &&
      !/\d{3,}/.test(t) &&
      [
        "ok",
        "blz",
        "beleza",
        "certo",
        "show",
        "top",
        "vlw",
        "valeu",
        "obrigado",
        "obrigada",
        "👍",
        "sim",
        "nao",
        "não",
      ].includes(t);

    if (trivial) {
      const replyText = "Perfeito. Se quiser, me diga o que você precisa agora.";
      try {
        await logAnalyticsEvent({
          clientId,
          type: "inbound_trivial_bypassed",
          createdAt: getNowIso(),
          payload: { body: t },
        });
      } catch {
        // ignore
      }

      try {
        const outboxItem = await enqueueWhatsappText({
          clientId,
          to: fromNorm,
          message: replyText,
          messageType: "assistant_reply",
          contactId: contactFinal.id,
          context: {
            kind: "assistant_reply",
            source: input.source || "whatsapp_inbound",
            conversation: { to: toNorm || null, from: fromNorm },
            traces: null,
            trivialBypass: true,
          },
        });

        const sendImmediate = String(process.env.OUTBOX_SEND_IMMEDIATE || "true").trim().toLowerCase() !== "false";
        if (sendImmediate) {
          await sendWhatsappTextViaEvolution({
            clientId,
            instance: instanceEv,
            to: fromNorm,
            text: replyText,
            outboxId: outboxItem.id,
          });
        }
      } catch {
        // never crash inbound
      }

      return { ok: true, mode: "llm", reply: replyText, contactId: contactFinal.id, degraded: true };
    }
  }

  const personality = mapPersonality(assistantSettings.personality);
  const verbosity = mapVerbosity(assistantSettings.verbosity);
  const temperature = typeof assistantSettings.temperature === "number" ? assistantSettings.temperature : 0.2;

  const provider: LLMProvider = (assistantSettings.provider as LLMProvider | undefined) ?? pickDefaultProvider();
  const model = assistantSettings.model ?? undefined;

  const priceTableText = await extractOfficialPriceTableText(clientId);
  const deliveryPricingText = deliveryPricingToPromptText(await getDeliveryPricing(clientId));

  const productsText = (await listProducts(clientId))
    .filter((p) => p.active)
    .slice(0, 50)
    .map((p) => {
      const price = `R$ ${(p.priceCents / 100).toFixed(2).replace(".", ",")}`;
      const desc = (p.description || "").trim();
      return `- ${p.name} — ${price}${desc ? ` | ${desc}` : ""}`;
    })
    .join("\n");

  const systemPromptBase = buildSystemPrompt({
    baseSystemPrompt: (() => {
      const v = (input.client as Record<string, unknown>)?.systemPrompt;
      return typeof v === "string" && v.trim().length > 0 ? v : "Você é um assistente de WhatsApp de uma loja.";
    })(),
    personality,
    verbosity,
    promptRules: assistantSettings.promptRules,
    productsText: productsText || null,
    priceTableText,
    deliveryPricingText,
  });

  const systemPrompt = wasIntroduced
    ? `${systemPromptBase}\n\nREGRA: Não se apresente novamente nesta conversa. Vá direto ao ponto.`
    : `${systemPromptBase}\n\nREGRA: Apresente-se brevemen...rimeira resposta). Nas próximas mensagens, não se reapresente.`;

  let llmReply = "";
  let degraded = false;
  let budgetDegraded = false;
  let budgetBlocked = false;

  // Governança de tokens (por clientId) - decisão centralizada:
  // - Atendimento (inbound): allow <80%, degrade >=80%, block >=100%.
  // - Campanhas: block is handled at dispatch endpoints.
  try {
    const decision = await resolveLlmDecision({ clientId, context: "inbound" });
    budgetDegraded = decision.action === "degrade";
    budgetBlocked = decision.action === "block";
    logTelemetry({ ts: nowIso(), level: "info", event: "llm_policy_decision", clientId, payload: { context: "inbound", action: decision.action, overLimit: decision.overLimit, monthKey: decision.snapshot?.monthKey ?? null, used: decision.snapshot?.usedTokens ?? null, limit: decision.policy?.monthlyTokenLimit ?? null } });
  } catch (e) {
    // Falha em ler budget/policy não pode derrubar o atendimento.
    budgetDegraded = false;
    budgetBlocked = false;
  }

  try {
    if (budgetBlocked) {
      degraded = true;
      llmReply = buildInboundBlockedReply();

      logTelemetry({
        ts: nowIso(),
        level: "error",
        event: "llm_blocked_budget",
        clientId,
        payload: { context: "inbound", provider, model: model ?? null },
      });
    } else if (budgetDegraded) {
      degraded = true;
      llmReply = buildInboundDegradedReply("budget");

      logTelemetry({ ts: nowIso(), level: "warn", event: "llm_degraded", clientId, payload: { reason: "budget_over_limit", context: "inbound", provider, model: model ?? null } });

      await logAnalyticsEvent({
        clientId,
        type: "llm_degraded_mode",
        createdAt: getNowIso(),
        payload: { provider, model: model ?? null, reason: "budget_over_limit" },
      });
    } else {
      const out = await runLLMWithUsage({
        provider,
        model,
        prompt: `${systemPrompt}\n\nCLIENTE: ${body}\nASSISTENTE:`,
        temperature,
      });
      llmReply = out.text;

      // Best-effort: registra uso de tokens quando suportado.
      try {
        await addUsage(clientId, {
          provider: out.usage.provider ?? provider,
          model: out.usage.model ?? model ?? null,
          promptTokens: out.usage.promptTokens,
          completionTokens: out.usage.completionTokens,
          totalTokens: out.usage.totalTokens,
        }, { context: "inbound" });
logTelemetry({ ts: nowIso(), level: "info", event: "llm_usage_recorded", clientId, payload: { context: "inbound", provider: out.usage.provider ?? provider, model: out.usage.model ?? model ?? null, promptTokens: out.usage.promptTokens, completionTokens: out.usage.completionTokens, totalTokens: out.usage.totalTokens } });
      } catch (e) {
        // nunca derrubar inbound por falha em telemetria.
      }
    }
  } catch (e) {
    console.error("[WHATSAPP INBOUND FLOW] LLM falhou, modo degradado:", e);
    degraded = true;
    llmReply = buildInboundDegradedReply("technical");

    logTelemetry({ ts: nowIso(), level: "warn", event: "llm_degraded", clientId, payload: { reason: "technical_failure", context: "inbound", provider, model: model ?? null } });

    await logAnalyticsEvent({
      clientId,
      type: "llm_degraded_mode",
      createdAt: getNowIso(),
      payload: { provider, model: model ?? null, reason: "llm_error" },
    });
  }

  // CTA opcional do modo determinístico (ex: menu/atalhos) sem duplicar.
  if (decision.appendCta) {
    const cta = decision.appendCta.trim();
    if (cta && !llmReply.includes(cta)) {
      llmReply = `${llmReply}\n\n${cta}`;
    }
  }

  await logAnalyticsEvent({
    clientId,
    type: "client_llm_reply",
    createdAt: getNowIso(),
    payload: { provider, model: model ?? null, degraded },
  });

  const traces = (decision as any)?.traces || null;

  try {
    const outboxItem = await enqueueWhatsappText({
      clientId,
      to: fromNorm,
      message: llmReply,
      messageType: degraded ? "degraded_reply" : "assistant_reply",
      contactId: contactFinal.id,
      context: {
        kind: "assistant_reply",
        source: input.source || "whatsapp_inbound",
        conversation: {
          to: toNorm || null,
          from: fromNorm,
        },
        traces: traces || null,
      },
    });

    const sendImmediate = String(process.env.OUTBOX_SEND_IMMEDIATE || "true").trim().toLowerCase() !== "false";

    if (sendImmediate) {
      await sendWhatsappTextViaEvolution({
        clientId,
        instance: instanceEv,
        to: fromNorm,
        text: llmReply,
        outboxId: outboxItem.id,
      });
    }
  } catch (e) {
    // Não derruba inbound por falha de outbox (mas registra)
    console.error("[WHATSAPP INBOUND FLOW] falha ao enfileirar OUTBOX:", e);
    await logAnalyticsEvent({
      clientId,
      type: "outbox_enqueue_failed",
      createdAt: getNowIso(),
      payload: { reason: String((e as any)?.message || e) },
    });
  }

  return { ok: true, mode: "llm", reply: llmReply, contactId: contactFinal.id, degraded };
}