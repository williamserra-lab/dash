"use client";

import React, { useEffect, useMemo, useState } from "react";

type WhatsAppInstance = {
  id: string;
  label?: string | null;
  instanceName?: string | null;
  active?: boolean;
};

type Preorder = {
  id: string;
  createdAt: string;
  status: string;
  totals?: { total?: number } | null;
};

type Booking = {
  id: string;
  createdAt?: string;
  startAt?: string;
  status?: string;
};

type CampaignDashItem = {
  id: string;
  title?: string | null;
  status?: string | null;
  stats?: Record<string, number>;
};

type LlmUsageResponse =
  | { ok: true; month: string; usedTokens: number; limitTokens?: number | null; byFeature?: Record<string, number> }
  | { error: string; [k: string]: unknown };

function isoDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(t);
}

function lastNDaysKeys(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(isoDayKey(d));
  }
  return out;
}

function pctDelta(today: number, avg: number): number | null {
  if (!Number.isFinite(today) || !Number.isFinite(avg) || avg <= 0) return null;
  return (today - avg) / avg;
}

function formatPct(v: number | null): string {
  if (v == null) return "—";
  const p = Math.round(v * 100);
  const sign = p > 0 ? "+" : "";
  return `${sign}${p}%`;
}

function formatInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return String(Math.round(v));
}

function formatMoneyBRL(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Sparkline({ values }: { values: number[] }) {
  const w = 160;
  const h = 44;
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * (w - 2) + 1;
      const y = h - 1 - (v / max) * (h - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts} />
    </svg>
  );
}

export default function DashboardClientPage({
  initialClientId,
  initialInstance,
}: {
  initialClientId: string;
  initialInstance: string;
}) {
  const [clientId, setClientId] = useState(initialClientId || "");
  const [instance, setInstance] = useState(initialInstance || "");
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);

  const [preorders, setPreorders] = useState<Preorder[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignDashItem[]>([]);
  const [llmUsage, setLlmUsage] = useState<LlmUsageResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days7 = useMemo(() => lastNDaysKeys(7), []);

  async function loadAll() {
    if (!clientId.trim()) {
      setError("clientId é obrigatório.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Instances (helps dashboards that depend on instance)
      const instRes = await fetch(`/api/clients/${encodeURIComponent(clientId)}/whatsapp-instances`, {
        cache: "no-store",
      });
      const instJson = await instRes.json().catch(() => ({}));
      const instItems: WhatsAppInstance[] = Array.isArray(instJson?.items) ? instJson.items : [];
      setInstances(instItems);

      // Auto-select an active instance if none selected.
      if (!instance.trim() && instItems.length > 0) {
        const active = instItems.find((x) => x && x.active) || instItems[0];
        const name = typeof active?.instanceName === "string" ? active.instanceName : "";
        if (name) setInstance(name);
      }

      // Preorders
      const poRes = await fetch(`/api/clients/${encodeURIComponent(clientId)}/preorders?limit=500`, { cache: "no-store" });
      const poJson = await poRes.json().catch(() => ({}));
      const poItems: Preorder[] = Array.isArray(poJson?.items) ? poJson.items : Array.isArray(poJson?.preorders) ? poJson.preorders : [];
      setPreorders(poItems);

      // Bookings (27.1B). If route does not exist yet, fail gracefully.
      const bkRes = await fetch(`/api/clients/${encodeURIComponent(clientId)}/bookings?limit=500`, { cache: "no-store" });
      const bkJson = await bkRes.json().catch(() => ({}));
      const bkItems: Booking[] = Array.isArray(bkJson?.items) ? bkJson.items : Array.isArray(bkJson?.bookings) ? bkJson.bookings : [];
      setBookings(bkItems);

      // Campaign dashboard
      const cdRes = await fetch(`/api/clients/${encodeURIComponent(clientId)}/campaigns/dashboard`, { cache: "no-store" });
      const cdJson = await cdRes.json().catch(() => ({}));
      const cdItems: CampaignDashItem[] = Array.isArray(cdJson?.campaigns) ? cdJson.campaigns : [];
      setCampaigns(cdItems);

      // LLM usage (may require admin auth; handle 401/403 quietly)
      const luRes = await fetch(`/api/admin/llm-usage/${encodeURIComponent(clientId)}`, { cache: "no-store" });
      const luJson = await luRes.json().catch(() => ({}));
      setLlmUsage(luJson as LlmUsageResponse);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // Keep URL in sync (so you can bookmark per client/instance).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (clientId) url.searchParams.set("clientId", clientId);
    else url.searchParams.delete("clientId");
    if (instance) url.searchParams.set("instance", instance);
    else url.searchParams.delete("instance");
    window.history.replaceState({}, "", url.toString());
  }, [clientId, instance]);

  useEffect(() => {
    // Load only once on mount when clientId is present.
    if (clientId.trim()) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const derived = useMemo(() => {
    const now = new Date();
    const todayKey = isoDayKey(now);

    const poByDay: Record<string, number> = {};
    const poRevenueByDay: Record<string, number> = {};

    for (const p of preorders) {
      const d = parseIsoDate(p.createdAt);
      if (!d) continue;
      const k = isoDayKey(d);
      poByDay[k] = (poByDay[k] || 0) + 1;

      const total = typeof (p as any)?.totals?.total === "number" ? (p as any).totals.total : null;
      if (typeof total === "number" && Number.isFinite(total) && total > 0 && String(p.status || "").toLowerCase() !== "cancelled") {
        poRevenueByDay[k] = (poRevenueByDay[k] || 0) + total;
      }
    }

    const bkByDay: Record<string, number> = {};
    for (const b of bookings) {
      const d = parseIsoDate(b.startAt || b.createdAt);
      if (!d) continue;
      const k = isoDayKey(d);
      bkByDay[k] = (bkByDay[k] || 0) + 1;
    }

    const poSeries7 = days7.map((k) => poByDay[k] || 0);
    const bkSeries7 = days7.map((k) => bkByDay[k] || 0);
    const revenueSeries7 = days7.map((k) => poRevenueByDay[k] || 0);

    const poToday = poByDay[todayKey] || 0;
    const bkToday = bkByDay[todayKey] || 0;

    const poAvg7 = poSeries7.reduce((a, b) => a + b, 0) / 7;
    const bkAvg7 = bkSeries7.reduce((a, b) => a + b, 0) / 7;

    const revenueToday = poRevenueByDay[todayKey] || 0;
    const revenueAvg7 = revenueSeries7.reduce((a, b) => a + b, 0) / 7;

    const llmUsed = llmUsage && (llmUsage as any).usedTokens != null ? Number((llmUsage as any).usedTokens) : null;
    const llmLimit = llmUsage && (llmUsage as any).limitTokens != null ? Number((llmUsage as any).limitTokens) : null;
    const llmPct = llmUsed != null && llmLimit != null && llmLimit > 0 ? llmUsed / llmLimit : null;

    return {
      todayKey,
      poToday,
      bkToday,
      revenueToday,
      poAvg7,
      bkAvg7,
      revenueAvg7,
      poSeries7,
      bkSeries7,
      revenueSeries7,
      llmUsed,
      llmLimit,
      llmPct,
    };
  }, [preorders, bookings, llmUsage, days7]);

  const selectedInstanceLabel = useMemo(() => {
    const it = instances.find((x) => (x.instanceName || "") === instance);
    if (!it) return instance || "";
    return it.label ? `${it.label} (${instance})` : instance;
  }, [instances, instance]);

  return (
    <main style={{ padding: "1.5rem", maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.6rem", margin: 0 }}>Dashboards (28.5)</h1>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ color: "#444" }}>clientId</span>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="ex: eutenhocasa0708"
              style={{ padding: "0.35rem 0.5rem", width: 220 }}
            />
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ color: "#444" }}>instância</span>
            <select
              value={instance}
              onChange={(e) => setInstance(e.target.value)}
              style={{ padding: "0.35rem 0.5rem", minWidth: 240 }}
            >
              <option value="">(selecione)</option>
              {instances.map((it) => {
                const v = String(it.instanceName || "");
                if (!v) return null;
                const label = it.label ? `${it.label} (${v})` : v;
                return (
                  <option key={it.id || v} value={v}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>

          <button onClick={loadAll} disabled={loading || !clientId.trim()} style={{ padding: "0.4rem 0.8rem" }}>
            {loading ? "Carregando..." : "Recarregar"}
          </button>
        </div>
      </header>

      {error && (
        <div style={{ border: "1px solid #f3b3b3", background: "#fff5f5", padding: "0.75rem", marginBottom: "1rem" }}>
          <div style={{ color: "#b00020", whiteSpace: "pre-wrap" }}>{error}</div>
        </div>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <KpiCard
          title="Conversas (instância)"
          value={instance ? selectedInstanceLabel : "—"}
          subtitle={instance ? "Baseado na instância selecionada (28.1)" : "Selecione uma instância para dados de atendimento"}
        />

        <KpiCard
          title="Pré-pedidos hoje"
          value={formatInt(derived.poToday)}
          subtitle={`vs média 7d: ${formatPct(pctDelta(derived.poToday, derived.poAvg7))}`}
          right={<Sparkline values={derived.poSeries7} />}
        />

        <KpiCard
          title="Agendamentos hoje"
          value={formatInt(derived.bkToday)}
          subtitle={`vs média 7d: ${formatPct(pctDelta(derived.bkToday, derived.bkAvg7))}`}
          right={<Sparkline values={derived.bkSeries7} />}
        />

        <KpiCard
          title="Vendas (pré-pedidos) hoje"
          value={formatMoneyBRL(derived.revenueToday)}
          subtitle={`vs média 7d: ${formatPct(pctDelta(derived.revenueToday, derived.revenueAvg7))}`}
          right={<Sparkline values={derived.revenueSeries7.map((x) => Math.round(x))} />}
        />

        <KpiCard
          title="Uso de IA (mês)"
          value={
            derived.llmUsed == null
              ? "—"
              : derived.llmLimit == null
              ? `${formatInt(derived.llmUsed)} tokens`
              : `${formatInt(derived.llmUsed)} / ${formatInt(derived.llmLimit)}`
          }
          subtitle={
            derived.llmPct == null ? "Se aparecer “—”, você não está logado como admin." : `Consumo: ${formatPct(derived.llmPct)}`
          }
        />

        <KpiCard
          title="Campanhas (resumo)"
          value={formatInt(campaigns.length)}
          subtitle="Total de campanhas com registros de execução"
        />
      </section>

      <section style={{ marginTop: "1.5rem", display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        <Panel title="Campanhas e Marketing (mínimo viável)">
          {campaigns.length === 0 ? (
            <div style={{ color: "#666" }}>Sem dados ainda. Quando houver runs, aparecerão aqui.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Campanha</th>
                    <th style={th}>Status</th>
                    <th style={th}>Enviados</th>
                    <th style={th}>Erros</th>
                    <th style={th}>Respostas</th>
                    <th style={th}>Opt-out</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.slice(0, 30).map((c) => {
                    const stats = c.stats || {};
                    return (
                      <tr key={c.id}>
                        <td style={td}>{c.title || c.id}</td>
                        <td style={td}>{c.status || "—"}</td>
                        <td style={td}>{formatInt(stats.sent ?? stats.SENT ?? null)}</td>
                        <td style={td}>{formatInt(stats.failed ?? stats.FAILED ?? null)}</td>
                        <td style={td}>{formatInt(stats.responses ?? stats.RESPONSES ?? null)}</td>
                        <td style={td}>{formatInt(stats.optOut ?? stats.OPTOUT ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 10, color: "#666", fontSize: "0.9rem" }}>
            Observação: “lidos” não entra aqui (WhatsApp/provedores não garantem). Métrica confiável é enviado/erro/resposta/opt-out.
          </div>
        </Panel>

        <Panel title="Uso de IA (FinOps light, mínimo)">
          {llmUsage && (llmUsage as any).byFeature && typeof (llmUsage as any).byFeature === "object" ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Funcionalidade</th>
                    <th style={th}>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries((llmUsage as any).byFeature as Record<string, number>)
                    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
                    .slice(0, 20)
                    .map(([k, v]) => (
                      <tr key={k}>
                        <td style={td}>{k}</td>
                        <td style={td}>{formatInt(v)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ color: "#666" }}>
              Se você não estiver logado como admin, este bloco fica “cego”. Para liberar: acesse <code>/admin-login</code>.
            </div>
          )}
        </Panel>
      </section>

      <footer style={{ marginTop: "2rem", borderTop: "1px solid #eee", paddingTop: "1rem", color: "#666" }}>
        <div style={{ fontSize: "0.9rem" }}>
          Esta UI é a camada 28.5: mostra números que já existem no seu backend hoje. Métricas de atendimento (1ª resposta e
          resolução) dependem de eventos da UI 28.1 e agregadores mais completos.
        </div>
      </footer>
    </main>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  right,
}: {
  title: string;
  value: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.85rem", background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: "0.92rem", color: "#555" }}>{title}</div>
          <div style={{ fontSize: "1.55rem", fontWeight: 700, marginTop: 4 }}>{value}</div>
          {subtitle && <div style={{ marginTop: 6, color: "#666", fontSize: "0.9rem" }}>{subtitle}</div>}
        </div>
        {right && <div style={{ color: "#333", opacity: 0.9 }}>{right}</div>}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 6, padding: "1rem", background: "#fff" }}>
      <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.15rem" }}>{title}</h2>
      {children}
    </section>
  );
}

const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #ddd", padding: "0.5rem" };
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: "0.5rem", verticalAlign: "top" };
