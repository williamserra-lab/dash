"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusBadge,
  type CampaignStatus,
} from "@/components/ui";

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

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

export default function CampanhasGruposPage({ clientId: clientIdProp }: { clientId?: string } = {}) {
  const searchParams = useSearchParams();
  const clientId = useMemo(
    () => String(searchParams.get("clientId") || DEFAULT_CLIENT_ID).trim(),
    [searchParams]
  );

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

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const payload = {
      name: form.name.trim(),
      message: form.message,
      paceProfile: form.paceProfile,
      groupIds: form.groupIds,
    };

    if (!payload.name) return setError("Informe o nome da campanha.");
    if (!payload.message.trim()) return setError("Informe a mensagem.");
    if (!Array.isArray(payload.groupIds) || payload.groupIds.length === 0) return setError("Selecione ao menos 1 grupo.");

    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/group-campaigns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao criar campanha.");

      setSuccess("Campanha criada.");
      setForm({ name: "", message: "", paceProfile: "safe", groupIds: [] });
      await loadCampaigns();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function simulate(c: GroupCampaign) {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/group-campaigns/${encodeURIComponent(c.id)}/simulate`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao simular campanha.");
      setSuccess("Simulação concluída.");
      await loadCampaigns();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function send(c: GroupCampaign) {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/group-campaigns/${encodeURIComponent(c.id)}/send`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao disparar campanha.");
      setSuccess("Campanha enviada para fila.");
      await loadCampaigns();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const statusToBadge = (status: GroupCampaign["status"]): CampaignStatus => status;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campanhas em Grupos</h1>
          <p className="text-sm text-slate-600">Cliente: <span className="font-medium">{clientId}</span></p>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => loadAll()} disabled={loading}>
            Atualizar
          </Button>
        </div>
      </div>

      <div className="mb-4 grid gap-3">
        {error ? (
          <Alert variant="error">
            <div className="font-medium">Erro</div>
            <div className="text-sm opacity-90">{error}</div>
          </Alert>
        ) : null}
        {success ? (
          <Alert variant="success">
            <div className="font-medium">OK</div>
            <div className="text-sm opacity-90">{success}</div>
          </Alert>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Criar campanha</CardTitle>
            <CardDescription>Disparo para grupos autorizados no WhatsApp.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Nome</label>
                <input
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Ex.: Promoção do fim de semana"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Mensagem</label>
                <textarea
                  className="min-h-[110px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={form.message}
                  onChange={(e) => setForm((s) => ({ ...s, message: e.target.value }))}
                  placeholder="Texto que será enviado para os grupos"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Perfil de ritmo</label>
                <select
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={form.paceProfile}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, paceProfile: e.target.value as GroupCampaign["paceProfile"] }))
                  }
                >
                  <option value="safe">Seguro</option>
                  <option value="balanced">Balanceado</option>
                  <option value="aggressive">Agressivo</option>
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Grupos</label>
                <div className="rounded-md border border-slate-200 p-2">
                  {groups.length === 0 ? (
                    <div className="text-sm text-slate-600">Nenhum grupo autorizado para campanhas.</div>
                  ) : (
                    <div className="grid max-h-52 gap-2 overflow-auto pr-1">
                      {groups.map((g) => {
                        const checked = form.groupIds.includes(g.groupId);
                        return (
                          <label key={g.groupId} className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setForm((s) => {
                                  const next = new Set(s.groupIds);
                                  if (e.target.checked) next.add(g.groupId);
                                  else next.delete(g.groupId);
                                  return { ...s, groupIds: Array.from(next) };
                                });
                              }}
                              className="mt-1"
                            />
                            <span>
                              <span className="font-medium">{g.name}</span>
                              <span className="ml-2 text-xs text-slate-500">{g.groupId}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500">Apenas grupos ativos e autorizados aparecem aqui.</p>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={loading}>
                  Criar
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loading}
                  onClick={() => setForm({ name: "", message: "", paceProfile: "safe", groupIds: [] })}
                >
                  Limpar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Campanhas</CardTitle>
            <CardDescription>Gerencie simulações e envios.</CardDescription>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <EmptyState title="Nenhuma campanha criada" description="Crie uma campanha para começar." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr className="border-b">
                      <th className="py-2 pr-3">Nome</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Última simulação</th>
                      <th className="py-2 pr-3">Último envio</th>
                      <th className="py-2 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="py-3 pr-3">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-slate-500">{c.groupIds.length} grupo(s) • {c.paceProfile}</div>
                        </td>
                        <td className="py-3 pr-3">
                          <StatusBadge status={statusToBadge(c.status)} />
                        </td>
                        <td className="py-3 pr-3 text-slate-700">{formatDateTime(c.lastSimulatedAt)}</td>
                        <td className="py-3 pr-3 text-slate-700">{formatDateTime(c.lastSentAt)}</td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => simulate(c)}
                              disabled={loading}
                            >
                              Simular
                            </Button>
                            <Button onClick={() => send(c)} disabled={loading || c.status === "cancelada"}>
                              Enviar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-slate-500">
                  Dica: simule antes de enviar para validar os grupos selecionados.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
