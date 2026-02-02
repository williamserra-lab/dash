// src/app/api/clients/[clientId]/assistant-settings/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin } from "@/lib/adminAuth";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import {
  getAssistantSettings,
  toPublicAssistantSettings,
  upsertAssistantSettings,
  type Personality,
  type Verbosity,
} from "@/lib/assistantSettings";
import type { LLMProvider } from "@/lib/llm";
import { readJsonObject } from "@/lib/http/body";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asOptionalString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asOptionalNumber(v: unknown): number | undefined {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

const PERSONALITIES = ["profissional", "amigavel", "direto", "vendedor_consultivo"] as const;
function asOptionalPersonality(v: unknown): Personality | undefined {
  if (typeof v !== "string") return undefined;
  return (PERSONALITIES as readonly string[]).includes(v) ? (v as Personality) : undefined;
}

const VERBOSITIES = ["conciso", "equilibrado", "prolixo"] as const;
function asOptionalVerbosity(v: unknown): Verbosity | undefined {
  if (typeof v !== "string") return undefined;
  return (VERBOSITIES as readonly string[]).includes(v) ? (v as Verbosity) : undefined;
}

const PROVIDERS = ["ollama", "openai", "gemini", "groq", "xai"] as const;
function asOptionalProvider(v: unknown): LLMProvider | undefined {
  if (typeof v !== "string") return undefined;
  return (PROVIDERS as readonly string[]).includes(v) ? (v as LLMProvider) : undefined;
}

function asOptionalUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  try {
    // accept http(s) only
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Erro desconhecido";
  }
}

// GET /api/clients/:clientId/assistant-settings
export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  void _req;
  try {
    const denied = await requireAdmin(_req);
    if (denied) return denied;

    const { clientId } = await context.params;

    await assertClientActive(clientId);

    const settings = toPublicAssistantSettings(await getAssistantSettings(clientId));
    return NextResponse.json({ settings }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof ClientAccessError) {
      const e = error as ClientAccessError;
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }

    console.error("Erro ao carregar assistant-settings:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) || "Erro interno ao carregar configurações." },
      { status: 500 }
    );
  }
}

// POST /api/clients/:clientId/assistant-settings
export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const denied = await requireSuperAdmin(req);
    if (denied) return denied;

    const { clientId } = await context.params;

    await assertClientActive(clientId);

    const raw = await readJsonObject(req);
    const b = asRecord(raw);

    const settings = await upsertAssistantSettings(clientId, {
      promptRules: asOptionalString(b.promptRules),
      personality: asOptionalPersonality(b.personality),
      verbosity: asOptionalVerbosity(b.verbosity),
      temperature: asOptionalNumber(b.temperature),
      provider: asOptionalProvider(b.provider),
      model: asOptionalString(b.model),
      baseUrl: asOptionalUrl(b.baseUrl),
      apiKeyPlain: asOptionalString(b.apiKeyPlain),
    });

    return NextResponse.json({ settings: toPublicAssistantSettings(settings) }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof ClientAccessError) {
      const e = error as ClientAccessError;
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }

    const msg = getErrorMessage(error) || "Erro interno ao salvar configurações.";

    // Caso clássico: NEXTIA_MASTER_KEY ausente ao tentar salvar apiKey.
    if (typeof msg === "string" && msg.includes("NEXTIA_MASTER_KEY")) {
      return NextResponse.json(
        { error: "master_key_required", message: msg },
        { status: 400 }
      );
    }

    console.error("Erro ao salvar assistant-settings:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
