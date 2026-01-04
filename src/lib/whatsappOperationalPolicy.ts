// src/lib/whatsappOperationalPolicy.ts
// Política operacional (guardrails) para WhatsApp.
// - defaults "safe" (janela + ritmo + limite diário) para reduzir risco de bloqueio
// - não altera lógica de negócio: apenas limita/agenda envios
//
// Se futuramente quiser overrides por cliente, você pode criar data/whatsapp_policy.json.

export type PaceProfile = "safe" | "balanced" | "aggressive";

export type TimeWindow = {
  timezone: string; // ex.: America/Sao_Paulo
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
};

export type WhatsAppOperationalPolicy = {
  timezone: string;
  window: TimeWindow;
  dailyLimitPerClient: number;     // limite diário por sessão/lojista (PARCIAL)
  perCampaignMax: number;          // teto de segurança por disparo
  defaultPaceProfile: PaceProfile; // default
  pace: Record<PaceProfile, {
    minSecondsBetween: number;
    maxSecondsBetween: number;
    // pausa longa a cada N mensagens
    longPauseEvery: number;
    longPauseMinSeconds: number;
    longPauseMaxSeconds: number;
  }>;
};

export function getWhatsAppOperationalPolicy(): WhatsAppOperationalPolicy {
  // "safe": janela comercial + ritmo conservador.
  return {
    timezone: "America/Sao_Paulo",
    window: {
      timezone: "America/Sao_Paulo",
      start: "09:00",
      end: "19:00",
    },
    dailyLimitPerClient: 200,
    perCampaignMax: 500,
    defaultPaceProfile: "safe",
    pace: {
      safe: {
        minSecondsBetween: 15,
        maxSecondsBetween: 35,
        longPauseEvery: 20,
        longPauseMinSeconds: 90,
        longPauseMaxSeconds: 180,
      },
      balanced: {
        minSecondsBetween: 10,
        maxSecondsBetween: 25,
        longPauseEvery: 25,
        longPauseMinSeconds: 60,
        longPauseMaxSeconds: 140,
      },
      aggressive: {
        minSecondsBetween: 6,
        maxSecondsBetween: 18,
        longPauseEvery: 30,
        longPauseMinSeconds: 45,
        longPauseMaxSeconds: 120,
      },
    },
  };
}
