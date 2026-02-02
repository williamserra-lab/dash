"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type ServiceCalendarConfig = {
  clientId: string;
  workingHours?: Record<string, Array<{ start: string; end: string }>>;
  defaultDurationMinutes?: number;
  bufferMinutes?: number;
  simultaneousBookingsCap?: number;

  bookingConfirmedMessageTemplate?: string;
  bookingReminderMessageTemplate?: string;
  bookingReminderConfirmLeadHours?: number; // ex.: 2
  bookingNoShowGraceMinutes?: number; // ex.: 15
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Erro desconhecido";
  }
}

export default function PageClient() {
  const sp = useSearchParams();
  const clientId = sp.get("clientId") || "";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState<number>(60);
  const [bufferMinutes, setBufferMinutes] = useState<number>(0);
  const [simultaneousBookingsCap, setSimultaneousBookingsCap] = useState<number>(1);
  const [noShowGraceMinutes, setNoShowGraceMinutes] = useState<number>(15);
  const [workingHoursJson, setWorkingHoursJson] = useState<string>("{}");

  async function load() {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    setSavedMsg(null);
    try {
      const r = await fetch(`/api/clients/${encodeURIComponent(clientId)}/service-calendar-config`, { cache: "no-store" });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as any;
      const cfg: ServiceCalendarConfig | null = (j?.config ?? j ?? null) as any;

      if (cfg?.defaultDurationMinutes != null) setDefaultDurationMinutes(Number(cfg.defaultDurationMinutes));
      if (cfg?.bufferMinutes != null) setBufferMinutes(Number(cfg.bufferMinutes));
      if (cfg?.simultaneousBookingsCap != null) setSimultaneousBookingsCap(Number(cfg.simultaneousBookingsCap));
      setWorkingHoursJson(JSON.stringify(cfg?.workingHours ?? {}, null, 2));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function save() {
    if (!clientId) {
      setError("Selecione um clientId.");
      return;
    }
    setLoading(true);
    setError(null);
    setSavedMsg(null);
    try {
      let workingHours: any = undefined;
      const raw = workingHoursJson.trim();
      if (raw) {
        workingHours = JSON.parse(raw);
      }
      const payload: ServiceCalendarConfig = {
        clientId,
        defaultDurationMinutes: Number(defaultDurationMinutes || 60),
        bufferMinutes: Number(bufferMinutes || 0),
        simultaneousBookingsCap: Number(simultaneousBookingsCap || 1),
        workingHours,
        bookingNoShowGraceMinutes: Number(noShowGraceMinutes || 15),
      };

      const r = await fetch(`/api/clients/${encodeURIComponent(clientId)}/service-calendar-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      setSavedMsg("Salvo.");
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Configuração do calendário</h1>
          <div className="text-sm text-slate-600">
            Cliente: <span className="font-mono">{clientId || "—"}</span>
          </div>
        </div>
        <a
          href={`/agendamentos?clientId=${encodeURIComponent(clientId)}`}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Voltar para agenda
        </a>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {savedMsg ? (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {savedMsg}
        </div>
      ) : null}

      {loading ? <div className="mb-4 text-sm text-slate-600">Carregando…</div> : null}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-700">Duração padrão (min)</label>
            <input
              type="number"
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={defaultDurationMinutes}
              onChange={(e) => setDefaultDurationMinutes(Number(e.target.value))}
              min={5}
              step={5}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Buffer (min)</label>
            <input
              type="number"
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={bufferMinutes}
              onChange={(e) => setBufferMinutes(Number(e.target.value))}
              min={0}
              step={5}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Cap simultâneo</label>
            <input
              type="number"
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={simultaneousBookingsCap}
              onChange={(e) => setSimultaneousBookingsCap(Number(e.target.value))}
              min={1}
              step={1}
            />
          </div>

          <div className="col-span-2">
            <label className="text-xs font-semibold text-slate-700">Working hours (JSON)</label>
            <textarea
              className="mt-1 h-64 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs"
              value={workingHoursJson}
              onChange={(e) => setWorkingHoursJson(e.target.value)}
              spellCheck={false}
            />
            <div className="mt-1 text-xs text-slate-500">
              Exemplo: {"{ \"mon\": [{\"start\":\"09:00\",\"end\":\"18:00\"}], \"tue\": [...] }"}
            </div>

<div>
  <label className="text-xs font-semibold text-slate-700">Tolerância para no-show (min)</label>
  <input
    type="number"
    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
    value={noShowGraceMinutes}
    onChange={(e) => setNoShowGraceMinutes(Number(e.target.value))}
    min={0}
    step={5}
  />
</div>

          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={load}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Recarregar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={loading}
            className="rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
