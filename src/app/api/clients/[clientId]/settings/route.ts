// src/app/api/clients/[clientId]/settings/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { LLMProvider } from "@/lib/llm";
import { canStoreSecrets, decryptSecret, encryptSecret } from "@/lib/secretBox";
void decryptSecret;

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

type AssistantSettings = {
  systemPrompt?: string;
  personality?: string; // rótulo amigável
  verbosity?: "conciso" | "equilibrado" | "prolixo";
  temperature?: number;

  llm?: {
    provider?: LLMProvider;
    model?: string;
  };

  // Segredos ficam criptografados
  secrets?: {
    openaiKeyEnc?: string;
    geminiKeyEnc?: string;
  };

  updatedAt?: string;
};

type ClientConfig = {
  id: string;
  name: string;
  segment?: string;
  whatsappNumbers: unknown[];
  assistantSettings?: AssistantSettings;
};

const DATA_DIR = path.join(process.cwd(), "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

async function readClients(): Promise<ClientConfig[]> {
  try {
    const raw = await fs.readFile(CLIENTS_FILE, "utf-8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ClientConfig[]) : [];
  } catch {
    return [];
  }
}

async function writeClients(clients: ClientConfig[]) {
  await fs.mkdir(path.dirname(CLIENTS_FILE), { recursive: true });
  await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2), "utf-8");
}

function clampTemp(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(2, n));
}

function safeSettingsResponse(settings: AssistantSettings) {
  const provider = settings.llm?.provider as unknown as string | undefined;
  const hasKey =
    provider === "openai"
      ? Boolean(settings.secrets?.openaiKeyEnc)
      : provider === "gemini"
      ? Boolean(settings.secrets?.geminiKeyEnc)
      : false;

  return {
    ...settings,
    secrets: {
      // não vaza segredo; só sinaliza se existe
      hasApiKey: hasKey,
      canStoreSecrets: canStoreSecrets(),
    },
  };
}

// GET /api/clients/:clientId/settings
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });
    }

    const clients = await readClients();
    const client = clients.find((c) => c.id === clientId);
    const settings = client?.assistantSettings ?? {};

    return NextResponse.json({ settings: safeSettingsResponse(settings) }, { status: 200 });
  } catch (err) {
    console.error("[SETTINGS] Erro GET:", err);
    return NextResponse.json({ error: "Erro interno ao carregar configurações." }, { status: 500 });
  }
}

// PUT /api/clients/:clientId/settings
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    const clients = await readClients();
    const idx = clients.findIndex((c) => c.id === clientId);
    if (idx < 0) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }

    const current = clients[idx].assistantSettings ?? {};
    const next: AssistantSettings = {
      ...current,
      systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : current.systemPrompt,
      personality: typeof body.personality === "string" ? body.personality : current.personality,
      verbosity:
        body.verbosity === "conciso" || body.verbosity === "equilibrado" || body.verbosity === "prolixo"
          ? body.verbosity
          : current.verbosity,
      temperature: clampTemp(body.temperature) ?? current.temperature,
      llm: {
        provider: (body.llm?.provider as LLMProvider) ?? current.llm?.provider ?? "ollama",
        model: typeof body.llm?.model === "string" ? body.llm.model : current.llm?.model,
      },
      secrets: {
        ...current.secrets,
      },
      updatedAt: new Date().toISOString(),
    };

    // access key (opcional)
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const clearApiKey = Boolean(body.clearApiKey);

    if ((apiKey && !canStoreSecrets()) || (clearApiKey && !canStoreSecrets())) {
      return NextResponse.json(
        { error: "NEXTIA_MASTER_KEY não configurada; não é possível armazenar/remover chaves de forma segura." },
        { status: 400 }
      );
    }

    if (clearApiKey) {
      if (next.llm?.provider === "openai") next.secrets!.openaiKeyEnc = undefined;
      if (next.llm?.provider === "gemini") next.secrets!.geminiKeyEnc = undefined;
    } else if (apiKey) {
      const enc = encryptSecret(apiKey);
      if (next.llm?.provider === "openai") next.secrets!.openaiKeyEnc = enc;
      if (next.llm?.provider === "gemini") next.secrets!.geminiKeyEnc = enc;
    }

    clients[idx].assistantSettings = next;
    await writeClients(clients);

    return NextResponse.json({ settings: safeSettingsResponse(next) }, { status: 200 });
  } catch (err) {
    console.error("[SETTINGS] Erro PUT:", err);
    return NextResponse.json({ error: "Erro interno ao salvar configurações." }, { status: 500 });
  }
}
