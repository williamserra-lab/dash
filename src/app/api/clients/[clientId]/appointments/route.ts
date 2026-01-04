// src/app/api/clients/[clientId]/appointments/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import {
  createAppointment,
  getAppointmentsByClient,
  getServicesByClient,
  type PaymentMethod,
  type PaymentTiming,
} from "@/lib/appointments";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

// Configuração básica de horário de funcionamento.
// Futuro: isso pode virar configuração por cliente em JSON/DB.
const WORKING_HOURS = {
  startHour: 8, // 08:00
  endHour: 20, // 20:00 (horário de fechamento)
  allowedWeekdays: [1, 2, 3, 4, 5, 6], // 0=Domingo, 1=Segunda, ..., 6=Sábado
};

function isWithinWorkingHours(start: Date, end: Date): boolean {
  const weekday = start.getDay();

  // Só permite dias configurados
  if (!WORKING_HOURS.allowedWeekdays.includes(weekday)) {
    return false;
  }

  // Não permitimos agendamento que cruza de um dia para outro
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (!sameDay) {
    return false;
  }

  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();

  const openMinutes = WORKING_HOURS.startHour * 60;
  const closeMinutes = WORKING_HOURS.endHour * 60;

  // Início tem que ser >= abertura e fim <= fechamento
  if (startMinutes < openMinutes) return false;
  if (endMinutes > closeMinutes) return false;

  return true;
}

function intervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  // Overlap se A começa antes de B terminar E B começa antes de A terminar
  return startA < endB && startB < endA;
}

export async function GET(
  _req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId é obrigatório." },
        { status: 400 }
      );
    }

    const appointments = await getAppointmentsByClient(clientId);
    return NextResponse.json({ appointments }, { status: 200 });
  } catch (error) {
    console.error("Erro ao listar agendamentos:", error);
    return NextResponse.json(
      { error: "Erro interno ao listar agendamentos." },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId é obrigatório." },
        { status: 400 }
      );
    }

    const body = await readJsonObject(req);

    const contactId = String(body.contactId || "").trim();
    const identifier = String(body.identifier || "").trim();
    const contactName =
      typeof body.contactName === "string" ? body.contactName : undefined;

    const serviceId = String(body.serviceId || "").trim();
    const serviceName = String(body.serviceName || "").trim();
    const professionalId = String(body.professionalId || "").trim();
    const professionalName = String(body.professionalName || "").trim();

    const date = String(body.date || "").trim(); // "2025-11-27"
    const time = String(body.time || "").trim(); // "14:00"

    const paymentTiming = (body.paymentTiming || null) as PaymentTiming | null;
    const paymentMethod = (body.paymentMethod || null) as PaymentMethod | null;
    const notes =
      typeof body.notes === "string" ? body.notes : undefined;

    if (!contactId || !identifier) {
      return NextResponse.json(
        { error: "Contato é obrigatório para criar agendamento." },
        { status: 400 }
      );
    }

    if (!serviceId || !serviceName) {
      return NextResponse.json(
        { error: "Serviço é obrigatório para criar agendamento." },
        { status: 400 }
      );
    }

    if (!professionalId || !professionalName) {
      return NextResponse.json(
        { error: "Profissional é obrigatório para criar agendamento." },
        { status: 400 }
      );
    }

    if (!date || !time) {
      return NextResponse.json(
        { error: "Data e horário são obrigatórios." },
        { status: 400 }
      );
    }

    // 1) Calcula startDateTime a partir de date + time
    const startLocal = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startLocal.getTime())) {
      return NextResponse.json(
        { error: "Data ou horário em formato inválido." },
        { status: 400 }
      );
    }

    // 2) Busca o serviço para descobrir a duração
    const services = await getServicesByClient(clientId);
    const service = services.find((s) => s.id === serviceId);

    const durationMinutes =
      service && service.durationMinutes && service.durationMinutes > 0
        ? Math.floor(service.durationMinutes)
        : 30;

    const endLocal = new Date(
      startLocal.getTime() + durationMinutes * 60 * 1000
    );

    // 3) Valida horário de funcionamento
    if (!isWithinWorkingHours(startLocal, endLocal)) {
      return NextResponse.json(
        {
          error:
            "Horário fora do expediente. Funcionamento padrão: segunda a sábado, das 08:00 às 20:00.",
        },
        { status: 400 }
      );
    }

    // 4) Verifica conflito com outros agendamentos do mesmo profissional
    const existingAppointments = await getAppointmentsByClient(clientId);

    const startMs = startLocal.getTime();
    const endMs = endLocal.getTime();

    const conflicting = existingAppointments.find((a) => {
      if (a.professionalId !== professionalId) return false;
      if (a.status === "cancelado" || a.status === "no_show") return false;

      const aStart = new Date(a.startDateTime).getTime();
      const aEnd = new Date(a.endDateTime).getTime();
      if (Number.isNaN(aStart) || Number.isNaN(aEnd)) return false;

      return intervalsOverlap(startMs, endMs, aStart, aEnd);
    });

    if (conflicting) {
      return NextResponse.json(
        {
          error: "Horário indisponível para este profissional.",
          conflict: {
            id: conflicting.id,
            professionalId: conflicting.professionalId,
            startDateTime: conflicting.startDateTime,
            endDateTime: conflicting.endDateTime,
            status: conflicting.status,
          },
        },
        { status: 409 }
      );
    }

    // 5) Cria o agendamento
    const appointment = await createAppointment({
      clientId,
      contactId,
      identifier,
      contactName,
      serviceId,
      serviceName,
      professionalId,
      professionalName,
      startDateTime: startLocal.toISOString(),
      endDateTime: endLocal.toISOString(),
      paymentTiming,
      paymentMethod,
      notes,
    });

    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar agendamento:", error);
    return NextResponse.json(
      { error: "Erro interno ao criar agendamento." },
      { status: 500 }
    );
  }
}
