"use client";


import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DEFAULT_CLIENT_ID = "catia_foods";

type CampaignStatus = "rascunho" | "simulada" | "disparada" | "cancelada";

type Contact = { id: string; name?: string | null; phone?: string | null; channel: string; vip?: boolean; optOutMarketing?: boolean; blockedGlobal?: boolean };

type Campaign = {
  id: string;
  clientId: string;
  channel: "whatsapp";
  name: string;
  // Canonical: API usa "message".
  // Backward-compat: versões antigas do UI usavam "messageTemplate".
  message?: string;
  messageTemplate?: string;
  target?: {
    vipOnly: boolean;
  };
  status: CampaignStatus;
  createdAt: string;
  updatedAt?: string;
};

type CreateFormState = {
  name: string;
  message: string;
  vipOnly: boolean;
  // Destinatarios (1:1)
  // - all: todos os elegiveis (respeitando vipOnly/opt-out/bloqueados)
  // - selected: apenas os contatos escolhidos
  targetMode: "all" | "selected";
  contactIds: string[];
};

type Simulation = {
  totalContacts: number;
  eligibleContacts: number;
  vipContacts: number;
  excludedOptOut?: number;
  excludedBlocked?: number;
  targets: Array<{
    contactId: string;
    identifier: string;
    vip: boolean;
  }>;
};

type CampaignSendSummary = {
  total: number;
  simulado: number;
  agendado: number;
  enviado: number;
  erro: number;
  lastAt?: string | null;
};


async function readJsonSafe<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  rascunho: "Rascunho",
  simulada: "Simulada",
  disparada: "Disparada",
  cancelada: "Cancelada",
};

export default function CampanhasPage() {
  const searchParams = useSearchParams();
  const clientId = useMemo(
    () => searchParams.get("clientId") || DEFAULT_CLIENT_ID,
    [searchParams]
  );

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactQuery, setContactQuery] = useState<string>("");

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const list = Array.isArray(contacts) ? contacts : [];
    if (!q) return list;
    return list.filter((c) => {
      const name = String(c.name || "").toLowerCase();
      const phone = String(c.phone || "").toLowerCase();
      const id = String(c.id || "").toLowerCase();
      return name.includes(q) || phone.includes(q) || id.includes(q);
    });
  }, [contacts, contactQuery]);

  const [dashboard, setDashboard] = useState<Record<string, CampaignSendSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [simulatingId, setSimulatingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [simulation, setSimulation] = useState<Simulation | null>(null);

  const [form, setForm] = useState<CreateFormState>({
    name: "",
    message: "",
    vipOnly: false,
    targetMode: "all",
    contactIds: [],
  });

  useEffect(() => {
    setSimulation(null);
    setSuccessMessage(null);
    setError(null);
  }, [clientId]);

  useEffect(() => {
    loadContacts();
    loadCampaigns();
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  async function loadDashboard() {
    try {
      const res = await fetch(`/api/clients/${clientId}/campaigns/dashboard`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        // Endpoint opcional: não derruba a página se não existir/der erro.
        return;
      }

      const data = await readJsonSafe<any>(res);
      const items = data && Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
      const next: Record<string, CampaignSendSummary> = {};

      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const campaignId = String((it as any).campaignId || (it as any).id || "");
        if (!campaignId) continue;
        const s = (it as any).summary || (it as any).sendSummary || it;
        next[campaignId] = {
          total: Number((s as any)?.total || 0),
          simulado: Number((s as any)?.simulado || 0),
          agendado: Number((s as any)?.agendado || 0),
          enviado: Number((s as any)?.enviado || 0),
          erro: Number((s as any)?.erro || 0),
          lastAt: typeof (s as any)?.lastAt === "string" ? (s as any).lastAt : null,
        };
      }

      setDashboard(next);
    } catch (err) {
      console.error("Erro ao carregar dashboard de campanhas:", err);
    }
  }

  async function loadContacts() {
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/contacts`);
      if (!res.ok) throw new Error(`Falha ao carregar contatos (${res.status})`);
      const data = (await res.json()) as { contacts?: Contact[] };
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
    } catch (e) {
      console.warn("Falha ao carregar contatos", e);
    }
  }

  async function loadCampaigns() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/clients/${clientId}/campaigns`, {
        method: "GET",
      });

      const data = await readJsonSafe<unknown>(res);

      if (!res.ok) {
        throw new Error(
          (isRecord(data) && typeof (data as any).error === "string" ? (data as any).error : undefined) ||
            "Falha ao carregar campanhas."
        );
      }

      const campaignsValue = isRecord(data) ? (data as any).campaigns : undefined;

      const list: Campaign[] = Array.isArray(campaignsValue)
        ? (campaignsValue as Campaign[])
        : Array.isArray(data)
          ? (data as Campaign[])
          : [];

      setCampaigns(list);
    } catch (err: unknown) {
      console.error("Erro ao carregar campanhas:", err);
      setError(getErrorMessage(err) || "Erro ao carregar campanhas.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!form.name.trim() || !form.message.trim()) {
      setError("Nome e mensagem são obrigatórios.");
      return;
    }

    try {
      setCreating(true);

      const res = await fetch(`/api/clients/${clientId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          // Canonical do backend: "message".
          // Mantém "messageTemplate" por compatibilidade com versões antigas.
          message: form.message.trim(),
          messageTemplate: form.message.trim(),
          target: { vipOnly: form.vipOnly, contactIds: form.targetMode === "selected" ? form.contactIds : undefined },
        }),
      });

      const data = await readJsonSafe<{ error?: string }>(res);

      if (!res.ok) {
        throw new Error(
          (isRecord(data) && typeof data.error === "string" ? data.error : undefined) ||
            "Falha ao criar campanha."
        );
      }

      setForm((prev) => ({ ...prev, name: "", message: "" }));
      setSuccessMessage("Campanha criada.");
      await loadContacts();
      await loadCampaigns();
    } catch (err: unknown) {
      console.error("Erro ao criar campanha:", err);
      setError(getErrorMessage(err) || "Erro ao criar campanha.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSimulate(campaignId: string) {
    try {
      setSimulatingId(campaignId);
      setError(null);
      setSuccessMessage(null);
      setSimulation(null);

      const res = await fetch(
        `/api/clients/${clientId}/campaigns/${campaignId}/simulate`,
        { method: "POST" }
      );

      const data = await readJsonSafe<unknown>(res);

      if (!res.ok) {
        throw new Error(
          (isRecord(data) && typeof (data as any).error === "string" ? (data as any).error : undefined) ||
            "Falha ao simular campanha."
        );
      }

      // Alguns endpoints retornam { simulation: {...} }, outros retornam direto o objeto.
      const simValue =
        isRecord(data) && "simulation" in data ? (data as any).simulation : data;

      setSimulation(simValue as Simulation);
      setSuccessMessage("Simulação concluída.");
      await loadContacts();
    loadCampaigns();
    } catch (err: unknown) {
      console.error("Erro ao simular campanha:", err);
      setError(getErrorMessage(err) || "Erro ao simular campanha.");
    } finally {
      setSimulatingId(null);
    }
  }

  async function handleSend(campaignId: string) {
    try {
      setSendingId(campaignId);
      setError(null);
      setSuccessMessage(null);

      const res = await fetch(
        `/api/clients/${clientId}/campaigns/${campaignId}/send`,
        { method: "POST" }
      );

      const data = await readJsonSafe<{ error?: string }>(res);

      if (!res.ok) {
        throw new Error(
          (isRecord(data) && typeof data.error === "string" ? data.error : undefined) ||
            "Falha ao disparar campanha."
        );
      }

      setSuccessMessage("Campanha disparada (simulado).");
      await loadContacts();
    loadCampaigns();
    } catch (err: unknown) {
      console.error("Erro ao disparar campanha:", err);
      setError(getErrorMessage(err) || "Erro ao disparar campanha.");
    } finally {
      setSendingId(null);
    }
  }

  function formatDate(iso?: string): string {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("pt-BR");
  }

  const canCreate = form.name.trim().length > 0 && form.message.trim().length > 0;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">Campanhas</h1>
          <p className="mt-1 text-sm text-slate-600">
            Cliente: <span className="font-medium">{clientId}</span>
          </p>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {successMessage}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-1">
            <h2 className="text-base font-semibold text-slate-900">Nova campanha</h2>
            <form className="mt-4 space-y-3" onSubmit={handleCreate}>
              <div>
                <label className="text-xs font-medium text-slate-700">Nome</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-slate-400"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex.: Promo almoço"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Mensagem</label>
                <textarea
                  className="mt-1 min-h-[120px] w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-slate-400"
                  value={form.message}
                  onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                  placeholder="Texto do disparo."
                />
              </div>


              <div className="rounded-md border border-slate-200 p-3">
                <div className="text-sm font-medium text-slate-800">Destinatários (1:1)</div>
                <p className="mt-1 text-xs text-slate-600">
                  Por padrão, a campanha vai para todos os contatos elegíveis. Se quiser controlar, escolha “Apenas selecionados”.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="targetMode"
                      checked={form.targetMode === "all"}
                      onChange={() => setForm((prev) => ({ ...prev, targetMode: "all", contactIds: [] }))}
                    />
                    Todos elegíveis
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="targetMode"
                      checked={form.targetMode === "selected"}
                      onChange={() => setForm((prev) => ({ ...prev, targetMode: "selected" }))}
                    />
                    Apenas selecionados
                  </label>
                </div>

                {form.targetMode === "selected" ? (
                  <div className="mt-3">
                    <input
                      className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-slate-400"
                      value={contactQuery}
                      onChange={(e) => setContactQuery(e.target.value)}
                      placeholder="Buscar contato por nome/telefone..."
                    />
                    <div className="mt-2 max-h-56 overflow-auto rounded-md border border-slate-200 p-2">
                      {filteredContacts.length ? (
                        <div className="space-y-2">
                          {filteredContacts.map((c) => {
                            const label = String(c.name || c.phone || c.id);
                            return (
                              <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={form.contactIds.includes(String(c.id))}
                                  onChange={(e) => {
                                    const id = String(c.id);
                                    setForm((prev) => {
                                      const next = new Set(prev.contactIds);
                                      if (e.target.checked) next.add(id);
                                      else next.delete(id);
                                      return { ...prev, contactIds: Array.from(next) };
                                    });
                                  }}
                                />
                                <span>
                                  {label} {c.vip ? <span className="text-xs text-amber-700">(VIP)</span> : null}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-600">Nenhum contato encontrado.</p>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      Selecionados: <span className="font-medium">{form.contactIds.length}</span>
                    </p>
                  </div>
                ) : null}
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.vipOnly}
                  onChange={(e) => setForm((prev) => ({ ...prev, vipOnly: e.target.checked }))}
                />
                Apenas VIP
              </label>

              <button
                type="submit"
                disabled={!canCreate || creating}
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? "Criando..." : "Criar campanha"}
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Campanhas do cliente</h2>
              <button
                onClick={() => { loadContacts();
    loadCampaigns(); loadDashboard(); }}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Recarregar
              </button>
            </div>

            {loading ? (
              <p className="mt-4 text-sm text-slate-600">Carregando...</p>
            ) : campaigns.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">Nenhuma campanha cadastrada.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {campaigns.map((c) => (
                  <div key={c.id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                        <p className="mt-1 text-xs text-slate-600">
                          Status: <span className="font-medium">{STATUS_LABEL[c.status] || c.status}</span>
                          {" · "}Criada em: <span className="font-medium">{formatDate(c.createdAt)}</span>
                        </p>

                        {dashboard[c.id] ? (
                          <p className="mt-1 text-xs text-slate-600">
                            Envios: <span className="font-medium">{dashboard[c.id].total}</span>
                            {" · "}Agendados: <span className="font-medium">{dashboard[c.id].agendado}</span>
                            {" · "}Enviados: <span className="font-medium">{dashboard[c.id].enviado}</span>
                            {" · "}Erros: <span className="font-medium">{dashboard[c.id].erro}</span>
                          </p>
                        ) : null}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2 sm:mt-0">
                        <button
                          onClick={() => handleSimulate(c.id)}
                          disabled={!!simulatingId || !!sendingId}
                          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {simulatingId === c.id ? "Simulando..." : "Simular"}
                        </button>
                        <button
                          onClick={() => handleSend(c.id)}
                          disabled={!!sendingId || !!simulatingId}
                          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                          {sendingId === c.id ? "Disparando..." : "Disparar"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 rounded-md bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-700">Mensagem</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                        {c.message ?? c.messageTemplate ?? ""}
                      </p>
                    </div>

                    <div className="mt-3 text-xs text-slate-600">
                      <span className="font-semibold">Segmentação:</span> {c.target?.vipOnly ? "VIP only" : "Todos"}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {simulation ? (
              <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Resultado da simulação</h3>
                <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <p>
                    Total de contatos: <span className="font-semibold">{simulation.totalContacts}</span>
                  </p>
                  <p>
                    Elegíveis: <span className="font-semibold">{simulation.eligibleContacts}</span>
                  </p>
                  <p>
                    VIP elegíveis: <span className="font-semibold">{simulation.vipContacts}</span>
                  </p>
                  {typeof simulation.excludedOptOut === "number" ? (
                    <p>
                      Excluídos (opt-out): <span className="font-semibold">{simulation.excludedOptOut}</span>
                    </p>
                  ) : null}
                  {typeof simulation.excludedBlocked === "number" ? (
                    <p>
                      Excluídos (bloqueados): <span className="font-semibold">{simulation.excludedBlocked}</span>
                    </p>
                  ) : null}
                </div>

                {simulation.targets?.length ? (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-slate-700">Alvos (amostra)</p>
                    <ul className="mt-2 max-h-48 space-y-1 overflow-auto rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700">
                      {simulation.targets.slice(0, 50).map((t) => (
                        <li key={`${t.contactId}_${t.identifier}`} className="flex items-center justify-between">
                          <span>{t.identifier}</span>
                          <span className="text-slate-500">{t.vip ? "VIP" : "Normal"}</span>
                        </li>
                      ))}
                    </ul>
                    {simulation.targets.length > 50 ? (
                      <p className="mt-2 text-xs text-slate-600">Mostrando 50 de {simulation.targets.length} alvos.</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">Nenhum alvo elegível na simulação.</p>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}