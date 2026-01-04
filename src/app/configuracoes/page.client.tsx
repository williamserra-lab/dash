"use client";

// src/app/configuracoes/page.tsx
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LLMProvider } from "@/lib/llm";

type Settings = {
  systemPrompt?: string;
  personality?: string;
  verbosity?: "conciso" | "equilibrado" | "prolixo";
  temperature?: number;
  llm?: { provider?: LLMProvider; model?: string };
  secrets?: { hasApiKey?: boolean; canStoreSecrets?: boolean };
};

const DEFAULT_SYSTEM = `Você é um assistente de WhatsApp de uma loja.
Regras:
- Responda em português do Brasil.
- Seja objetivo e útil.
- Se faltarem dados para fechar um pedido/agendamento, faça perguntas curtas e diretas.
- Não invente preços. Se o cliente pedir valores, use a tabela oficial (quando existir) ou peça confirmação ao atendente.`;

const PERSONALITIES = [
  { id: "profissional", label: "Profissional (neutro)" },
  { id: "amigavel", label: "Amigável (calor humano, sem enrolar)" },
  { id: "direto", label: "Direto (curto, sem conversa)" },
  { id: "vendedor_consultivo", label: "Vendedor consultivo (pergunta e conduz)" },
];

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ConfiguracoesPage() {
  const searchParams = useSearchParams();
  const [clientId, setClientId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM);
  const [personality, setPersonality] = useState("profissional");
  const [verbosity, setVerbosity] = useState<"conciso" | "equilibrado" | "prolixo">("equilibrado");
  const [temperature, setTemperature] = useState(0.3);

  const [provider, setProvider] = useState<LLMProvider>("ollama");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [canStoreSecrets, setCanStoreSecrets] = useState(false);
  const [clearKey, setClearKey] = useState(false);

  useEffect(() => {
    const id = searchParams.get("clientId");
    setClientId(id);
  }, [searchParams]);

  async function loadSettings(id: string) {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/clients/${id}/settings`, { cache: "no-store" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any)?.error || "Falha ao carregar configurações.");
      }
      const body = (await res.json()) as { settings: Settings };
      const s = body.settings ?? {};
      setSystemPrompt(s.systemPrompt?.trim() ? s.systemPrompt : DEFAULT_SYSTEM);
      setPersonality(s.personality || "profissional");
      setVerbosity(s.verbosity || "equilibrado");
      setTemperature(typeof s.temperature === "number" ? s.temperature : 0.3);
      setProvider((s.llm?.provider as LLMProvider) || "ollama");
      setModel(s.llm?.model || "");
      setHasApiKey(Boolean(s.secrets?.hasApiKey));
      setCanStoreSecrets(Boolean(s.secrets?.canStoreSecrets));
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!clientId) return;
    loadSettings(clientId);
  }, [clientId]);

  const costHint = useMemo(() => {
    if (provider === "ollama") return "Custo por token: baixo (local). Ainda assim, prolixidade aumenta latência.";
    return "Quanto mais prolixo, maior o custo (mais tokens).";
  }, [provider]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!clientId) return;

    try {
      setSaving(true);
      setError(null);
      setOkMsg(null);

      const payload: Record<string, unknown> = {
        systemPrompt,
        personality,
        verbosity,
        temperature,
        llm: { provider, model: model.trim() || undefined },
      };

      if (provider === "openai" || provider === "gemini") {
        if (clearKey) payload.clearApiKey = true;
        if (apiKey.trim()) payload.apiKey = apiKey.trim();
      }

      const res = await fetch(`/api/clients/${clientId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any)?.error || "Falha ao salvar.");
      }

      const body = await res.json();
      setHasApiKey(Boolean((body as any)?.settings?.secrets?.hasApiKey));
      setCanStoreSecrets(Boolean((body as any)?.settings?.secrets?.canStoreSecrets));
      setApiKey("");
      setClearKey(false);
      setOkMsg("Configurações salvas.");
      setTimeout(() => setOkMsg(null), 1200);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-white p-4">
        <h1 className="text-lg font-semibold">Configurações do Assistente</h1>
        <p className="mt-1 text-sm text-gray-600">
          Defina regras, personalidade e LLM sem precisar mexer em código.
        </p>

        {!clientId ? (
          <div className="mt-3 rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
            Informe <b>?clientId=</b> na URL.
          </div>
        ) : (
          <div className="mt-3 text-sm text-gray-700">
            <span className="font-medium">Cliente:</span> {clientId}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4">
        {loading ? <p className="text-sm text-gray-600">Carregando...</p> : null}

        {!loading && clientId ? (
          <form onSubmit={handleSave} className="grid gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Prompt (o que pode e não pode fazer)
              </label>
              <textarea
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                rows={8}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Personalidade</label>
                <select
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                >
                  {PERSONALITIES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Estilo (custo)</label>
                <select
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={verbosity}
                  onChange={(e) => setVerbosity(e.target.value as "conciso" | "equilibrado" | "prolixo")}
                >
                  <option value="conciso">Conciso</option>
                  <option value="equilibrado">Equilibrado</option>
                  <option value="prolixo">Prolixo</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">{costHint}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Temperatura</label>
                <input
                  className="mt-2 w-full"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                />
                <div className="mt-1 text-xs text-gray-600">Atual: {temperature.toFixed(2)}</div>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="text-sm font-semibold text-gray-800">LLM</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Provedor</label>
                  <select
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as LLMProvider)}
                  >
                    <option value="ollama">Ollama (local)</option>
                    <option value="openai">OpenAI (pago)</option>
                    <option value="gemini">Gemini (pago)</option>
                      <option value="groq">Groq (pago)</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Modelo (opcional)</label>
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Ex.: gpt-4o-mini, gemini-1.5-flash, llama3.1"
                  />
                </div>
              </div>

              {(provider === "openai" || provider === "gemini") && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Access key (opcional)</label>
                    <input
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={hasApiKey ? "Já existe uma chave salva (não exibida)" : "Cole a chave aqui"}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {canStoreSecrets
                        ? "A chave é salva criptografada (server-side)."
                        : "NEXTIA_MASTER_KEY ausente: não é possível salvar chaves com segurança."}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-6 text-sm">
                    <input
                      type="checkbox"
                      checked={clearKey}
                      onChange={(e) => setClearKey(e.target.checked)}
                    />
                    <span>Remover chave salva</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>

              {okMsg ? <span className="text-sm text-green-700">{okMsg}</span> : null}
            </div>

            {error ? (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>
            ) : null}
          </form>
        ) : null}
      </div>
    </div>
  );
}