// src/lib/assistantSettings.ts
export const runtime = "nodejs";

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { LLMProvider } from "@/lib/llm";

export type Verbosity = "conciso" | "equilibrado" | "prolixo";
export type Personality =
  | "profissional"
  | "amigavel"
  | "direto"
  | "vendedor_consultivo";

export type AssistantSettings = {
  clientId: string;
  promptRules?: string; // "pode / não pode"
  personality?: Personality;
  verbosity?: Verbosity;
  temperature?: number; // 0..1
  provider?: LLMProvider;
  model?: string;

  // Salvo criptografado
  apiKeyEnc?: string; // base64(iv).base64(tag).base64(ciphertext)
  apiKeyLast4?: string;

  // ------------------------
  // Conversa/UX (lojista preenche sem tecnicismo)
  // ------------------------
  greetingText?: string; // mensagem inicial de apresentação
  highlightsText?: string; // "destaques" / resumo do que vende
  businessHoursText?: string; // horários
  addressText?: string; // endereço / retirada
  humanHandoffText?: string; // texto quando escolher falar com humano

  // Menu inicial (opções numeradas)
  menuItems?: Array<{
    id: string;
    label: string;
    action: "products" | "order" | "hours_location" | "human";
    enabled?: boolean;
  }>;

  // Segurança operacional: sem catálogo completo, pré-pedido é bloqueado.
  requireCatalogForPreorder?: boolean;
  updatedAt: string;
};

type StoreShape = Record<string, AssistantSettings>;

const DATA_FILE = path.join(process.cwd(), "data", "assistant_settings.json");

function getMasterKey(): Buffer | null {
  const raw = (process.env.NEXTIA_MASTER_KEY || "").trim();
  if (!raw) return null;

  // Aceita base64, hex ou texto; padroniza via sha256 (32 bytes)
  const isHex = /^[0-9a-fA-F]{64}$/.test(raw);
  const bytes = isHex
    ? Buffer.from(raw, "hex")
    : (() => {
        try {
          const b = Buffer.from(raw, "base64");
          // se for base64 inválido vira lixo; valida mínimo
          if (b.length >= 16) return b;
        } catch {}
        return Buffer.from(raw, "utf8");
      })();

  return crypto.createHash("sha256").update(bytes).digest();
}

function encryptApiKey(apiKey: string): { apiKeyEnc: string; apiKeyLast4: string } {
  const master = getMasterKey();
  if (!master) {
    throw new Error("NEXTIA_MASTER_KEY não configurada. Não é seguro salvar apiKey por cliente.");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master, iv);

  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const apiKeyEnc = `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
  const apiKeyLast4 = apiKey.slice(-4);

  return { apiKeyEnc, apiKeyLast4 };
}

export function decryptApiKey(apiKeyEnc?: string): string | null {
  if (!apiKeyEnc) return null;

  const master = getMasterKey();
  if (!master) return null;

  const parts = apiKeyEnc.split(".");
  if (parts.length !== 3) return null;

  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", master, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString("utf8");
}

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object") return {};
    return json as StoreShape;
  } catch {
    return {};
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

export async function getAssistantSettings(clientId: string): Promise<AssistantSettings | null> {
  const store = await readStore();
  return store[clientId] ?? null;
}

export async function upsertAssistantSettings(
  clientId: string,
  input: Partial<AssistantSettings> & { apiKeyPlain?: string | null }
): Promise<AssistantSettings> {
  const store = await readStore();
  const now = new Date().toISOString();

  const prev = store[clientId];

  let apiKeyEnc = prev?.apiKeyEnc;
  let apiKeyLast4 = prev?.apiKeyLast4;

  if (typeof input.apiKeyPlain === "string") {
    const trimmed = input.apiKeyPlain.trim();
    if (trimmed.length === 0) {
      apiKeyEnc = undefined;
      apiKeyLast4 = undefined;
    } else {
      const enc = encryptApiKey(trimmed);
      apiKeyEnc = enc.apiKeyEnc;
      apiKeyLast4 = enc.apiKeyLast4;
    }
  }

  const saved: AssistantSettings = {
    clientId,
    promptRules: input.promptRules ?? prev?.promptRules,
    personality: input.personality ?? prev?.personality ?? "profissional",
    verbosity: input.verbosity ?? prev?.verbosity ?? "equilibrado",
    temperature:
      typeof input.temperature === "number"
        ? Math.max(0, Math.min(1, input.temperature))
        : prev?.temperature ?? 0.2,
    provider: input.provider ?? prev?.provider ?? "ollama",
    model: input.model ?? prev?.model,

    // UX / conversa
    greetingText: input.greetingText ?? prev?.greetingText,
    highlightsText: input.highlightsText ?? prev?.highlightsText,
    businessHoursText: input.businessHoursText ?? prev?.businessHoursText,
    addressText: input.addressText ?? prev?.addressText,
    humanHandoffText: input.humanHandoffText ?? prev?.humanHandoffText,

    menuItems: Array.isArray(input.menuItems)
      ? input.menuItems
          .filter((x) => x && typeof x === "object")
          // mantém somente campos conhecidos
          .map((x) => ({
            id: String((x as any).id || ""),
            label: String((x as any).label || ""),
            action: (String((x as any).action || "") as any),
            enabled: (x as any).enabled === false ? false : true,
          }))
          .filter((x) => x.id && x.label && x.action)
      : prev?.menuItems,

    requireCatalogForPreorder:
      typeof input.requireCatalogForPreorder === "boolean"
        ? input.requireCatalogForPreorder
        : prev?.requireCatalogForPreorder ?? true,
    apiKeyEnc,
    apiKeyLast4,
    updatedAt: now,
  };

  store[clientId] = saved;
  await writeStore(store);
  return saved;
}
