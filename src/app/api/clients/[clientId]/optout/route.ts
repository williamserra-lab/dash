export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive } from "@/lib/clientsRegistry";
import { getContactById, setContactOptOut } from "@/lib/contacts";
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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await ctx.params;

    await assertClientActive(clientId);

    const body = await readJsonObject(req);
    const contactId = body?.contactId;
    const optOut = body?.optOut === true;

    if (typeof contactId !== "string" || !contactId.trim()) {
      return NextResponse.json({ error: "Campo 'contactId' é obrigatório." }, { status: 400 });
    }

    const existing = await getContactById(clientId, contactId);
    if (!existing) {
      return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
    }

    const contact = await setContactOptOut(contactId, optOut);

    return NextResponse.json({ contact }, { status: 200 });
  } catch (error: unknown) {
    const msg = getErrorMessage(error) || "Erro ao atualizar opt-out.";
    const lc = msg.toLowerCase();
    const status =
      lc.includes("não encontrado") ? 404 : lc.includes("inativo") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
