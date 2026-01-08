import { NextRequest, NextResponse } from "next/server";
import { resolveLlmDecision } from "@/lib/llmPolicy";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = String(searchParams.get("clientId") || "").trim();
  const contextRaw = String(searchParams.get("context") || "inbound").trim();
  const context = contextRaw === "campaign" ? "campaign" : "inbound";

  if (!clientId) return NextResponse.json({ error: "clientId é obrigatório" }, { status: 400 });

  const decision = await resolveLlmDecision({ clientId, context });
  return NextResponse.json({ ok: true, decision }, { status: 200 });
}
