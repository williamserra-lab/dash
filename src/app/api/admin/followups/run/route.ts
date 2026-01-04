import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { runFollowupsAndQueue, type Vertical } from "@/lib/followupsRunner";
import { optString } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);

    const clientId = optString((body as any)?.clientId);
    const verticalRaw = optString((body as any)?.vertical);

    if (!clientId) {
      return NextResponse.json(
        { ok: false, error: "clientId é obrigatório" },
        { status: 400 }
      );
    }

    if (!verticalRaw) {
      return NextResponse.json(
        { ok: false, error: "vertical é obrigatório" },
        { status: 400 }
      );
    }

    // Nota operacional: validação de valores de `vertical` deve ser centralizada
    // quando o conjunto permitido estiver consolidado. Aqui garantimos build estável.
    const vertical = verticalRaw as unknown as Vertical;

    const out = await runFollowupsAndQueue({
      clientId,
      vertical,
    });

    return NextResponse.json(out);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Erro inesperado" },
      { status: 500 }
    );
  }
}
