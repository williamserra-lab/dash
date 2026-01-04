// src/lib/marketingOptOut.ts
// Utilitários centrais para:
// - Forçar aviso de opt-out em mensagens de campanha
// - Detectar comandos de opt-out no inbound 1:1

/**
 * Rodapé padrão de opt-out (marketing).
 * Pode ser sobrescrito via env NEXTIA_MARKETING_OPTOUT_FOOTER.
 */
export function getMarketingOptOutFooter(): string {
  const env = typeof process !== "undefined" ? process.env.NEXTIA_MARKETING_OPTOUT_FOOTER : undefined;
  const footer = String(env ?? "").trim();
  if (footer) return footer;
  return "Para não receber mais mensagens, responda SAIR.";
}

/**
 * Anexa o rodapé de opt-out, se ainda não estiver presente.
 * - Não altera a mensagem original (retorna nova string)
 * - Evita duplicar caso o lojista já tenha escrito o aviso
 */
export function appendMarketingOptOutFooter(message: string): string {
  const base = String(message ?? "").trim();
  if (!base) return base;

  const footer = getMarketingOptOutFooter();
  const hay = base.toLowerCase();
  const needle = footer.toLowerCase();

  // Evita duplicar quando já existir (mesma frase) ou quando já houver instrução explícita.
  if (hay.includes(needle)) return base;
  if (/\bresponda\s+sair\b/i.test(base)) return base;
  if (/\b(stop|parar|cancelar|descadastrar)\b/i.test(base) && /\b(n[aã]o\s*receber|opt[- ]?out|descadast)\b/i.test(base)) {
    return base;
  }

  return `${base}\n\n${footer}`;
}

/**
 * Detecta se um texto recebido é um pedido explícito de opt-out de campanhas.
 * Conservador por padrão (reduz falso-positivo).
 */
export function isMarketingOptOutCommand(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;

  // Comandos curtos e claros
  if (/^(sair|parar|stop|cancelar|descadastrar|remover)\b/i.test(t)) return true;

  // Frases comuns
  if (/\b(n[aã]o\s*quero\s*receber|pare\s+de\s+mandar|n[aã]o\s*me\s*mande)\b/i.test(t)) return true;

  // Evita triggers em mensagens longas/ambíguas sem verbos de interrupção
  return false;
}
