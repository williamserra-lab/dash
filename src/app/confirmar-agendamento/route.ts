// src/app/confirmar-agendamento/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { listTimelineEvents, recordTimelineEvent } from "@/lib/timeline";

function html(status: number, title: string, message: string) {
  const body = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding: 24px; background:#f8fafc; color:#0f172a; }
    .card { max-width: 560px; margin: 0 auto; background:white; border:1px solid #e2e8f0; border-radius: 12px; padding: 20px; box-shadow: 0 1px 4px rgba(15,23,42,0.06); }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { margin: 0; line-height: 1.4; color:#334155; }
    .muted { margin-top: 12px; font-size: 12px; color:#64748b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="muted">Você pode fechar esta página.</p>
  </div>
</body>
</html>`;
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const clientId = (url.searchParams.get("clientId") || "").trim();
  const bookingId = (url.searchParams.get("bookingId") || "").trim();

  if (!clientId || !bookingId) {
    return html(400, "Link inválido", "Faltam parâmetros. Peça um novo link de confirmação.");
  }

  // Registra evento na timeline (best-effort e idempotente)
  try {
    const existing = await listTimelineEvents(clientId, "booking", bookingId);
    const has = existing.some((e) => e.status === "client_confirmed");
    if (!has) {
      await recordTimelineEvent({
        clientId,
        entityType: "booking",
        entityId: bookingId,
        status: "client_confirmed",
        statusGroup: "confirmado",
        actor: "customer",
        note: "confirmed via link",
      });
    }
  } catch {
    // Se falhar, não expomos detalhes ao cliente
    return html(500, "Não foi possível registrar", "Tivemos um problema ao registrar sua confirmação. Tente novamente em instantes.");
  }

  return html(200, "Confirmado ✅", "Recebemos sua confirmação e registramos no sistema.");
}
