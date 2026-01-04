"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Erro desconhecido";
  }
}

type Contact = {
  id: string;
  clientId: string;
  channel: string;
  identifier: string;
  name?: string;
  vip: boolean;
  optOutMarketing: boolean;
  blockedGlobal: boolean;
};

type Service = {
  id: string;
  clientId: string;
  name: string;
  description?: string;
  durationMinutes: number;
  basePrice?: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type Professional = {
  id: string;
  clientId: string;
  name: string;
  servicesIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type AppointmentStatus =
  | "solicitado"
  | "confirmado"
  | "concluido"
  | "cancelado"
  | "no_show";

type PaymentTiming = "antecipado" | "no_local" | null;
type PaymentMethod =
  | "pix"
  | "dinheiro"
  | "cartao_credito"
  | "cartao_debito"
  | null;

type Appointment = {
  id: string;
  clientId: string;
  contactId: string;
  identifier: string;
  contactName?: string;
  serviceId: string;
  serviceName: string;
  professionalId: string;
  professionalName: string;
  startDateTime: string;
  endDateTime: string;
  status: AppointmentStatus;
  paymentTiming?: PaymentTiming | null;
  paymentMethod?: PaymentMethod | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_CLIENT_ID = "catia_foods";

function formatTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("pt-BR");
}

function labelStatus(status: AppointmentStatus): string {
  switch (status) {
    case "solicitado":
      return "Solicitado";
    case "confirmado":
      return "Confirmado";
    case "concluido":
      return "Concluído";
    case "cancelado":
      return "Cancelado";
    case "no_show":
      return "No-show";
    default:
      return status;
  }
}

function labelPaymentTiming(timing: PaymentTiming | null | undefined): string {
  if (timing === "antecipado") return "Antecipado";
  if (timing === "no_local") return "No local";
  return "-";
}

function labelPaymentMethod(method: PaymentMethod | null | undefined): string {
  switch (method) {
    case "pix":
      return "PIX";
    case "dinheiro":
      return "Dinheiro";
    case "cartao_credito":
      return "Cartão crédito";
    case "cartao_debito":
      return "Cartão débito";
    default:
      return "-";
  }
}

function AgendamentosInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") || DEFAULT_CLIENT_ID;

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creatingService, setCreatingService] = useState(false);
  const [creatingProfessional, setCreatingProfessional] = useState(false);
  const [creatingAppointment, setCreatingAppointment] = useState(false);
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(null);

  // filtros
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().slice(0, 10);
  });

  // formulário serviço
  const [serviceName, setServiceName] = useState("");
  const [serviceDuration, setServiceDuration] = useState<number>(30);
  const [servicePrice, setServicePrice] = useState<string>("");

  // formulário profissional
  const [professionalName, setProfessionalName] = useState("");

  // formulário agendamento
  const [appointmentContactId, setAppointmentContactId] = useState<string>("");
  const [appointmentServiceId, setAppointmentServiceId] = useState<string>("");
  const [appointmentProfessionalId, setAppointmentProfessionalId] = useState<string>("");
  const [appointmentTime, setAppointmentTime] = useState<string>("09:00");
  const [appointmentPaymentTiming, setAppointmentPaymentTiming] =
    useState<PaymentTiming | null>(null);
  const [appointmentPaymentMethod, setAppointmentPaymentMethod] =
    useState<PaymentMethod | null>(null);
  const [appointmentNotes, setAppointmentNotes] = useState<string>("");

  async function loadAll() {
    try {
      setLoading(true);
      setError(null);

      const [contactsRes, servicesRes, professionalsRes, appointmentsRes] =
        await Promise.all([
          fetch(`/api/clients/${clientId}/contacts`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          }),
          fetch(`/api/clients/${clientId}/services`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          }),
          fetch(`/api/clients/${clientId}/professionals`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          }),
          fetch(`/api/clients/${clientId}/appointments`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          }),
        ]);

      if (!contactsRes.ok) {
        const body = await contactsRes.json().catch(() => null);
        throw new Error(body?.error || `Erro ao carregar contatos (${contactsRes.status})`);
      }

      if (!servicesRes.ok) {
        const body = await servicesRes.json().catch(() => null);
        throw new Error(body?.error || `Erro ao carregar serviços (${servicesRes.status})`);
      }

      if (!professionalsRes.ok) {
        const body = await professionalsRes.json().catch(() => null);
        throw new Error(
          body?.error || `Erro ao carregar profissionais (${professionalsRes.status})`
        );
      }

      if (!appointmentsRes.ok) {
        const body = await appointmentsRes.json().catch(() => null);
        throw new Error(
          body?.error || `Erro ao carregar agendamentos (${appointmentsRes.status})`
        );
      }

      const contactsData = await contactsRes.json();
      const servicesData = await servicesRes.json();
      const professionalsData = await professionalsRes.json();
      const appointmentsData = await appointmentsRes.json();

      setContacts(contactsData.contacts ?? []);
      setServices(servicesData.services ?? []);
      setProfessionals(professionalsData.professionals ?? []);
      setAppointments(appointmentsData.appointments ?? []);
    } catch (err: unknown) {      console.error("Erro ao carregar dados:", err);
      setError(getErrorMessage(err) || "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const appointmentsForSelectedDate = useMemo(() => {
    if (!selectedDate) return appointments;

    return appointments
      .filter((a) => a.startDateTime?.slice(0, 10) === selectedDate)
      .sort((a, b) => (a.startDateTime > b.startDateTime ? 1 : -1));
  }, [appointments, selectedDate]);

  // ---------- CREATE SERVICE ----------

  async function handleCreateService() {
    try {
      if (!serviceName.trim()) return;
      setCreatingService(true);
      setError(null);

      const res = await fetch(`/api/clients/${clientId}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: serviceName.trim(),
          durationMinutes: serviceDuration,
          basePrice: servicePrice ? Number(servicePrice) : undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Erro ao criar serviço (${res.status})`);
      }

      setServiceName("");
      setServiceDuration(30);
      setServicePrice("");

      await loadAll();
    } catch (err: unknown) {      console.error("Erro ao criar serviço:", err);
      setError(getErrorMessage(err) || "Erro ao criar serviço.");
    } finally {
      setCreatingService(false);
    }
  }

  // ---------- CREATE PROFESSIONAL ----------

  async function handleCreateProfessional() {
    try {
      if (!professionalName.trim()) return;
      setCreatingProfessional(true);
      setError(null);

      const res = await fetch(`/api/clients/${clientId}/professionals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: professionalName.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Erro ao criar profissional (${res.status})`);
      }

      setProfessionalName("");
      await loadAll();
    } catch (err: unknown) {      console.error("Erro ao criar profissional:", err);
      setError(getErrorMessage(err) || "Erro ao criar profissional.");
    } finally {
      setCreatingProfessional(false);
    }
  }

  // ---------- CREATE APPOINTMENT ----------

  async function handleCreateAppointment() {
    try {
      if (!appointmentContactId || !appointmentServiceId || !appointmentProfessionalId) {
        return;
      }
      if (!selectedDate || !appointmentTime) return;

      setCreatingAppointment(true);
      setError(null);

      const contact = contacts.find((c) => c.id === appointmentContactId);
      const service = services.find((s) => s.id === appointmentServiceId);
      const professional = professionals.find((p) => p.id === appointmentProfessionalId);

      if (!contact || !service || !professional) return;

      const res = await fetch(`/api/clients/${clientId}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: contact.id,
          identifier: contact.identifier,
          contactName: contact.name,
          serviceId: service.id,
          serviceName: service.name,
          professionalId: professional.id,
          professionalName: professional.name,
          date: selectedDate,
          time: appointmentTime,
          paymentTiming: appointmentPaymentTiming,
          paymentMethod: appointmentPaymentMethod,
          notes: appointmentNotes,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Erro ao criar agendamento (${res.status})`);
      }

      setAppointmentContactId("");
      setAppointmentServiceId("");
      setAppointmentProfessionalId("");
      setAppointmentTime("09:00");
      setAppointmentPaymentTiming(null);
      setAppointmentPaymentMethod(null);
      setAppointmentNotes("");

      await loadAll();
    } catch (err: unknown) {      console.error("Erro ao criar agendamento:", err);
      setError(getErrorMessage(err) || "Erro ao criar agendamento.");
    } finally {
      setCreatingAppointment(false);
    }
  }

  // ---------- UPDATE APPOINTMENT STATUS ----------

  async function handleUpdateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
    try {
      setUpdatingAppointmentId(appointmentId);
      setError(null);

      const res = await fetch(`/api/clients/${clientId}/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Erro ao atualizar agendamento (${res.status})`);
      }

      const data = await res.json();
      const updated: Appointment = data.appointment;

      setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err: unknown) {      console.error("Erro ao atualizar agendamento:", err);
      setError(getErrorMessage(err) || "Erro ao atualizar agendamento.");
    } finally {
      setUpdatingAppointmentId(null);
    }
  }

  const contactsSorted = useMemo(
    () =>
      [...contacts].sort((a, b) => {
        const an = a.name || a.identifier;
        const bn = b.name || b.identifier;
        return an > bn ? 1 : -1;
      }),
    [contacts]
  );

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-bold text-slate-900">Agendamentos – {clientId}</h1>
            <p className="max-w-2xl text-sm text-slate-600">
              Agenda manual de serviços (barbearia, salão, clínica, etc.). Os agendamentos aqui são
              ligados a contatos existentes e podem ser marcados como solicitados, confirmados,
              concluídos, cancelados ou no-show. Nesta etapa, não há cálculo automático de
              disponibilidade: o foco é organizar a rotina do humano.
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={loadAll}
              disabled={loading}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Atualizando..." : "Recarregar"}
            </button>
            {error && (
              <div className="max-w-xs rounded-md bg-red-100 px-3 py-2 text-xs text-red-800">
                {error}
              </div>
            )}
          </div>
        </header>

        {/* Linha principal: agenda + cadastro agendamento */}
        <section className="flex flex-col gap-4 lg:flex-row">
          {/* Agenda diária */}
          <div className="flex-1 rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-600">Data:</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <p className="text-xs text-slate-500">
                {appointmentsForSelectedDate.length} agendamento(s) neste dia
              </p>
            </div>

            <div className="overflow-x-auto">
              {appointmentsForSelectedDate.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum agendamento para esta data ainda.</p>
              ) : (
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <th className="px-3 py-2">Hora</th>
                      <th className="px-3 py-2">Cliente</th>
                      <th className="px-3 py-2">Serviço</th>
                      <th className="px-3 py-2">Profissional</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Pagamento</th>
                      <th className="px-3 py-2">Observações</th>
                      <th className="px-3 py-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointmentsForSelectedDate.map((a) => (
                      <tr key={a.id} className="border-b border-slate-100 bg-white align-top">
                        <td className="px-3 py-2 text-xs text-slate-700">
                          {formatTime(a.startDateTime)}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          <div className="font-medium">{a.contactName || "-"}</div>
                          <div className="text-[11px] text-slate-500">{a.identifier}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          <div>{a.serviceName}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          <div>{a.professionalName}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-800">
                            {labelStatus(a.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-700">
                          <div>{labelPaymentTiming(a.paymentTiming ?? null)}</div>
                          <div className="text-slate-500">
                            {labelPaymentMethod(a.paymentMethod ?? null)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-600">
                          {a.notes || "-"}
                          <div className="mt-1 text-[10px] text-slate-400">
                            Criado em {formatDate(a.createdAt)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-700">
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => handleUpdateAppointmentStatus(a.id, "confirmado")}
                              disabled={updatingAppointmentId === a.id}
                              className="rounded-md border border-emerald-500 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateAppointmentStatus(a.id, "concluido")}
                              disabled={updatingAppointmentId === a.id}
                              className="rounded-md border border-sky-500 px-2 py-1 text-[11px] text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Concluído
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateAppointmentStatus(a.id, "no_show")}
                              disabled={updatingAppointmentId === a.id}
                              className="rounded-md border border-amber-500 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              No-show
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateAppointmentStatus(a.id, "cancelado")}
                              disabled={updatingAppointmentId === a.id}
                              className="rounded-md border border-red-500 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Cadastro de agendamento */}
          <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Novo agendamento
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600">Contato</label>
                <select
                  value={appointmentContactId}
                  onChange={(e) => setAppointmentContactId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">Selecione um contato...</option>
                  {contactsSorted.map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.name || c.identifier) + " · " + c.identifier}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600">Serviço</label>
                  <select
                    value={appointmentServiceId}
                    onChange={(e) => setAppointmentServiceId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Selecione...</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600">Profissional</label>
                  <select
                    value={appointmentProfessionalId}
                    onChange={(e) => setAppointmentProfessionalId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Selecione...</option>
                    {professionals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600">Data</label>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div className="w-28">
                  <label className="block text-xs font-semibold text-slate-600">Hora</label>
                  <input
                    type="time"
                    value={appointmentTime}
                    onChange={(e) => setAppointmentTime(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600">
                    Momento do pagamento
                  </label>
                  <select
                    value={appointmentPaymentTiming || ""}
                    onChange={(e) =>
                      setAppointmentPaymentTiming(
                        e.target.value ? (e.target.value as PaymentTiming) : null
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Não definido</option>
                    <option value="antecipado">Antecipado</option>
                    <option value="no_local">No local</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600">
                    Forma de pagamento
                  </label>
                  <select
                    value={appointmentPaymentMethod || ""}
                    onChange={(e) =>
                      setAppointmentPaymentMethod(
                        e.target.value ? (e.target.value as PaymentMethod) : null
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Não definido</option>
                    <option value="pix">PIX</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="cartao_credito">Cartão crédito</option>
                    <option value="cartao_debito">Cartão débito</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600">
                  Observações internas
                </label>
                <textarea
                  value={appointmentNotes}
                  onChange={(e) => setAppointmentNotes(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  placeholder="Ex.: cliente prefere lado direito, trazer histórico, cuidado com atraso..."
                />
              </div>

              <button
                type="button"
                onClick={handleCreateAppointment}
                disabled={
                  creatingAppointment ||
                  !appointmentContactId ||
                  !appointmentServiceId ||
                  !appointmentProfessionalId ||
                  !selectedDate ||
                  !appointmentTime
                }
                className="w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
              >
                {creatingAppointment ? "Criando..." : "Salvar agendamento"}
              </button>
            </div>

            <div className="mt-4 space-y-3 border-t border-slate-200 pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Cadastro rápido de serviço e profissional
              </h3>

              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-600">Novo serviço</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="text"
                      value={serviceName}
                      onChange={(e) => setServiceName(e.target.value)}
                      placeholder="Ex.: Corte masculino"
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <input
                      type="number"
                      min={5}
                      value={serviceDuration}
                      onChange={(e) => setServiceDuration(Number(e.target.value) || 30)}
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      placeholder="min"
                    />
                    <input
                      type="number"
                      min={0}
                      value={servicePrice}
                      onChange={(e) => setServicePrice(e.target.value)}
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      placeholder="R$"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateService}
                    disabled={creatingService || !serviceName.trim()}
                    className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingService ? "Salvando..." : "Salvar serviço"}
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600">
                    Novo profissional
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="text"
                      value={professionalName}
                      onChange={(e) => setProfessionalName(e.target.value)}
                      placeholder="Ex.: João barbeiro"
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateProfessional}
                    disabled={creatingProfessional || !professionalName.trim()}
                    className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingProfessional ? "Salvando..." : "Salvar profissional"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
export default function AgendamentosPage() {
  return (
    <Suspense fallback={null}>
      <AgendamentosInner />
    </Suspense>
  );
}
