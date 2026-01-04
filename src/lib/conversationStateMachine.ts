// src/lib/conversationStateMachine.ts
// Deterministic per-conversation state machine (MVP) for pre-order flow.
// Source of truth: nextia_conversation_state (via nextiaConversationStateStore).
//
// Design goals:
// - Build-safe, minimal, no UI changes.
// - Does NOT replace LLM; it decides when to bypass it and when to append gentle CTA.
// - Follow-up engine is NOT implemented here. We only store timestamps needed for it.

import { getConversationState, setConversationState, type ConversationKey, type ConversationState } from "./nextiaConversationStateStore";
import { appendConversationEvent, makeEventId } from "./conversationEvents";
import { buildMenuMessage, normalizeMenuItems, parseMenuChoice } from "./menu";
import { getCatalogReadiness, listProducts } from "./productsCatalog";
import type { AssistantSettings } from "./assistantSettings";
import type { MediaAsset } from "./mediaAssets";

export type DeterministicPhase =
  | "idle"
  | "assist"
  | "collecting_order_type"
  | "collecting_address"
  | "collecting_payment"
  | "ready"
  | "handoff";

export type PaymentMethod = "pix" | "cartao" | "dinheiro" | "outro";

export type PaymentTiming = "agora" | "na_entrega" | "na_retirada" | "indefinido";

export type OrderType = "delivery" | "retirada";

export type DeterministicState = {
  phase: DeterministicPhase;
  enteredAt: string;
  lastUserAt: string;
  lastBotAt?: string | null;
  hasIntroduced?: boolean | null;

  // Pre-order fields
  orderType?: OrderType | null;
  addressText?: string | null;
  neighborhood?: string | null;
  paymentMethod?: PaymentMethod | null;
  paymentTiming?: PaymentTiming | null;

  // Assist CTA throttling (to avoid being mechanical)
  assistCtaCount?: number | null;
  lastAssistCtaAt?: string | null;

  // Handoff
  handoffActive?: boolean | null;
};

export type MachineDecision =
  | { mode: "deterministic"; replyText: string; updatedState: DeterministicState; transitioned: boolean }
  | { mode: "llm"; appendCta?: string | null; updatedState: DeterministicState; transitioned: boolean };

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function looksLikeQuestionOrInfo(textNorm: string): boolean {
  // Heuristic: info requests; keep it conservative.
  const needles = [
    "cardapio",
    "cardápio",
    "menu",
    "preco",
    "preço",
    "valor",
    "horario",
    "horário",
    "funciona",
    "aberto",
    "fecha",
    "endereco",
    "endereço",
    "onde fica",
    "localizacao",
    "localização",
    "tem ",
    "quais",
    "como",
    "qual",
  ];
  if (textNorm.endsWith("?")) return true;
  return needles.some((n) => textNorm.includes(n));
}

function looksLikeOrderIntent(textNorm: string): boolean {
  // Seja conservador: evitar iniciar fluxo de pedido por qualquer "quero" genérico.
  const strong = ["quero pedir", "fazer pedido", "fazer um pedido", "pedido", "pedir", "encomendar", "pode anotar", "anota", "fechar pedido", "confirmar pedido"];
  if (strong.some((n) => textNorm.includes(n))) return true;

  // Sinais fracos só contam se vierem acompanhados de outro indicativo.
  const weak = ["manda", "traz", "confirmar", "fechar"];
  const context = ["entrega", "delivery", "retirada", "pix", "cartao", "dinheiro", "endereco", "bairro", "rua", "cep"];
  if (weak.some((n) => textNorm.includes(n)) && context.some((c) => textNorm.includes(c))) return true;
  return false;
}

function parseOrderType(textNorm: string): OrderType | null {
  if (textNorm.includes("retirada") || textNorm.includes("retirar") || textNorm.includes("buscar") || textNorm.includes("pegar")) return "retirada";
  if (textNorm.includes("delivery") || textNorm.includes("entrega") || textNorm.includes("entregar")) return "delivery";
  return null;
}

function parsePayment(textNorm: string): { method?: PaymentMethod; timing?: PaymentTiming } {
  let method: PaymentMethod | undefined;
  let timing: PaymentTiming | undefined;

  if (textNorm.includes("pix")) method = "pix";
  else if (textNorm.includes("cartao") || textNorm.includes("cartão") || textNorm.includes("credito") || textNorm.includes("crédito") || textNorm.includes("debito") || textNorm.includes("débito")) method = "cartao";
  else if (textNorm.includes("dinheiro")) method = "dinheiro";

  if (textNorm.includes("agora") || textNorm.includes("já") || textNorm.includes("ja ")) timing = "agora";
  if (textNorm.includes("na entrega") || textNorm.includes("entrega")) timing = "na_entrega";
  if (textNorm.includes("na retirada") || textNorm.includes("retirada")) timing = "na_retirada";

  return { method, timing };
}

function buildCtaOrderStart(): string {
  // C2 decision: CTA to start the order.
  return "Quer que eu já anote seu pedido? Prefere delivery ou retirada?";
}

function ensureDeterministicState(raw: ConversationState | null | undefined): DeterministicState {
  const now = nowIso();
  const phase = (raw && typeof raw.phase === "string" ? (raw.phase as DeterministicPhase) : "idle") || "idle";
  const enteredAt = (raw && typeof raw.enteredAt === "string" ? raw.enteredAt : now) as string;
  const lastUserAt = (raw && typeof raw.lastUserAt === "string" ? raw.lastUserAt : now) as string;

  return {
    phase,
    enteredAt,
    lastUserAt,
    lastBotAt: (raw && (raw as any).lastBotAt) || null,
    hasIntroduced: (raw as any)?.hasIntroduced ?? null,

    orderType: (raw as any)?.orderType ?? null,
    addressText: (raw as any)?.addressText ?? null,
    neighborhood: (raw as any)?.neighborhood ?? null,
    paymentMethod: (raw as any)?.paymentMethod ?? null,
    paymentTiming: (raw as any)?.paymentTiming ?? null,

    assistCtaCount: (raw as any)?.assistCtaCount ?? 0,
    lastAssistCtaAt: (raw as any)?.lastAssistCtaAt ?? null,

    handoffActive: (raw as any)?.handoffActive ?? false,
  };
}

function transition(state: DeterministicState, next: DeterministicPhase): DeterministicState {
  const now = nowIso();
  return { ...state, phase: next, enteredAt: now };
}

function minutesSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 1000 / 60;
}

export async function decideInboundDeterministic(opts: {
  key: ConversationKey;
  text: string;
  assistantSettings: AssistantSettings;
  mediaAssets: MediaAsset[];
}): Promise<MachineDecision> {
  const textNorm = normalizeText(opts.text);
  const now = nowIso();

  const raw = await getConversationState(opts.key);
  let st = ensureDeterministicState(raw);
  st = { ...st, lastUserAt: now };

  // If handoff is active, do not intervene. LLM/automation should be silent; caller can handle.
  if (st.phase === "handoff" || st.handoffActive) {
    return { mode: "llm", appendCta: null, updatedState: st, transitioned: false };
  }

  // 1) Primeira mensagem: sempre apresenta e mostra menu (B1).
  if (!st.hasIntroduced) {
    const next = { ...st, hasIntroduced: true };
    return {
      mode: "deterministic",
      replyText: buildMenuMessage(opts.assistantSettings),
      updatedState: next,
      transitioned: true,
    };
  }

  // 2) Seleção do menu (resposta "1", "2", etc.)
  const menuItems = normalizeMenuItems(opts.assistantSettings);
  const choice = parseMenuChoice(opts.text);
  if (choice && choice >= 1 && choice <= menuItems.length) {
    const item = menuItems[choice - 1];
    const action = item.action;

    if (action === "human") {
      const handoffText = (opts.assistantSettings.humanHandoffText || "Ok. Vou chamar um humano para te ajudar.").trim();
      const next = { ...transition(st, "handoff"), handoffActive: true };
      return { mode: "deterministic", replyText: handoffText, updatedState: next, transitioned: true };
    }

    if (action === "hours_location") {
      const parts: string[] = [];
      const h = (opts.assistantSettings.businessHoursText || "").trim();
      const a = (opts.assistantSettings.addressText || "").trim();
      if (h) parts.push(`Horários: ${h}`);
      if (a) parts.push(`Endereço: ${a}`);
      if (parts.length === 0) parts.push("A loja ainda não configurou horários/endereço.");
      return { mode: "deterministic", replyText: parts.join("\n"), updatedState: st, transitioned: false };
    }

    if (action === "products") {
      const parts: string[] = [];
      const highlights = (opts.assistantSettings.highlightsText || "").trim();
      if (highlights) parts.push(highlights);

      const products = (await listProducts(opts.key.clientId)).filter((p) => p.active);
      if (products.length) {
        const top = products.slice(0, 8);
        parts.push("Produtos:");
        for (const p of top) {
          const price = `R$ ${(p.priceCents / 100).toFixed(2).replace(".", ",")}`;
          parts.push(`- ${p.name} — ${price}${p.description ? `\n  ${p.description}` : ""}`);
        }
        if (products.length > top.length) parts.push(`(mais ${products.length - top.length} no catálogo)`);
      } else {
        parts.push("A loja ainda não cadastrou produtos.");
      }

      const priceTable = opts.mediaAssets.find((m) => (m as any)?.meta?.isOfficialPriceTable === true || (m as any)?.meta?.priceTableOfficial === true);
      if (priceTable?.url) parts.push(`Cardápio/arquivo: ${priceTable.url}`);

      parts.push("\nPara fazer pedido, responda 2.");
      return { mode: "deterministic", replyText: parts.join("\n"), updatedState: st, transitioned: false };
    }

    // action === "order" (abaixo, com gate de catálogo)
  }

  // If user clearly does NOT want to order now, reset gently.
  if (textNorm.includes("nao") && (textNorm.includes("agora") || textNorm.includes("só") || textNorm.includes("so"))) {
    const next = transition(st, "idle");
    return {
      mode: "deterministic",
      replyText: "Perfeito. Quando quiser, é só me chamar por aqui.",
      updatedState: next,
      transitioned: true,
    };
  }

  // Order intent always starts (or resumes) the deterministic flow.
  const wantsOrder = (choice && menuItems[choice - 1]?.action === "order") || looksLikeOrderIntent(textNorm);
  if (wantsOrder) {
    if (st.phase === "idle" || st.phase === "assist") {
      // Gate: sem catálogo completo não pode iniciar pré-pedido.
      const requireCatalog = opts.assistantSettings.requireCatalogForPreorder !== false;
      if (requireCatalog) {
        const readiness = await getCatalogReadiness(opts.key.clientId);
        if (!readiness.ready) {
          const issues = readiness.issues.map((i) => `- ${i.message}`).join("\n");
          const msg =
            "Pedidos automáticos ainda não estão ativos porque o catálogo não está completo.\n" +
            `${issues || "- Cadastre ao menos 1 produto com descrição e preço"}\n\n` +
            "Você pode: \n" +
            "1) ver produtos (responda 1)\n" +
            "2) falar com humano (responda 4)";
          return { mode: "deterministic", replyText: msg, updatedState: st, transitioned: false };
        }
      }
      const next = transition(st, "collecting_order_type");
      return { mode: "deterministic", replyText: "Ótimo. Prefere delivery ou retirada?", updatedState: next, transitioned: true };
    }
  }

  // Phase logic
  if (st.phase === "collecting_order_type") {
    const ot = parseOrderType(textNorm);
    if (!ot) {
      return { mode: "deterministic", replyText: "Só para eu anotar certinho: você prefere delivery ou retirada?", updatedState: st, transitioned: false };
    }
    st = { ...st, orderType: ot };
    if (ot === "delivery") {
      const next = transition(st, "collecting_address");
      return { mode: "deterministic", replyText: "Perfeito. Qual seu bairro e endereço completo para entrega?", updatedState: next, transitioned: true };
    }
    // retirada
    const next = transition(st, "collecting_payment");
    return { mode: "deterministic", replyText: "Beleza. Como prefere pagar (pix, cartão ou dinheiro) e é agora ou na retirada?", updatedState: next, transitioned: true };
  }

  if (st.phase === "collecting_address") {
    // Accept free-form and store.
    const addr = String(opts.text || "").trim();
    if (!addr) {
      return { mode: "deterministic", replyText: "Me diga seu bairro e endereço completo, por favor.", updatedState: st, transitioned: false };
    }
    // Try to extract neighborhood if user mentions "bairro"
    let bairro: string | null = st.neighborhood ?? null;
    const m = addr.toLowerCase().match(/bairro\s*[:\-]?\s*([^,\n]+)/i);
    if (m && m[1]) bairro = String(m[1]).trim() || bairro;

    st = { ...st, addressText: addr, neighborhood: bairro };
    const next = transition(st, "collecting_payment");
    return { mode: "deterministic", replyText: "Obrigado. Como prefere pagar (pix, cartão ou dinheiro) e é agora ou na entrega?", updatedState: next, transitioned: true };
  }

  if (st.phase === "collecting_payment") {
    const parsed = parsePayment(textNorm);
    const method = parsed.method ?? st.paymentMethod ?? null;
    const timing = parsed.timing ?? st.paymentTiming ?? null;

    st = { ...st, paymentMethod: method, paymentTiming: timing };

    if (!method) {
      return { mode: "deterministic", replyText: "Como você prefere pagar? (pix, cartão ou dinheiro)", updatedState: st, transitioned: false };
    }
    if (!timing) {
      const timingHint = st.orderType === "retirada" ? "agora ou na retirada" : "agora ou na entrega";
      return { mode: "deterministic", replyText: `E o pagamento é ${timingHint}?`, updatedState: st, transitioned: false };
    }

    const next = transition(st, "ready");
    const summaryBits: string[] = [];
    summaryBits.push(st.orderType === "retirada" ? "Retirada" : "Delivery");
    if (st.orderType === "delivery") summaryBits.push(st.addressText ? `Endereço: ${st.addressText}` : "Endereço: (pendente)");
    summaryBits.push(`Pagamento: ${method}${timing ? ` (${timing})` : ""}`);

    return {
      mode: "deterministic",
      replyText: `Perfeito. Pré-pedido anotado.\n${summaryBits.join("\n")}\n\nO que você quer pedir?`,
      updatedState: next,
      transitioned: true,
    };
  }

  if (st.phase === "ready") {
    // At this stage, user can place the actual order items; keep LLM for flexibility.
    // We still keep the deterministic state; LLM can collect items.
    return { mode: "llm", appendCta: null, updatedState: st, transitioned: false };
  }

  // idle/assist: if it's info/question, stay in assist and let LLM answer, then append CTA (throttled).
  if (looksLikeQuestionOrInfo(textNorm) || st.phase === "assist") {
    const transitioned = st.phase !== "assist";
    if (transitioned) st = transition(st, "assist");

    // Throttle CTA to avoid being mechanical (max 1 CTA per 5 minutes while in assist).
    const mins = minutesSince(st.lastAssistCtaAt);
    const shouldAppendCta = mins >= 5;
    const appendCta = shouldAppendCta ? buildCtaOrderStart() : null;

    if (shouldAppendCta) {
      st = { ...st, assistCtaCount: (st.assistCtaCount || 0) + 1, lastAssistCtaAt: now };
    }

    return { mode: "llm", appendCta, updatedState: st, transitioned };
  }

  // Default: idle and let LLM handle (conversation).
  return { mode: "llm", appendCta: null, updatedState: st, transitioned: false };
}

export async function persistDeterministicState(opts: {
  key: ConversationKey;
  state: DeterministicState;
  transitioned: boolean;
}): Promise<void> {
  await setConversationState(opts.key, opts.state as unknown as ConversationState);

  if (opts.transitioned) {
    // Best-effort audit event
    try {
      await appendConversationEvent({
        id: makeEventId({ clientId: opts.key.clientId, instance: opts.key.instance, remoteJid: opts.key.remoteJid, eventType: "state_transition" }),
        createdAt: nowIso(),
        clientId: opts.key.clientId,
        instance: opts.key.instance,
        remoteJid: opts.key.remoteJid,
        eventType: "state_transition",
        payload: { phase: opts.state.phase },
        meta: {},
      });
    } catch {
      // ignore
    }
  }
}
