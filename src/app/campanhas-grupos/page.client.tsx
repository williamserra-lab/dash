"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const DEFAULT_CLIENT_ID = "catia_foods";

type Group = {
  name: string;
  groupId: string;
  authorizedForCampaigns: boolean;
  status: "active" | "paused";
};

type GroupCampaign = {
  id: string;
  clientId: string;
  name: string;
  message: string;
  status: "rascunho" | "simulada" | "disparada" | "cancelada";
  paceProfile: "safe" | "balanced" | "aggressive";
  groupIds: string[];
  createdAt: string;
  updatedAt: string;
  lastSimulatedAt?: string | null;
  lastSentAt?: string | null;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function CampanhasGruposPage() {
  const searchParams = useSearchParams();
  const clientId = useMemo(() => String(searchParams.get("clientId") || DEFAULT_CLIENT_ID).trim(), [searchParams]);

  const [groups, setGroups] = useState<Group[]>([]);
  const [campaigns, setCampaigns] = useState<GroupCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    message: "",
    paceProfile: "safe" as "safe" | "balanced" | "aggressive",
    groupIds: [] as string[],
  });

  async function loadGroups() {
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/groups`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Falha ao carregar grupos.");
    const all = Array.isArray(data.groups) ? data.groups : [];
    const authorized = all.filter((g: any) => g.authorizedForCampaigns && g.status === "active");
    setGroups(authorized);
  }

  async function loadCampaigns() {
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/group-campaigns`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Falha ao carregar campanhas.");
    setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []);
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await Promise.all([loadGroups(), loadCampaigns()]);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, [clientId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/group-campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao criar campanha.");
      setSuccess("Campanha de grupos criada.");
      setForm({ name: "", message: "", paceProfile: "safe", groupIds: [] });
      await loadCampaigns();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function simulate(c: GroupCampaign) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/group-campaigns/${encodeURIComponent(c.id)}/simulate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao simular.");
      setSuccess("Campanha simulada.");
      await loadCampaigns();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function send(c: GroupCampaign) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/group-campaigns/${encodeURIComponent(c.id)}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao enviar.");
      setSuccess(`Enfileirado para envio: ${data.enqueued || 0} grupos (modo ${c.paceProfile}).`);
      await loadCampaigns();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  function toggleGroup(id: string) {
    setForm((p) => {
      const exists = p.groupIds.includes(id);
      return { ...p, groupIds: exists ? p.groupIds.filter((x) => x !== id) : [...p.groupIds, id] };
    });
  }

  const canCreate = form.name.trim() && form.message.trim() && form.groupIds.length > 0;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Campanhas de Grupos</h1>
            <p className="mt-1 text-sm text-slate-600">
              Cliente: <span className="font-medium">{clientId}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <a className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50" href={`/campanhas?clientId=${encodeURIComponent(clientId)}`}>
              Campanhas 1:1
            </a>
            <a className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50" href={`/grupos?clientId=${encodeURIComponent(clientId)}`}>
              Gerenciar grupos
            </a>
          </div>
        </header>

        {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        {success ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div> : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-1">
            <h2 className="text-base font-semibold text-slate-900">Nova campanha (grupos)</h2>
            <form className="mt-4 space-y-3" onSubmit={handleCreate}>
              <div>
                <label className="text-xs font-medium text-slate-700">Nome</label>
                <input className="mt-1 w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-slate-400"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Ex.: Promoção fim de semana" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Mensagem</label>
                <textarea className="mt-1 min-h-[120px] w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-slate-400"
                  value={form.message}
                  onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
                  placeholder="Digite a mensagem..." />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700">Ritmo</label>
                <select className="rounded-md border border-slate-200 p-2 text-sm"
                  value={form.paceProfile}
                  onChange={(e) => setForm((p) => ({ ...p, paceProfile: e.target.value as any }))}
                >
                  <option value="safe">Seguro (padrão)</option>
                  <option value="balanced">Balanceado</option>
                  <option value="aggressive">Agressivo (risco maior)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">Grupos autorizados</label>
                  <button type="button" onClick={loadAll} className="text-xs text-slate-600 underline">
                    Recarregar
                  </button>
                </div>

                <div className="mt-2 max-h-[220px] overflow-auto rounded-md border border-slate-200 p-2">
                  {groups.map((g) => (
                    <label key={g.groupId} className="flex cursor-pointer items-center justify-between gap-2 py-1 text-sm">
                      <span className="truncate">{g.name}</span>
                      <input type="checkbox" checked={form.groupIds.includes(g.groupId)} onChange={() => toggleGroup(g.groupId)} />
                    </label>
                  ))}
                  {!groups.length ? (
                    <p className="py-2 text-xs text-slate-500">
                      Nenhum grupo autorizado. Vá em "Gerenciar grupos" e autorize.
                    </p>
                  ) : null}
                </div>
              </div>

              <button
                className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                type="submit"
                disabled={!canCreate}
              >
                Criar campanha
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Campanhas (grupos)</h2>
              <button onClick={loadAll} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                Recarregar
              </button>
            </div>

            {loading ? (
              <p className="mt-4 text-sm text-slate-600">Carregando...</p>
            ) : (
              <div className="mt-4 space-y-3">
                {campaigns.map((c) => (
                  <div key={c.id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          Status: <span className="font-medium">{c.status}</span> · Ritmo: <span className="font-medium">{c.paceProfile}</span> · Grupos: <span className="font-medium">{c.groupIds?.length || 0}</span>
                        </p>
                        {c.lastSimulatedAt ? (
                          <p className="mt-0.5 text-xs text-slate-500">Última simulação: {new Date(c.lastSimulatedAt).toLocaleString()}</p>
                        ) : null}
                        {c.lastSentAt ? (
                          <p className="mt-0.5 text-xs text-slate-500">Último disparo: {new Date(c.lastSentAt).toLocaleString()}</p>
                        ) : null}
                      </div>

                      <div className="flex gap-2">
                        <button onClick={() => simulate(c)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50">
                          Simular
                        </button>
                        <button onClick={() => send(c)} className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800">
                          Enfileirar
                        </button>
                      </div>
                    </div>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-slate-600">Ver mensagem</summary>
                      <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs text-slate-800">{c.message}</pre>
                    </details>
                  </div>
                ))}
                {!campaigns.length ? (
                  <p className="text-sm text-slate-600">Nenhuma campanha de grupos criada.</p>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
