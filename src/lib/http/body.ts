// src/lib/http/body.ts
import { NextRequest } from "next/server";

export type JsonRecord = Record<string, unknown>;

export async function readJsonObject(req: NextRequest): Promise<JsonRecord> {
  const json = await req.json().catch(() => null);

  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("Body inválido: esperado um objeto JSON.");
  }

  return json as JsonRecord;
}
