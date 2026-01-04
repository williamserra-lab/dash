export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { updateAppointmentStatus } from "@/lib/appointments";
import { assertClientActive } from "@/lib/clientsRegistry";
import { readJsonObject } from "@/lib/http/body";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Erro desconhecido";
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string; appointmentId: string }> }
) {

  try {
    const { clientId, appointmentId } = await ctx.params;

    await assertClientActive(clientId);

    const body = await readJsonObject(req);
    const status = body?.status;

    if (typeof status !== "string" || !status.trim()) {
      return NextResponse.json({ error: "Campo 'status' é obrigatório." }, { status: 400 });
    }

    const appointment = await updateAppointmentStatus(clientId, appointmentId, status);

    return NextResponse.json({ appointment }, { status: 200 });
  } catch (error: unknown) {
    const msg = getErrorMessage(error) || "Erro ao atualizar agendamento.";
    const code = msg.toLowerCase().includes("não encontrado") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
