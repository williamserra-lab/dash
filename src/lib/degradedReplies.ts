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
 * Deterministic fallback used in inbound atendimento.
 * - technical: generic instability, keep questions minimal
 * - budget: explicit economic mode (plan limit reached)
 */
export function buildInboundDegradedReply(reason: InboundDegradeReason): string {
  if (reason === "budget") {
    return (
      "No momento estou em modo econômico (limite do plano atingido).\n\n" +
      orderChecklist(true)
    );
  }

  return (
    "Estou com instabilidade técnica agora.\n\n" +
    orderChecklist(false)
  );
}
