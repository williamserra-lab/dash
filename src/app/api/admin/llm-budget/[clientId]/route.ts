import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getPolicyForClient, setPolicyForClient, type LlmOverLimitMode } from "@/lib/llmBudget";

export const runtime = "nodejs";

type Body = {
  monthlyTokenLimit?: number;
  overLimitMode?: LlmOverLimitMode;
};

async function readJsonSafe(req: NextRequest): Promise<Body> {
  const raw = await req.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Body;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const { clientId } = await ctx.params;
  const id = String(clientId || "").trim();
  if (!id) return NextResponse.json({ error: "clientId é obrigatório" }, { status: 400 });

  const policy = await getPolicyForClient(id);
  return NextResponse.json({ ok: true, policy }, { status: 200 });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const { clientId } = await ctx.params;
  const id = String(clientId || "").trim();
  if (!id) return NextResponse.json({ error: "clientId é obrigatório" }, { status: 400 });

  const body = await readJsonSafe(req);
  const monthlyTokenLimit =
    typeof body.monthlyTokenLimit === "number" ? body.monthlyTokenLimit : undefined;
  const overLimitMode = body.overLimitMode;

  const policy = await setPolicyForClient(id, { monthlyTokenLimit, overLimitMode });
  return NextResponse.json({ ok: true, policy }, { status: 200 });
}
