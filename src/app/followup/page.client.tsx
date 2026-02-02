"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Kpi } from "@/components/ui/Kpi";

type RunAction =
  | { type: "send"; candidate: any; outboxId: string }
  | { type: "skip"; candidate: any; reason: string }
  | { type: "error"; candidate: any; errorCode: string; message: string };

type RunResult = {
  ok: boolean;
  traceId: string;
  clientId: string;
  mode: "dryRun" | "send";
  ultraSafe: boolean;
  limit: number;
  candidates: any[];
  actions: RunAction[];
  conversionsMarked: number;
};

type MetricsResp = {
  ok: boolean;
  traceId: string;
  summary: any;
  events: any[];
};

type ConfigResp = {
  ok: boolean;
  traceId: string;
  config: any;
};

const DEFAULT_CLIENT_ID = "catia_foods";

function getErrorMessage(err: unknown): string {
  if (!err) return "Erro desconhecido.";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "Erro.";
  return "Erro.";
}


function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso || "");
  }
}

function pct(n: number): string {
  const v = Math.round((n || 0) * 1000) / 10;
  return `${v}%`;
}

export default function PageClient() {
  const sp = useSearchParams();
  const initialClientId = sp.get("clientId") || DEFAULT_CLIENT_ID;

  const [clientId, setClientId] = React.useState(initialClientId);
  const [tab, setTab] = React.useState<"overview" | "run" | "config">("overview");

  const [error, setError] = React.useState<string | null>(null);

  const [metrics, setMetrics] = React.useState<MetricsResp | null>(null);
  const [metricsLoading, setMetricsLoading] = React.useState(false);

  const [cfg, setCfg] = React.useState<any | null>(null);
  const [cfgLoading, setCfgLoading] = React.useState(false);
  const [cfgSaving, setCfgSaving] = React.useState(false);

  const [limit, setLimit] = React.useState(20);
  const [runLoading, setRunLoading] = React.useState(false);
  const [runResult, setRunResult] = React.useState<RunResult | null>(null);

  async function loadMetrics() {
    setError(null);
    setMetricsLoading(true);
    try {
      const res = await fetch(`/api/admin/followup/metrics?clientId=${encodeURIComponent(clientId)}&limit=800`, {
        method: "GET",
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Falha ao carregar métricas.");
      setMetrics(json);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setMetricsLoading(false);
    }
  }

  async function loadConfig() {
    setError(null);
    setCfgLoading(true);
    try {
      const res = await fetch(`/api/admin/followup/config?clientId=${encodeURIComponent(clientId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Falha ao carregar config.");
      setCfg(json.config);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setCfgLoading(false);
    }
  }

  async function saveConfig(nextCfg: any) {
    setError(null);
    setCfgSaving(true);
    try {
      const res = await fetch(`/api/admin/followup/config?clientId=${encodeURIComponent(clientId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextCfg),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Falha ao salvar config.");
      setCfg(json.config);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setCfgSaving(false);
    }
  }

  async function run(mode: "dryRun" | "send") {
    setError(null);
    setRunLoading(true);
    setRunResult(null);
    try {
      const params = new URLSearchParams();
      params.set("clientId", clientId);
      params.set(mode === "dryRun" ? "dryRun" : "send", "1");
      params.set("limit", String(limit || 20));

      const res = await fetch(`/api/admin/followup/run?${params.toString()}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Falha ao executar runner.");
      setRunResult(json);
      // refresh metrics after send
      if (mode === "send") {
        await loadMetrics();
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRunLoading(false);
    }
  }

  React.useEffect(() => {
    // load initial
    loadMetrics();
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const summary = metrics?.summary;
  const events = metrics?.events || [];

  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xl font-semibold">Follow-up</div>
          <div className="text-sm text-slate-600">PASSO 7 — Follow-up inteligente + métricas de valor (auditável via Timeline)</div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-600">clientId</div>
          <input
            className="h-9 w-56 rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="clientId"
          />
          <Button onClick={() => { loadMetrics(); loadConfig(); }} disabled={metricsLoading || cfgLoading}>
            Atualizar
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-3">
          <Alert variant="error"><div className="font-semibold">Erro</div><div className="mt-1">{error}</div></Alert>
        </div>
      ) : null}

      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setTab("overview")}
          className={`rounded-md border px-3 py-1.5 text-xs ${
            tab === "overview" ? "border-slate-300 bg-slate-100 font-semibold" : "border-slate-200 bg-white"
          }`}
        >
          Visão geral
        </button>
        <button
          onClick={() => setTab("run")}
          className={`rounded-md border px-3 py-1.5 text-xs ${
            tab === "run" ? "border-slate-300 bg-slate-100 font-semibold" : "border-slate-200 bg-white"
          }`}
        >
          Execução
        </button>
        <button
          onClick={() => setTab("config")}
          className={`rounded-md border px-3 py-1.5 text-xs ${
            tab === "config" ? "border-slate-300 bg-slate-100 font-semibold" : "border-slate-200 bg-white"
          }`}
        >
          Configurações
        </button>
      </div>

      {tab === "overview" ? (
        <Card>
          <CardHeader>
            <CardTitle>Métricas de valor</CardTitle>
            <CardDescription>Enviados vs. convertidos depois (baseado nos eventos registrados)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-xs text-slate-600">Dados baseados em eventos de métricas (sent/failed/converted)</div>
              <Button onClick={loadMetrics} disabled={metricsLoading}>
                Atualizar
              </Button>
            </div>

            {metricsLoading ? (
              <div className="text-sm text-slate-600">Carregando...</div>
            ) : !summary ? (
              <div className="text-sm text-slate-600">Sem dados ainda.</div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <Kpi label="Enviados (hoje)" value={summary.sent.today} />
                  <Kpi label="Convertidos (hoje)" value={summary.converted.today} />
                  <Kpi label="Enviados (7d)" value={summary.sent.d7} />
                  <Kpi label="Convertidos (7d)" value={summary.converted.d7} />
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                  <Kpi label="Taxa conv. (7d)" value={pct(summary.conversionRateD7)} />
                  <Kpi label="Enviados (30d)" value={summary.sent.d30} />
                  <Kpi label="Convertidos (30d)" value={summary.converted.d30} />
                  <Kpi label="Taxa conv. (30d)" value={pct(summary.conversionRateD30)} />
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                  <Kpi label="Min até conversão (30d)" value={summary.avgMinutesToConvertD30 ?? "—"} />
                  <Kpi label="Eventos carregados" value={events.length} />
                  <Kpi label="Último refresh" value={new Date(summary.now).toLocaleString()} />
                  <Kpi label="Trace (último GET)" value={metrics?.traceId || "—"} />
                </div>

                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold text-slate-700">Eventos recentes (últimos {Math.min(events.length, 30)})</div>
                  {events.length === 0 ? (
                    <div className="text-sm text-slate-600">Sem eventos ainda.</div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-slate-200">
                      <table className="min-w-[900px] w-full text-left text-xs">
                        <thead className="bg-slate-50">
                          <tr className="border-b border-slate-200">
                            <th className="px-3 py-2">Quando</th>
                            <th className="px-3 py-2">Tipo</th>
                            <th className="px-3 py-2">Entidade</th>
                            <th className="px-3 py-2">Tentativa</th>
                            <th className="px-3 py-2">Destino</th>
                            <th className="px-3 py-2">Error</th>
                            <th className="px-3 py-2">Trace</th>
                          </tr>
                        </thead>
                        <tbody>
                          {events.slice(0, 30).map((ev: any) => (
                            <tr key={ev.id} className="border-b border-slate-100 last:border-b-0">
                              <td className="px-3 py-2 whitespace-nowrap">{fmt(ev.at)}</td>
                              <td className="px-3 py-2">
                                <span className={`rounded px-2 py-0.5 ${
                                  ev.type === "sent"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : ev.type === "failed"
                                      ? "bg-rose-50 text-rose-700"
                                      : ev.type === "converted"
                                        ? "bg-indigo-50 text-indigo-700"
                                        : "bg-slate-50 text-slate-700"
                                }`}>
                                  {ev.type}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium text-slate-800">{ev.entityType}</div>
                                <div className="text-slate-500 break-all">{ev.entityId}</div>
                              </td>
                              <td className="px-3 py-2">{String(ev.attempt ?? "—")}</td>
                              <td className="px-3 py-2 break-all">{ev.to ?? "—"}</td>
                              <td className="px-3 py-2">{ev.errorCode ?? "—"}</td>
                              <td className="px-3 py-2 break-all">{ev.traceId ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
</CardContent>
        </Card>
      ) : null}

      {tab === "run" ? (
        <Card>
          <CardHeader>
            <CardTitle>Runner</CardTitle>
            <CardDescription>Simular (dryRun) ou executar (send). Use limit para evitar disparos em massa.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="text-xs text-slate-600">limit</div>
              <input
                className="h-9 w-24 rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={String(limit)}
                onChange={(e) => setLimit(parseInt(e.target.value || "20", 10) || 20)}
              />
              <Button onClick={() => run("dryRun")} disabled={runLoading}>
                Simular (dryRun)
              </Button>
              <Button onClick={() => run("send")} disabled={runLoading}>
                Executar agora (send)
              </Button>
              {runLoading ? <span className="text-xs text-slate-600">Executando...</span> : null}
            </div>

            {runResult ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 text-xs text-slate-600">
                  traceId: <span className="font-mono">{runResult.traceId}</span> · mode: {runResult.mode} · ultraSafe: {String(runResult.ultraSafe)}
                </div>

                <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <Kpi label="Candidatos" value={runResult.candidates?.length || 0} />
                  <Kpi label="Ações" value={runResult.actions?.length || 0} />
                  <Kpi label="Conversões marcadas" value={runResult.conversionsMarked || 0} />
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-600">
                        <th className="py-1 pr-2">tipo</th>
                        <th className="py-1 pr-2">entity</th>
                        <th className="py-1 pr-2">attempt</th>
                        <th className="py-1 pr-2">to</th>
                        <th className="py-1 pr-2">ação</th>
                        <th className="py-1 pr-2">detalhe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runResult.actions.map((a: any, i: number) => (
                        <tr key={i} className="border-t border-slate-200">
                          <td className="py-1 pr-2">{a.candidate?.entityType}</td>
                          <td className="py-1 pr-2 font-mono">{a.candidate?.entityId}</td>
                          <td className="py-1 pr-2">{a.candidate?.attempt}</td>
                          <td className="py-1 pr-2 font-mono">{a.candidate?.to || "—"}</td>
                          <td className="py-1 pr-2">{a.type}</td>
                          <td className="py-1 pr-2 font-mono">
                            {a.type === "send" ? a.outboxId : a.type === "skip" ? a.reason : `${a.errorCode}: ${a.message}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">Execute uma simulação ou envio para ver o resultado.</div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "config" ? (
        <Card>
          <CardHeader>
            <CardTitle>Configurações</CardTitle>
            <CardDescription>Defaults pragmáticos; ajuste por cliente quando necessário.</CardDescription>
          </CardHeader>
          <CardContent>
            {cfgLoading ? (
              <div className="text-sm text-slate-600">Carregando...</div>
            ) : !cfg ? (
              <div className="text-sm text-slate-600">Sem config.</div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="mb-2 text-sm font-semibold">Pré‑pedidos</div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <label className="flex flex-col gap-1">
                        start (min)
                        <input
                          className="h-9 rounded-md border border-slate-300 px-3 text-sm"
                          value={String(cfg.preorders?.startMinutes ?? 10)}
                          onChange={(e) => setCfg({ ...cfg, preorders: { ...cfg.preorders, startMinutes: parseInt(e.target.value || "0", 10) || 0 } })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        stop (h)
                        <input
                          className="h-9 rounded-md border border-slate-300 px-3 text-sm"
                          value={String(cfg.preorders?.stopHours ?? 24)}
                          onChange={(e) => setCfg({ ...cfg, preorders: { ...cfg.preorders, stopHours: parseInt(e.target.value || "24", 10) || 24 } })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        followup1 (min)
                        <input
                          className="h-9 rounded-md border border-slate-300 px-3 text-sm"
                          value={String(cfg.preorders?.followup1Minutes ?? 10)}
                          onChange={(e) => setCfg({ ...cfg, preorders: { ...cfg.preorders, followup1Minutes: parseInt(e.target.value || "10", 10) || 10 } })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        followup2 (min)
                        <input
                          className="h-9 rounded-md border border-slate-300 px-3 text-sm"
                          value={String(cfg.preorders?.followup2Minutes ?? 60)}
                          onChange={(e) => setCfg({ ...cfg, preorders: { ...cfg.preorders, followup2Minutes: parseInt(e.target.value || "60", 10) || 60 } })}
                        />
                      </label>
                    </div>

                    <div className="mt-3">
                      <div className="text-xs text-slate-600">Template</div>
                      <textarea
                        className="mt-1 h-24 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                        value={String(cfg.templates?.preorder || "")}
                        onChange={(e) => setCfg({ ...cfg, templates: { ...cfg.templates, preorder: e.target.value } })}
                      />
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="mb-2 text-sm font-semibold">Agendamentos</div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <label className="flex flex-col gap-1">
                        start (min)
                        <input
                          className="h-9 rounded-md border border-slate-300 px-3 text-sm"
                          value={String(cfg.bookings?.startMinutes ?? 30)}
                          onChange={(e) => setCfg({ ...cfg, bookings: { ...cfg.bookings, startMinutes: parseInt(e.target.value || "0", 10) || 0 } })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        stop (h)
                        <input
                          className="h-9 rounded-md border border-slate-300 px-3 text-sm"
                          value={String(cfg.bookings?.stopHours ?? 24)}
                          onChange={(e) => setCfg({ ...cfg, bookings: { ...cfg.bookings, stopHours: parseInt(e.target.value || "24", 10) || 24 } })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        stop before start (min)
                        <input
                          className="h-9 rounded-md border border-slate-300 px-3 text-sm"
                          value={String(cfg.bookings?.stopBeforeStartMinutes ?? 120)}
                          onChange={(e) => setCfg({ ...cfg, bookings: { ...cfg.bookings, stopBeforeStartMinutes: parseInt(e.target.value || "120", 10) || 120 } })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        conversion window (h)
                        <input
                          className="h-9 rounded-md border border-slate-300 px-3 text-sm"
                          value={String(cfg.conversionWindowHours ?? 6)}
                          onChange={(e) => setCfg({ ...cfg, conversionWindowHours: parseInt(e.target.value || "6", 10) || 6 })}
                        />
                      </label>
                    </div>

                    <div className="mt-3">
                      <div className="text-xs text-slate-600">Template</div>
                      <textarea
                        className="mt-1 h-24 w-full rounded-md border border-slate-300 bg-white p-2 text-sm"
                        value={String(cfg.templates?.booking || "")}
                        onChange={(e) => setCfg({ ...cfg, templates: { ...cfg.templates, booking: e.target.value } })}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => saveConfig(cfg)}
                    disabled={cfgSaving}
                  >
                    Salvar
                  </Button>
                  {cfgSaving ? <span className="text-xs text-slate-600">Salvando...</span> : null}
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-600">Dica</div>
                  <div className="mt-1 text-sm text-slate-700">
                    Para testar rápido: use <b>Execução → Simular</b> (dryRun) com limit baixo.
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
