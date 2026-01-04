// src/app/api/webhooks/evolution/route.ts
import { NextRequest } from "next/server";
import { handleEvolutionWebhook } from "@/lib/evolutionWebhookHandler";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleEvolutionWebhook(req);
}
