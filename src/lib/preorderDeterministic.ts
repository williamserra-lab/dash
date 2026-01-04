// src/lib/preorderDeterministic.ts
// Deterministic pre-order flow (multi-tenant).
//
// Business decisions incorporated:
// - "Oi" does NOT open numeric menu.
// - Respond with greeting + framing ("sou assistente virtual") and guide.
// - Pre-order requires: delivery vs retirada, endereço/bairro (for fee), pagamento (método + timing).
// - If mismatch with repository (e.g., bairro not found in tabela) => do not invent => handoff to human via summary.

import { getDeliveryPricing } from "./deliveryPricing";
import { getConversationState, setConversationState } from "./nextiaConversationStateStore";

export type PreorderStage =
  | "new"
  | "awaiting_intent"
  | "awaiting_delivery_method"
  | "awaiting_bairro"
  | "awaiting_address"
  | "awaiting_items"
  | "awaiting_payment_method"
  | "awaiting_payment_timing"
  | "ready_for_handoff"
  | "handoff";

export type PreorderState = {
  v: 1;
  stage: PreorderStage;
  createdAt: string;
  updatedAt: string;

  // collected
  intent?: "info" | "order" | null;
  deliveryMethod?: "delivery" | "retirada" | null;
  bairro?: string | null;
  address?: string | null;
  itemsText?: string | null;
  paymentMethod?: "pix" | "cartao" | "dinheiro" | "outro" | null;
  paymentTiming?: "agora" | "na_entrega" | null;

  // decision flags
  needsHuman?: boolean;
  humanReason?: string | null;

  // timestamps for SLA/metrics (future)
  lastAssistantAt?: string | null;
  lastCustomerAt?: string | null;
  acceptedByHumanAt?: string | null;

  // summary for human
  summary?: string | null;
};

export type PreorderInput = {
  clientId: string;
  instance: string;
  remoteJid: string;
  text: string;
};

export type PreorderResult = {
  handled: boolean;
  replyText?: string;
  state?: PreorderState;
};

function nowIso(): string {
  return new Date().toISOString();
}

function norm(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isGreeting(t: string): boolean {
  const x = norm(t);
  return (
    x === "oi" ||
    x === "ola" ||
    x.startsWith("oi ") ||
    x.startsWith("ola ") ||
    x.includes("bom dia") ||
    x.includes("boa tarde") ||
    x.includes("boa noite")
  );
}

function looksLikeWantsInfo(t: string): boolean {
  const x = norm(t);
  return (
    x.includes("cardapio") ||
    x.includes("menu") ||
    x.includes("tabela") ||
    x.includes("preco") ||
    x.includes("preco") ||
    x.includes("inform") ||
    x.includes("taxa") ||
    x.includes("entrega") ||
    x.includes("pagamento") ||
    x.includes("horario") ||
    x.includes("funcion")
  );
}

function looksLikeOrder(t: string): boolean {
  const x = norm(t);
  if (x.includes("quero")) return true;
  if (x.includes("pedido")) return true;
  if (x.includes("comprar")) return true;
  if (x.match(/\b\d+\s*x\b/)) return true;
  if (x.match(/\b\d+\b/)) return true; // conservative
  return false;
}

function parseDeliveryMethod(t: string): "delivery" | "retirada" | null {
  const x = norm(t);
  if (x.includes("retir") || x.includes("buscar") || x.includes("peg")) return "retirada";
  if (x.includes("delivery") || x.includes("entreg") || x.includes("levar")) return "delivery";
  return null;
}

function parsePaymentMethod(t: string): "pix" | "cartao" | "dinheiro" | "outro" | null {
  const x = norm(t);
  if (x.includes("pix")) return "pix";
  if (x.includes("cart")) return "cartao";
  if (x.includes("dinhe")) return "dinheiro";
  if (x.includes("credito") || x.includes("debito")) return "cartao";
  return null;
}

function parsePaymentTiming(t: string, deliveryMethod?: "delivery" | "retirada" | null): "agora" | "na_entrega" | null {
  const x = norm(t);
  if (x.includes("agora") || x.includes("adiant") || x.includes("ja")) return "agora";
  if (x.includes("na entrega") || x.includes("quando chegar")) return "na_entrega";
  if (deliveryMethod === "retirada" && (x.includes("na retirada") || x.includes("quando eu for"))) return "na_entrega";
  return null;
}

function asHumanSummary(s: PreorderState, remoteJid: string): string {
  const parts: string[] = [];
  parts.push(`Contato: ${remoteJid}`);
  if (s.deliveryMethod) parts.push(`Entrega/Retirada: ${s.deliveryMethod}`);
  if (s.bairro) parts.push(`Bairro: ${s.bairro}`);
  if (s.address) parts.push(`Endereço: ${s.address}`);
  if (s.itemsText) parts.push(`Itens (texto): ${s.itemsText}`);
  if (s.paymentMethod) parts.push(`Pagamento: ${s.paymentMethod}`);
  if (s.paymentTiming) parts.push(`Timing pagamento: ${s.paymentTiming}`);
  if (s.needsHuman) parts.push(`⚠️ Precisa humano: ${s.humanReason || "motivo não informado"}`);
  return parts.join("\n");
}

function buildGreeting(): string {
  return (
    `Olá! Eu sou o assistente virtual da loja.\n` +
    `Posso te ajudar com informações (cardápio, preços, entrega, pagamento) ou já montar seu pedido.\n\n` +
    `Você quer informações primeiro ou prefere já fazer o pedido?`
  );
}

async function replyDeliveryInfo(clientId: string, bairro: string | null): Promise<{ text: string; ok: boolean }> {
  const pricing = await getDeliveryPricing(clientId);
  if (!pricing) {
    return {
      ok: true,
      text: `Certo. Para delivery, me diga seu bairro (para eu confirmar a taxa) e o endereço completo.`,
    };
  }

  if (pricing.mode === "fixed") {
    const feeReais = Number(pricing.fixedFeeCents || 0) / 100;
    const feeText = Number.isFinite(feeReais)
      ? `Taxa: R$ ${feeReais.toFixed(2).replace(".", ",")}.`
      : `Taxa: a confirmar.`;
    return {
      ok: true,
      text: `Delivery ok. ${feeText}
Agora me informe seu bairro e o endereço completo.`,
    };
  }

  // by_neighborhood
  if (!bairro) {
    return {
      ok: true,
      text: `Para delivery, me informe seu bairro (para eu confirmar a taxa).`,
    };
  }

  const found = pricing.byNeighborhood.find((x) => norm(x.neighborhood) === norm(bairro));
  if (!found) {
    return {
      ok: false,
      text:
        `Entendi. Eu não encontrei esse bairro na tabela de entrega.
` +
        `Vou acionar um atendente humano para confirmar a taxa e seguir com seu pedido.`,
    };
  }

  const feeReais = Number(found.feeCents || 0) / 100;
  const feeText = `Taxa para ${found.neighborhood}: R$ ${feeReais.toFixed(2).replace(".", ",")}.`;

  const etaMin = typeof found.etaMinutesMin === "number" ? found.etaMinutesMin : null;
  const etaMax = typeof found.etaMinutesMax === "number" ? found.etaMinutesMax : null;
  const etaText =
    etaMin !== null && etaMax !== null
      ? `Prazo estimado: ${etaMin}-${etaMax} min.`
      : etaMin !== null
        ? `Prazo estimado: ~${etaMin} min.`
        : etaMax !== null
          ? `Prazo estimado: ~${etaMax} min.`
          : "";

  return {
    ok: true,
    text: `Delivery ok. ${feeText} ${etaText}
Agora me informe o endereço completo (rua, número e complemento).`,
  };
}

export async function handleDeterministicPreorder(input: PreorderInput): Promise<PreorderResult> {
  const text = String(input.text || "").trim();
  if (!text) return { handled: false };

  const key = { clientId: input.clientId, instance: input.instance, remoteJid: input.remoteJid };

  const raw = (await getConversationState(key)) as PreorderState | null;
  const state: PreorderState =
    raw && raw.v === 1
      ? raw
      : {
          v: 1,
          stage: "new",
          createdAt: nowIso(),
          updatedAt: nowIso(),
          intent: null,
          deliveryMethod: null,
          bairro: null,
          address: null,
          itemsText: null,
          paymentMethod: null,
          paymentTiming: null,
          needsHuman: false,
          humanReason: null,
          summary: null,
          lastAssistantAt: null,
          lastCustomerAt: null,
          acceptedByHumanAt: null,
        };

  state.lastCustomerAt = nowIso();
  state.updatedAt = nowIso();

  // Global handoff stop
  if (state.stage === "handoff") {
    state.summary = asHumanSummary(state, input.remoteJid);
    await setConversationState(key, state);
    return { handled: true, state };
  }

  // New conversation or greeting
  if (state.stage === "new") {
    state.stage = "awaiting_intent";
    state.updatedAt = nowIso();
    state.summary = asHumanSummary(state, input.remoteJid);
    await setConversationState(key, state);

    // If it's not a greeting but looks like order, skip question.
    if (!isGreeting(text) && looksLikeOrder(text)) {
      // attempt to infer intent/order and continue
      state.intent = "order";
      state.stage = "awaiting_delivery_method";
      state.itemsText = text;
      state.summary = asHumanSummary(state, input.remoteJid);
      await setConversationState(key, state);
      return {
        handled: true,
        replyText:
          `Perfeito. Você prefere *delivery* ou *retirada*?\n` +
          `Se for delivery, me diga também seu bairro (para taxa).`,
        state,
      };
    }

    return { handled: true, replyText: buildGreeting(), state };
  }

  // awaiting intent: info vs order
  if (state.stage === "awaiting_intent") {
    if (looksLikeWantsInfo(text) && !looksLikeOrder(text)) {
      state.intent = "info";
      state.stage = "awaiting_delivery_method";
      state.summary = asHumanSummary(state, input.remoteJid);
      await setConversationState(key, state);

      return {
        handled: true,
        replyText:
          `Ok. Antes do pedido, eu posso te passar informações (cardápio/preços, entrega e formas de pagamento).\n` +
          `Você prefere *delivery* ou *retirada*?`,
        state,
      };
    }

    // Default to order
    state.intent = "order";
    state.stage = "awaiting_delivery_method";
    // if user already wrote items, keep it
    if (looksLikeOrder(text)) state.itemsText = state.itemsText || text;

    state.summary = asHumanSummary(state, input.remoteJid);
    await setConversationState(key, state);

    // If the message already includes delivery/retirada, proceed
    const dm = parseDeliveryMethod(text);
    if (dm) {
      state.deliveryMethod = dm;
      if (dm === "delivery") {
        state.stage = "awaiting_bairro";
        state.summary = asHumanSummary(state, input.remoteJid);
        await setConversationState(key, state);
        return { handled: true, replyText: `Delivery ok. Qual é o seu bairro?`, state };
      }

      state.stage = "awaiting_items";
      state.summary = asHumanSummary(state, input.remoteJid);
      await setConversationState(key, state);
      return {
        handled: true,
        replyText:
          `Retirada ok. Agora me diga o que você deseja pedir (itens e quantidades).`,
        state,
      };
    }

    return {
      handled: true,
      replyText: `Você prefere *delivery* ou *retirada*?\nSe for delivery, me diga também seu bairro (para taxa).`,
      state,
    };
  }

  // delivery method
  if (state.stage === "awaiting_delivery_method") {
    const dm = parseDeliveryMethod(text);
    if (!dm) {
      return {
        handled: true,
        replyText: `Não entendi. Você prefere *delivery* ou *retirada*?`,
        state,
      };
    }

    state.deliveryMethod = dm;

    if (dm === "delivery") {
      state.stage = "awaiting_bairro";
      state.summary = asHumanSummary(state, input.remoteJid);
      await setConversationState(key, state);
      return { handled: true, replyText: `Perfeito. Qual é o seu bairro?`, state };
    }

    state.stage = "awaiting_items";
    state.summary = asHumanSummary(state, input.remoteJid);
    await setConversationState(key, state);

    return {
      handled: true,
      replyText: `Retirada ok. Me diga o que você deseja pedir (itens e quantidades).`,
      state,
    };
  }

  // bairro for delivery (and validate pricing)
  if (state.stage === "awaiting_bairro") {
    const bairro = text;
    state.bairro = bairro;

    const info = await replyDeliveryInfo(input.clientId, bairro);

    if (!info.ok) {
      state.needsHuman = true;
      state.humanReason = "bairro não encontrado na tabela de entrega";
      state.stage = "handoff";
      state.summary = asHumanSummary(state, input.remoteJid);
      await setConversationState(key, state);
      return { handled: true, replyText: info.text, state };
    }

    // proceed to address
    state.stage = "awaiting_address";
    state.summary = asHumanSummary(state, input.remoteJid);
    await setConversationState(key, state);

    return { handled: true, replyText: info.text, state };
  }

  if (state.stage === "awaiting_address") {
    state.address = text;
    state.stage = "awaiting_items";
    state.summary = asHumanSummary(state, input.remoteJid);
    await setConversationState(key, state);

    return {
      handled: true,
      replyText: `Certo. Agora me diga o que você deseja pedir (itens e quantidades).`,
      state,
    };
  }

  if (state.stage === "awaiting_items") {
    state.itemsText = text;
    state.stage = "awaiting_payment_method";
    state.summary = asHumanSummary(state, input.remoteJid);
    await setConversationState(key, state);

    return {
      handled: true,
      replyText: `Como você prefere pagar? (pix, cartão ou dinheiro)`,
      state,
    };
  }

  if (state.stage === "awaiting_payment_method") {
    const pm = parsePaymentMethod(text);
    if (!pm) {
      return { handled: true, replyText: `Não entendi. Você prefere pagar por *pix*, *cartão* ou *dinheiro*?`, state };
    }
    state.paymentMethod = pm;
    state.stage = "awaiting_payment_timing";
    state.summary = asHumanSummary(state, input.remoteJid);
    await setConversationState(key, state);

    return {
      handled: true,
      replyText:
        `Pagamento por *${pm}* ok.\nVocê quer pagar *agora* ou *na entrega/retirada*?`,
      state,
    };
  }

  if (state.stage === "awaiting_payment_timing") {
    const timing = parsePaymentTiming(text, state.deliveryMethod);
    if (!timing) {
      return {
        handled: true,
        replyText: `Não entendi. Você quer pagar *agora* ou *na entrega/retirada*?`,
        state,
      };
    }

    state.paymentTiming = timing;
    state.stage = "ready_for_handoff";
    state.summary = asHumanSummary(state, input.remoteJid);
    await setConversationState(key, state);

    const resumo =
      `Perfeito. Resumo do seu pré-pedido:\n` +
      `• ${state.deliveryMethod === "delivery" ? "Delivery" : "Retirada"}\n` +
      (state.deliveryMethod === "delivery" ? `• Bairro: ${state.bairro || "(não informado)"}\n` : "") +
      (state.deliveryMethod === "delivery" ? `• Endereço: ${state.address || "(não informado)"}\n` : "") +
      `• Itens: ${state.itemsText || "(não informado)"}\n` +
      `• Pagamento: ${state.paymentMethod || "(não informado)"} (${timing === "agora" ? "agora" : "na entrega/retirada"})\n\n` +
      `Se estiver correto, responda "confirmo".\n` +
      `Um atendente humano vai confirmar e finalizar com você.`;

    return { handled: true, replyText: resumo, state };
  }

  if (state.stage === "ready_for_handoff") {
    if (norm(text) === "confirmo" || norm(text) === "confirmar") {
      state.stage = "handoff";
      state.summary = asHumanSummary(state, input.remoteJid);
      await setConversationState(key, state);

      return {
        handled: true,
        replyText: `Perfeito. Já vou encaminhar para um atendente humano finalizar com você.`,
        state,
      };
    }

    return {
      handled: true,
      replyText: `Se estiver correto, responda "confirmo". Se quiser alterar algo, me diga o que devo ajustar.`,
      state,
    };
  }

  return { handled: false };
}
