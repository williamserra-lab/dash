// src/lib/evolutionConfig.ts
export type EvolutionConfig = {
  baseUrl: string;
  instance: string;
  apiKey: string;
};

export function getEvolutionConfig(): EvolutionConfig | null {
  const baseUrl = (process.env.EVOLUTION_BASE_URL || "").trim();
  const instance = (process.env.EVOLUTION_INSTANCE || "").trim();
  // Compat: já existiu EVOLUTION_APIKEY e EVOLUTION_API_KEY em exemplos.
  const apiKey = (process.env.EVOLUTION_API_KEY || process.env.EVOLUTION_APIKEY || "").trim();

  if (!baseUrl || !instance || !apiKey) return null;
  return { baseUrl, instance, apiKey };
}

export function getEvolutionTenantClientId(): string | null {
  const v = (process.env.EVOLUTION_TENANT_CLIENT_ID || "").trim();
  return v ? v : null;
}
