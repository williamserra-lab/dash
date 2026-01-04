"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const DEFAULT_CLIENT_ID = "catia_foods";

type Group = {
  id: string;
  clientId: string;
  name: string;
  groupId: string;
  authorizedForCampaigns: boolean;
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function GruposPage() {
  const searchParams = useSearchParams();
  const clientId = useMemo(() => {
    return String(searchParams.get("clientId") || DEFAULT_CLIENT_ID).trim();
  }, [searchParams]);

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    groupId: "",
    authorizedForCampaigns: true,
    status: "active" as "active" | "paused",
  });

  async function load() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/groups`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao carregar grupos.");
      setGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [clientId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao salvar grupo.");
      setSuccess("Grupo salvo.");
      setForm({ name: "", groupId: "", authorizedForCampaigns: true, status: "active" });
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function toggleAuth(g: Group) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/groups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: g.groupId, authorizedForCampaigns: !g.authorizedForCampaigns }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao atualizar autorização.");
      setSuccess("Atualizado.");
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function toggleStatus(g: Group) {
    setError(null);
    setSuccess(null);
    try {
      const next = g.status === "active" ? "paused" : "active";
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/groups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: g.groupId, status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao atualizar status.");
      setSuccess("Atualizado.");
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Grupos WhatsApp</h1>
            <p className="mt-1 text-sm text-slate-600">
              Cliente: <span className="font-medium">{clientId}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <a className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50" href={`/campanhas?clientId=${encodeURIComponent(clientId)}`}>
              Campanhas 1:1
            </a>
            <a className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50" href={`/campanhas-grupos?clientId=${encodeURIComponent(clientId)}`}>
              Campanhas de Grupos
            </a>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-1">
            <h2 className="text-base font-semibold text-slate-900">Adicionar/Atualizar grupo</h2>
            <form className="mt-4 space-y-3" onSubmit={handleCreate}>
              <div>
                <label className="text-xs font-medium text-slate-700">Nome</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-slate-400"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Ex.: COMERCIANTES VK"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Group ID (@g.us)</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-slate-400"
                  value={form.groupId}
                  onChange={(e) => setForm((p) => ({ ...p, groupId: e.target.value }))}
                  placeholder="120363...@g.us"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700">Autorizado para campanhas</label>
                <input
                  type="checkbox"
                  checked={form.authorizedForCampaigns}
                  onChange={(e) => setForm((p) => ({ ...p, authorizedForCampaigns: e.target.checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700">Status</label>
                <select
                  className="rounded-md border border-slate-200 p-2 text-sm"
                  value={form.status}
                  onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as any }))}
                >
                  <option value="active">Ativo</option>
                  <option value="paused">Pausado</option>
                </select>
              </div>
              <button className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800" type="submit">
                Salvar
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Grupos cadastrados</h2>
              <button
                onClick={load}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Recarregar
              </button>
            </div>

            {loading ? (
              <p className="mt-4 text-sm text-slate-600">Carregando...</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="py-2 pr-4">Nome</th>
                      <th className="py-2 pr-4">Group ID</th>
                      <th className="py-2 pr-4">Autorizado</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-0">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.groupId} className="border-b border-slate-100">
                        <td className="py-2 pr-4 font-medium text-slate-900">{g.name}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-slate-700">{g.groupId}</td>
                        <td className="py-2 pr-4">
                          <span className={g.authorizedForCampaigns ? "text-emerald-700" : "text-slate-500"}>
                            {g.authorizedForCampaigns ? "Sim" : "Não"}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          <span className={g.status === "active" ? "text-slate-900" : "text-slate-500"}>
                            {g.status === "active" ? "Ativo" : "Pausado"}
                          </span>
                        </td>
                        <td className="py-2 pr-0">
                          <div className="flex gap-2">
                            <button
                              onClick={() => toggleAuth(g)}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                            >
                              {g.authorizedForCampaigns ? "Desautorizar" : "Autorizar"}
                            </button>
                            <button
                              onClick={() => toggleStatus(g)}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                            >
                              {g.status === "active" ? "Pausar" : "Ativar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!groups.length ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-sm text-slate-500">
                          Nenhum grupo cadastrado.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
