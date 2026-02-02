"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Plan = {
  id: string;
  name: string;
  status: string;
  price_cents: number;
  currency: string;
  entitlements: any;
};

function toInt(v: any, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

export default function AdminPlanosPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string>("default");

  const selected = useMemo(() => plans.find((p) => p.id === selectedId) || null, [plans, selectedId]);

  const [form, setForm] = useState({
    name: "",
    priceCents: 0,
    currency: "BRL",
    status: "active",

    monthlyCredits: 200000,
    maxCampaigns: 10,
    maxSchedules: 50,

    // Campanhas – limites seguros (anti-bloqueio)
    campaignMaxPerMinute: 20,
    campaignMaxPerHour: 150,
    campaignMaxPerDay: 1000,
  });

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/billing/plans", { cache: "no-store", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.message || (data as any)?.error || "Falha ao carregar planos");
      const list = Array.isArray((data as any)?.plans) ? ((data as any).plans as Plan[]) : [];
      setPlans(list);
      if (list.length > 0 && !list.some((p) => p.id === selectedId)) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    const ent = selected.entitlements && typeof selected.entitlements === "object" ? selected.entitlements : {};
    setForm({
      name: selected.name || "",
      priceCents: toInt((selected as any).price_cents, 0),
      currency: selected.currency || "BRL",
      status: selected.status || "active",

      monthlyCredits: toInt(ent.monthlyCredits, 200000),
      maxCampaigns: toInt(ent.maxCampaigns, 10),
      maxSchedules: toInt(ent.maxSchedules, 50),

      campaignMaxPerMinute: toInt(ent.campaignMaxPerMinute, 20),
      campaignMaxPerHour: toInt(ent.campaignMaxPerHour, 150),
      campaignMaxPerDay: toInt(ent.campaignMaxPerDay, 1000),
    });
  }, [selected]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);

    if (!selected) return;

    try {
      const payload = {
        id: selected.id,
        name: form.name.trim() || selected.id,
        status: form.status,
        priceCents: toInt(form.priceCents, 0),
        currency: (form.currency || "BRL").trim() || "BRL",
        entitlements: {
          monthlyCredits: toInt(form.monthlyCredits, 0),
          maxCampaigns: toInt(form.maxCampaigns, 0),
          maxSchedules: toInt(form.maxSchedules, 0),

          campaignMaxPerMinute: toInt(form.campaignMaxPerMinute, 0),
          campaignMaxPerHour: toInt(form.campaignMaxPerHour, 0),
          campaignMaxPerDay: toInt(form.campaignMaxPerDay, 0),
        },
      };

      const res = await fetch("/api/admin/billing/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.message || (data as any)?.error || "Falha ao salvar");

      setOk("Plano atualizado.");
      await load();
      setTimeout(() => setOk(null), 2000);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="rounded-lg border bg-white p-4">
        <h1 className="text-lg font-semibold">Admin → Financeiro → Planos</h1>
        <p className="mt-1 text-sm text-gray-600">
          Configure limites por plano (campanhas, agendamentos e créditos). Isso controla criação/execução e protege contra bloqueios.
        </p>
      </div>

      {loading ? <div className="rounded-lg border bg-white p-4 text-sm text-gray-600">Carregando...</div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
      {ok ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{ok}</div> : null}

      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            <span className="mr-2 font-medium text-gray-700">Plano</span>
            <select
              className="rounded-md border px-3 py-2 text-sm"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-gray-500">(usa /api/admin/billing/plans)</div>
        </div>

        {!selected ? (
          <div className="mt-4 text-sm text-gray-600">Nenhum plano encontrado.</div>
        ) : (
          <form onSubmit={onSave} className="mt-4 grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Nome</span>
                <input className="mt-1 w-full rounded-md border px-3 py-2" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Preço (centavos)</span>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  type="number"
                  value={form.priceCents}
                  onChange={(e) => setForm((s) => ({ ...s, priceCents: Number(e.target.value) }))}
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Status</span>
                <select className="mt-1 w-full rounded-md border px-3 py-2" value={form.status} onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
            </div>

            <div className="rounded-md border bg-slate-50 p-3">
              <h2 className="text-sm font-semibold">Entitlements</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="font-medium text-gray-700">Créditos IA/mês</span>
                  <input className="mt-1 w-full rounded-md border px-3 py-2" type="number" value={form.monthlyCredits} onChange={(e) => setForm((s) => ({ ...s, monthlyCredits: Number(e.target.value) }))} />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-gray-700">Máx. campanhas</span>
                  <input className="mt-1 w-full rounded-md border px-3 py-2" type="number" value={form.maxCampaigns} onChange={(e) => setForm((s) => ({ ...s, maxCampaigns: Number(e.target.value) }))} />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-gray-700">Máx. agendamentos</span>
                  <input className="mt-1 w-full rounded-md border px-3 py-2" type="number" value={form.maxSchedules} onChange={(e) => setForm((s) => ({ ...s, maxSchedules: Number(e.target.value) }))} />
                </label>
              </div>

              <h3 className="mt-4 text-sm font-semibold">Campanhas — Limites de envio (anti-bloqueio)</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="font-medium text-gray-700">Máx. por minuto</span>
                  <input className="mt-1 w-full rounded-md border px-3 py-2" type="number" value={form.campaignMaxPerMinute} onChange={(e) => setForm((s) => ({ ...s, campaignMaxPerMinute: Number(e.target.value) }))} />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-gray-700">Máx. por hora</span>
                  <input className="mt-1 w-full rounded-md border px-3 py-2" type="number" value={form.campaignMaxPerHour} onChange={(e) => setForm((s) => ({ ...s, campaignMaxPerHour: Number(e.target.value) }))} />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-gray-700">Máx. por dia</span>
                  <input className="mt-1 w-full rounded-md border px-3 py-2" type="number" value={form.campaignMaxPerDay} onChange={(e) => setForm((s) => ({ ...s, campaignMaxPerDay: Number(e.target.value) }))} />
                </label>
              </div>

              <p className="mt-3 text-xs text-gray-600">
                Nota: estes limites serão aplicados no motor de fila (próximo patch). Neste patch já usamos <b>maxCampaigns</b> para impedir criar mais campanhas que o plano.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                Salvar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
