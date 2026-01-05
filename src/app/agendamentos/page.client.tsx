"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type BookingStatus =
  | "requested"
  | "awaiting_confirmation"
  | "confirmed"
  | "cancelled"
  | "no_show";

type Booking = {
  id: string;
  clientId: string;
  contactId: string;
  service?: { name: string; durationMinutes?: number; price?: number | null } | null;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  collected?: { name?: string; address?: string; notes?: string } | null;
  createdAt: string;
  updatedAt: string;
};

type Contact = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  phone?: string | null;
};

function isoDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

function parseDateSafe(iso: string): Date | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Erro desconhecido";
  }
}

function statusLabel(s: BookingStatus): string {
  switch (s) {
    case "requested":
      return "Solicitado";
    case "awaiting_confirmation":
      return "Aguardando confirmação";
    case "confirmed":
      return "Confirmado";
    case "cancelled":
      return "Cancelado";
    case "no_show":
      return "No-show";
    default:
      return s;
  }
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export default function PageClient() {
  const sp = useSearchParams();
  const clientId = sp.get("clientId") || "";

  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [contactsById, setContactsById] = useState<Record<string, Contact>>({});

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createDay, setCreateDay] = useState<Date | null>(null);
  const [createContactId, setCreateContactId] = useState("");
  const [createServiceName, setCreateServiceName] = useState("");
  const [createStartAt, setCreateStartAt] = useState("");
  const [createDurationMinutes, setCreateDurationMinutes] = useState<number>(60);

  async function refresh() {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${encodeURIComponent(clientId)}/bookings`, {
        cache: "no-store",
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as any;
      const list = Array.isArray(j?.items) ? (j.items as Booking[]) : (Array.isArray(j) ? (j as Booking[]) : []);
      setBookings(list);

      // Load contacts best-effort
      const rc = await fetch(`/api/clients/${encodeURIComponent(clientId)}/contacts`, { cache: "no-store" });
      if (rc.ok) {
        const jc = (await rc.json()) as any;
        const items = Array.isArray(jc?.items) ? (jc.items as Contact[]) : (Array.isArray(jc) ? (jc as Contact[]) : []);
        const map: Record<string, Contact> = {};
        for (const c of items) map[c.id] = c;
        setContactsById(map);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const monthLabel = useMemo(() => {
    const y = monthCursor.getFullYear();
    const m = monthCursor.toLocaleString("pt-BR", { month: "long" });
    return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${y}`;
  }, [monthCursor]);

  const monthDays = useMemo(() => {
    const y = monthCursor.getFullYear();
    const m = monthCursor.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startWeekday = (first.getDay() + 6) % 7; // Monday=0
    const cells: Array<{ date: Date | null; key: string }> = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push({ date: null, key: `empty-${i}` });
    }
    for (let d = 1; d <= last.getDate(); d++) {
      const dt = new Date(y, m, d);
      cells.push({ date: dt, key: isoDateKey(dt) });
    }
    // pad to complete weeks
    while (cells.length % 7 !== 0) cells.push({ date: null, key: `pad-${cells.length}` });
    return cells;
  }, [monthCursor]);

  const bookingsByDay = useMemo(() => {
    const map: Record<string, Booking[]> = {};
    for (const b of bookings) {
      const d = parseDateSafe(b.startAt);
      if (!d) continue;
      // only month view grouping; still show even if outside month (rare)
      const key = isoDateKey(d);
      if (!map[key]) map[key] = [];
      map[key].push(b);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
    }
    return map;
  }, [bookings]);

  function openCreate(day: Date) {
    setCreateOpen(true);
    setCreateDay(day);
    const base = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
    setCreateStartAt(toLocalInputValue(base));
    setCreateContactId("");
    setCreateServiceName("");
    setCreateDurationMinutes(60);
  }

  async function submitCreate() {
    if (!clientId) {
      setError("Selecione um clientId.");
      return;
    }
    if (!createStartAt || !createContactId || !createServiceName) {
      setError("Preencha contato, serviço e horário.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const start = new Date(createStartAt);
      const end = addMinutes(start, Number(createDurationMinutes || 60));
      const payload: any = {
        contactId: createContactId.trim(),
        service: { name: createServiceName.trim(), durationMinutes: Number(createDurationMinutes || 60) },
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        status: "requested",
      };
      const r = await fetch(`/api/clients/${encodeURIComponent(clientId)}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      setCreateOpen(false);
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(b: Booking, status: BookingStatus) {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/bookings/${encodeURIComponent(b.id)}/status`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }
      );
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      setSelectedBooking(null);
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const weekdayLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agenda (Calendário)</h1>
          <div className="text-sm text-slate-600">
            Cliente: <span className="font-mono">{clientId || "—"}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/agendamentos/config?clientId=${encodeURIComponent(clientId)}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Config calendário
          </a>
          <button
            onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            type="button"
          >
            ◀
          </button>
          <div className="min-w-[180px] text-center text-sm font-semibold text-slate-800">{monthLabel}</div>
          <button
            onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            type="button"
          >
            ▶
          </button>
          <button
            onClick={refresh}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            type="button"
          >
            Atualizar
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {loading ? <div className="mb-4 text-sm text-slate-600">Carregando…</div> : null}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {weekdayLabels.map((w) => (
            <div key={w} className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {monthDays.map((cell) => {
            if (!cell.date) {
              return <div key={cell.key} className="h-28 border-b border-slate-100 border-r border-slate-100" />;
            }
            const key = isoDateKey(cell.date);
            const items = bookingsByDay[key] || [];
            const isToday = isoDateKey(new Date()) === key;

            return (
              <div
                key={cell.key}
                className="h-28 border-b border-slate-100 border-r border-slate-100 p-2"
              >
                <div className="mb-1 flex items-center justify-between">
                  <div className={`text-xs font-semibold ${isToday ? "text-sky-700" : "text-slate-700"}`}>
                    {cell.date.getDate()}
                  </div>
                  <button
                    type="button"
                    onClick={() => openCreate(cell.date!)}
                    className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                    title="Criar agendamento"
                  >
                    +
                  </button>
                </div>

                <div className="space-y-1 overflow-hidden">
                  {items.slice(0, 3).map((b) => {
                    const start = parseDateSafe(b.startAt);
                    const hhmm = start
                      ? start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                      : "—";
                    const contact = contactsById[b.contactId];
                    const who = (contact?.displayName || contact?.name || b.contactId || "").toString();
                    const title = b.service?.name || "Serviço";

                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setSelectedBooking(b)}
                        className="block w-full truncate rounded border border-slate-200 bg-white px-2 py-1 text-left text-xs hover:bg-slate-50"
                        title={`${hhmm} — ${title} — ${who}`}
                      >
                        <span className="font-mono">{hhmm}</span>{" "}
                        <span className="font-semibold">{title}</span>{" "}
                        <span className="text-slate-600">• {who}</span>
                      </button>
                    );
                  })}
                  {items.length > 3 ? (
                    <div className="text-xs text-slate-500">+{items.length - 3}…</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create modal */}
      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-800">
                Novo agendamento {createDay ? `(${createDay.toLocaleDateString("pt-BR")})` : ""}
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => setCreateOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-slate-700">contactId</label>
                <input
                  value={createContactId}
                  onChange={(e) => setCreateContactId(e.target.value)}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  placeholder="ex: cont_..."
                />
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-semibold text-slate-700">Serviço</label>
                <input
                  value={createServiceName}
                  onChange={(e) => setCreateServiceName(e.target.value)}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  placeholder="ex: Corte de cabelo"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-slate-700">Início</label>
                  <input
                    type="datetime-local"
                    value={createStartAt}
                    onChange={(e) => setCreateStartAt(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-slate-700">Duração (min)</label>
                  <input
                    type="number"
                    value={createDurationMinutes}
                    onChange={(e) => setCreateDurationMinutes(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    min={5}
                    step={5}
                  />
                </div>
              </div>

              <div className="text-xs text-slate-500">
                Status inicial: <span className="font-semibold">requested</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                onClick={submitCreate}
                disabled={loading}
              >
                Criar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Booking drawer */}
      {selectedBooking ? (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30">
          <div className="h-full w-full max-w-md bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-800">Agendamento</div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => setSelectedBooking(null)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 px-4 py-4 text-sm">
              <div>
                <div className="text-xs font-semibold text-slate-600">ID</div>
                <div className="font-mono">{selectedBooking.id}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-600">Status</div>
                  <div className="font-semibold">{statusLabel(selectedBooking.status)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">Contato</div>
                  <div className="truncate">
                    {contactsById[selectedBooking.contactId]?.displayName ||
                      contactsById[selectedBooking.contactId]?.name ||
                      selectedBooking.contactId}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-600">Serviço</div>
                <div>{selectedBooking.service?.name || "—"}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-600">Início</div>
                  <div>{parseDateSafe(selectedBooking.startAt)?.toLocaleString("pt-BR") || "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">Fim</div>
                  <div>{parseDateSafe(selectedBooking.endAt)?.toLocaleString("pt-BR") || "—"}</div>
                </div>
              </div>

              <div className="pt-2">
                <div className="text-xs font-semibold text-slate-600">Ações</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => changeStatus(selectedBooking, "confirmed")}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => changeStatus(selectedBooking, "awaiting_confirmation")}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Aguardar confirmação
                  </button>
                  <button
                    type="button"
                    onClick={() => changeStatus(selectedBooking, "cancelled")}
                    className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => changeStatus(selectedBooking, "no_show")}
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    No-show
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              Esta UI é operacional (28.3). Otimizações de UX e validações vêm depois.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
