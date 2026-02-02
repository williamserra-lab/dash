// src/lib/degradedReplies.ts
// Centralized deterministic replies used when we cannot (or must not) call an LLM.
// Keep this module pure/deterministic.

export type InboundDegradeReason = "technical" | "budget";

function orderChecklist(includeItems: boolean): string {
  const itemsLine = includeItems ? "- itens do pedido\n" : "";
  return (
    "Para eu registrar seu pedido, me diga:\n" +
    "- delivery ou retirada\n" +
    "- seu endereço (se delivery)\n" +
    itemsLine +
    "- forma de pagamento"
  );
}

/**
 * Deterministic reply used when we can still help, but must reduce cost/complexity.
 * This must not call any LLM.
 */
export function buildInboundDegradedReply(reason: InboundDegradeReason): string {
  if (reason === "budget") {
    return (
      "No momento o assistente automático está em modo econômico (limite mensal perto de acabar).\n" +
      "As respostas inteligentes (IA/LLM) estão temporariamente desativadas para evitar parar de surpresa.\n\n" +
      orderChecklist(true)
    );
  }

  return "Estou com instabilidade técnica agora.\n\n" + orderChecklist(false);
}

/**
 * Deterministic reply used when the budget is exhausted (hard stop).
 * This must be deterministic (no LLM).
 */
export function buildInboundBlockedReply(): string {
  return (
    "Limite mensal de créditos de IA atingido. O assistente automático foi pausado.\n\n" +
    "Por favor, aguarde um atendente humano para continuar o atendimento."
  );
}
