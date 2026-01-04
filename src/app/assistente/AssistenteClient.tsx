// src/app/assistente/AssistenteClient.tsx
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { LLMProvider } from "@/lib/llm";

type Verbosity = "conciso" | "equilibrado" | "prolixo";
type Personality = "profissional" | "amigavel" | "direto" | "vendedor_consultivo";

type AssistantSettings = {
  clientId: string;
  promptRules?: string;
  personality?: Personality;
  verbosity?: Verbosity;
  temperature?: number;
  provider?: LLMProvider;
  model?: string;
  apiKeyLast4?: string;
  greetingText?: string;
  highlightsText?: string;
  businessHoursText?: string;
  addressText?: string;
  humanHandoffText?: string;
  menuItems?: Array<{ id: string; label: string; action: string; enabled?: boolean }>;
  requireCatalogForPreorder?: boolean;
  updatedAt?: string;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function AssistenteClient() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") ?? "";

  const [catalogStatus, setCatalogStatus] = useState<
    | null
    | {
        ready: boolean;
        activeProducts: number;
        issues: Array<{ code: string; message: string; count: number }>;
      }
  >(null);

  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // campos editáveis
  const [promptRules, setPromptRules] = useState("");
  const [personality, setPersonality] = useState<Personality>("profissional");
  const [verbosity, setVerbosity] = useState<Verbosity>("equilibrado");
  const [temperature, setTemperature] = useState<number>(0.2);
  const [provider, setProvider] = useState<LLMProvider>("ollama");
  const [model, setModel] = useState<string>("");
  const [apiKeyPlain, setApiKeyPlain] = useState<string>("");

  // UX / conversa
  const [greetingText, setGreetingText] = useState<string>("");
  const [highlightsText, setHighlightsText] = useState<string>("");
  const [businessHoursText, setBusinessHoursText] = useState<string>("");
  const [addressText, setAddressText] = useState<string>("");
  const [humanHandoffText, setHumanHandoffText] = useState<string>("");
  const [requireCatalogForPreorder, setRequireCatalogForPreorder] = useState<boolean>(true);

  // Menu (4 opções por padrão, mas editável)
  const [menuLabel1, setMenuLabel1] = useState<string>("");
  const [menuLabel2, setMenuLabel2] = useState<string>("");
  const [menuLabel3, setMenuLabel3] = useState<string>("");
  const [menuLabel4, setMenuLabel4] = useState<string>("");

  const costHint = useMemo(() => {
    if (verbosity === "conciso") return "Menos texto, menor custo.";
    if (verbosity === "prolixo") return "Mais texto, maior custo (mais tokens).";
    return "Equilibrado entre clareza e custo.";
  }, [verbosity]);

  useEffect(() => {
    if (!clientId) return;

    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      try {
        const [res, catRes] = await Promise.all([
          fetch(`/api/clients/${clientId}/assistant-settings`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          }),
          fetch(`/api/clients/${clientId}/catalog-status`, { cache: "no-store" }),
        ]);

        if (!res.ok) throw new Error("Erro ao carregar configurações do assistente.");

        const data = (await res.json()) as { settings: AssistantSettings | null };
        setSettings(data.settings);

        // status do catálogo (pré-pedido)
        try {
          const catJson = await catRes.json();
          setCatalogStatus(catJson?.status ?? null);
        } catch {
          setCatalogStatus(null);
        }

        setPromptRules(data.settings?.promptRules ?? "");
        setPersonality(data.settings?.personality ?? "profissional");
        setVerbosity(data.settings?.verbosity ?? "equilibrado");
        setTemperature(typeof data.settings?.temperature === "number" ? data.settings!.temperature! : 0.2);
        setProvider((data.settings?.provider as LLMProvider) ?? "ollama");
        setModel(data.settings?.model ?? "");
        setApiKeyPlain("");

        // UX
        setGreetingText(data.settings?.greetingText ?? "");
        setHighlightsText(data.settings?.highlightsText ?? "");
        setBusinessHoursText(data.settings?.businessHoursText ?? "");
        setAddressText(data.settings?.addressText ?? "");
        setHumanHandoffText(data.settings?.humanHandoffText ?? "");
        setRequireCatalogForPreorder(data.settings?.requireCatalogForPreorder ?? true);

        const labels = (data.settings?.menuItems || []).map((m) => m.label).filter(Boolean);
        setMenuLabel1(labels[0] ?? "Cardápio / produtos");
        setMenuLabel2(labels[1] ?? "Fazer pedido");
        setMenuLabel3(labels[2] ?? "Horários / endereço");
        setMenuLabel4(labels[3] ?? "Falar com humano");
      } catch (err: unknown) {
        console.error(err);
        setErrorMessage(getErrorMessage(err) || "Erro inesperado.");
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, [clientId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!clientId) {
      setErrorMessage("Abra esta página com ?clientId=seu_cliente");
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload: Record<string, unknown> = {
        promptRules,
        personality,
        verbosity,
        temperature,
        provider,
        model: model.trim() || undefined,

        greetingText: greetingText.trim() || undefined,
        highlightsText: highlightsText.trim() || undefined,
        businessHoursText: businessHoursText.trim() || undefined,
        addressText: addressText.trim() || undefined,
        humanHandoffText: humanHandoffText.trim() || undefined,
        requireCatalogForPreorder,
        menuItems: [
          { id: "m1", label: (menuLabel1 || "Cardápio / produtos").trim(), action: "products", enabled: true },
          { id: "m2", label: (menuLabel2 || "Fazer pedido").trim(), action: "order", enabled: true },
          { id: "m3", label: (menuLabel3 || "Horários / endereço").trim(), action: "hours_location", enabled: true },
          { id: "m4", label: (menuLabel4 || "Falar com humano").trim(), action: "human", enabled: true },
        ],
      };

      // Só envia apiKeyPlain se usuário mexeu (evita apagar sem querer)
      if (apiKeyPlain.trim().length > 0) payload.apiKeyPlain = apiKeyPlain.trim();

      const res = await fetch(`/api/clients/${clientId}/assistant-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) throw new Error((json as any)?.error ?? "Erro ao salvar configurações.");

      setSettings((json as any)?.settings ?? null);
      setApiKeyPlain("");
      setSuccessMessage("Configurações salvas.");
    } catch (err: unknown) {
      console.error(err);
      setErrorMessage(getErrorMessage(err) || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveKey() {
    if (!clientId) return;

    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/clients/${clientId}/assistant-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeyPlain: "" }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json as any)?.error ?? "Erro ao remover key.");

      setSettings((json as any)?.settings ?? null);
      setApiKeyPlain("");
      setSuccessMessage("Access key removida.");
    } catch (err: unknown) {
      console.error(err);
      setErrorMessage(getErrorMessage(err) || "Erro ao remover key.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <div className="w-full border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Configurações do assistente</h1>
            <p className="mt-1 max-w-2xl text-xs text-slate-600">
              Isso controla o que o assistente pode/não pode fazer, o estilo de resposta, e o modelo (LLM) usado para o cliente.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={`/produtos?clientId=${encodeURIComponent(clientId)}`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Produtos
            </a>
            <a
              href={`/midias?clientId=${encodeURIComponent(clientId)}`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Mídias
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        {!clientId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Abra esta página com <code>?clientId=seu_cliente</code>.
          </div>
        )}

        {errorMessage && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{errorMessage}</div>
        )}

        {successMessage && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {successMessage}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Assistente do cliente</h2>
            {isLoading && <span className="text-xs text-slate-500">Carregando...</span>}
          </div>

          <form onSubmit={handleSave} className="mt-4 space-y-4 border-t border-slate-100 pt-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Prompt (pode / não pode)</p>
              <textarea
                value={promptRules}
                onChange={(e) => setPromptRules(e.target.value)}
                placeholder="Ex: Você é um assistente do Catia Foods. Pode: informar preços, horários, disponibilidade. Não pode: prometer descontos não autorizados, tratar temas sensíveis..."
                className="mt-2 min-h-[140px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
              <p className="mt-2 text-[11px] text-slate-500">
                Se você não escrever nada, o assistente vai improvisar. Depois não reclame do resultado.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Apresentação e menu (WhatsApp)</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Primeira mensagem: o bot se apresenta e mostra um menu. Isso evita o bot sair "atirando".
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {catalogStatus ? (
                    catalogStatus.ready ? (
                      <span>
                        Pré-pedido: <b className="text-emerald-700">LIBERADO</b> ({catalogStatus.activeProducts} produtos ativos)
                      </span>
                    ) : (
                      <span>
                        Pré-pedido: <b className="text-rose-700">BLOQUEADO</b>
                      </span>
                    )
                  ) : (
                    <span>Pré-pedido: (status indisponível)</span>
                  )}
                </div>
              </div>

              {!catalogStatus?.ready && catalogStatus?.issues?.length ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">O pré-pedido fica bloqueado até o catálogo estar completo:</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {catalogStatus.issues.map((i) => (
                      <li key={i.code}>{i.message}</li>
                    ))}
                  </ul>
                  <p className="mt-2">
                    Resolva em <Link className="underline" href={`/produtos?clientId=${encodeURIComponent(clientId)}`}>Produtos</Link>.
                  </p>
                </div>
              ) : null}

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Texto de apresentação</p>
                  <textarea
                    value={greetingText}
                    onChange={(e) => setGreetingText(e.target.value)}
                    placeholder="Ex: Olá! Eu sou o assistente da Galeria do Gordo. Posso te ajudar com cardápio, pedidos e informações da loja."
                    className="mt-2 min-h-[90px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </div>

                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Destaques / vitrine</p>
                  <textarea
                    value={highlightsText}
                    onChange={(e) => setHighlightsText(e.target.value)}
                    placeholder="Ex: Hoje tem: X-bacon, açaí 500ml, marmita do dia..."
                    className="mt-2 min-h-[90px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Horários</p>
                  <textarea
                    value={businessHoursText}
                    onChange={(e) => setBusinessHoursText(e.target.value)}
                    placeholder="Ex: Seg-Sex 09:00-18:00 | Sáb 09:00-14:00 | Dom fechado"
                    className="mt-2 min-h-[70px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </div>

                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Endereço</p>
                  <textarea
                    value={addressText}
                    onChange={(e) => setAddressText(e.target.value)}
                    placeholder="Ex: Rua X, 123 - Centro. Referência: ao lado do mercado Y."
                    className="mt-2 min-h-[70px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </div>
              </div>

              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Menu (4 opções)</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <input value={menuLabel1} onChange={(e) => setMenuLabel1(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
                  <input value={menuLabel2} onChange={(e) => setMenuLabel2(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
                  <input value={menuLabel3} onChange={(e) => setMenuLabel3(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
                  <input value={menuLabel4} onChange={(e) => setMenuLabel4(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  As ações são fixas (produtos / pedido / horários / humano). Você só personaliza o texto.
                </p>
              </div>

              <div className="mt-4 flex items-start gap-3">
                <input
                  id="requireCatalog"
                  type="checkbox"
                  checked={requireCatalogForPreorder}
                  onChange={(e) => setRequireCatalogForPreorder(e.target.checked)}
                  className="mt-1"
                />
                <label htmlFor="requireCatalog" className="text-sm text-slate-800">
                  <b>Bloquear pré-pedido</b> se o catálogo estiver incompleto (recomendado para reduzir risco)
                </label>
              </div>

              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Texto para "Falar com humano" (opcional)</p>
                <textarea
                  value={humanHandoffText}
                  onChange={(e) => setHumanHandoffText(e.target.value)}
                  placeholder="Ex: Vou chamar alguém da equipe. Me diga seu nome e o que você precisa."
                  className="mt-2 min-h-[70px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Personalidade</p>
                <select
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value as Personality)}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                >
                  <option value="profissional">Profissional</option>
                  <option value="amigavel">Amigável</option>
                  <option value="direto">Direto</option>
                  <option value="vendedor_consultivo">Vendedor consultivo</option>
                </select>
              </div>

              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Estilo de resposta</p>
                <select
                  value={verbosity}
                  onChange={(e) => setVerbosity(e.target.value as Verbosity)}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                >
                  <option value="conciso">Conciso (menor custo)</option>
                  <option value="equilibrado">Equilibrado (custo médio)</option>
                  <option value="prolixo">Prolixo (maior custo)</option>
                </select>
                <p className="mt-2 text-[11px] text-slate-500">{costHint}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Temperatura</p>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="w-full"
                  />
                  <span className="w-12 text-right text-sm text-slate-700">{temperature.toFixed(2)}</span>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  0.00 = previsível e direto. 1.00 = mais criativo (e mais propenso a viajar).
                </p>
              </div>

              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Modelo (LLM)</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as LLMProvider)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="ollama">Ollama (local)</option>
                    <option value="openai">OpenAI (pago)</option>
                    <option value="gemini">Gemini (pago)</option>
                    <option value="groq">Groq (pago)</option>
                  </select>

                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={provider === "ollama" ? "Ex: llama3.1" : "Ex: gpt-4o-mini"}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Se o model estiver vazio, o backend usa o default do provider.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Access key (por cliente)</p>

              <div className="mt-3 grid gap-3 md:grid-cols-[1fr,auto] md:items-center">
                <input
                  value={apiKeyPlain}
                  onChange={(e) => setApiKeyPlain(e.target.value)}
                  placeholder={
                    settings?.apiKeyLast4
                      ? `Já existe uma key salva (****${settings.apiKeyLast4}). Cole aqui para substituir.`
                      : "Cole aqui a key do provider (opcional)."
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />

                <button
                  type="button"
                  onClick={handleRemoveKey}
                  disabled={saving || !settings?.apiKeyLast4}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-60"
                >
                  Remover key
                </button>
              </div>

              <p className="mt-2 text-[11px] text-slate-500">
                A key é criptografada no servidor usando <code>NEXTIA_MASTER_KEY</code>. Se você não configurar isso, o backend deve recusar salvar.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="submit"
                disabled={saving || !clientId}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Salvar configurações"}
              </button>

              {settings?.updatedAt && (
                <span className="text-xs text-slate-500">
                  Última atualização: {new Date(settings.updatedAt).toLocaleString()}
                </span>
              )}
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}