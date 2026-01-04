// src/lib/whatsappAudit.ts
// Auditoria simples (append-only) para eventos operacionais.
// Mantém registro defensável sem depender de banco.

export const runtime = "nodejs";

import path from "path";
import { promises as fs } from "fs";

type AuditEntry = {
  id: string;
  at: string;
  clientId: string;
  action: string;
  meta?: Record<string, unknown>;
};

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

const DATA_DIR = process.env.NEXTIA_DATA_DIR || path.join(process.cwd(), "data");
const AUDIT_FILE = path.join(DATA_DIR, "whatsapp_audit.json");

async function readAll(): Promise<AuditEntry[]> {
  try {
    const raw = await fs.readFile(AUDIT_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuditEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(items: AuditEntry[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(AUDIT_FILE, JSON.stringify(items, null, 2), "utf-8");
}

export async function auditWhatsApp(input: {
  clientId: string;
  action: string;
  meta?: Record<string, unknown>;
}): Promise<AuditEntry> {
  const entry: AuditEntry = {
    id: createId("wa_audit"),
    at: new Date().toISOString(),
    clientId: String(input.clientId || "").trim(),
    action: String(input.action || "").trim(),
    meta: input.meta || undefined,
  };

  const all = await readAll();
  all.push(entry);
  await writeAll(all);
  return entry;
}
