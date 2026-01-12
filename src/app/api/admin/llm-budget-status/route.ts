import { NextRequest, NextResponse } from "next/server";
import { resolveLlmDecision } from "@/lib/llmPolicy";
import type { LlmContext } from "@/lib/llmPolicy";

export const runtime = "nodejs";

/**
 * Returns current LLM budget decision for a clientId + context.
 * Fix: context must be a valid LlmContext. Current union supports "inbound" | "campaign".
 */
function parseContext(raw: string | null): LlmContext {
  const v = String(raw || "inbound").trim();
  if (v === "campaign") return "campaign";
  return "inbound";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = String(searchParams.get("clientId") || "").trim();
  const context = parseContext(searchParams.get("context"));

  if (!clientId) {
    return NextResponse.json(
      { error: "bad_request", message: "clientId é obrigatório" },
      { status: 400 }
    );
  }

  const decision = await resolveLlmDecision({ clientId, context });
  return NextResponse.json({ ok: true, decision }, { status: 200 });
}