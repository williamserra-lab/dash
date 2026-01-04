// src/app/api/webhooks/evolution/[event]/route.ts
import { NextRequest } from "next/server";
import { handleEvolutionWebhook } from "@/lib/evolutionWebhookHandler";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ event: string }> }) {
  const { event } = await ctx.params;
  return handleEvolutionWebhook(req, event);
}
