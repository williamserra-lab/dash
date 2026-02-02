// src/lib/storageLimits.ts
// Limites universais de armazenamento (por requisito do projeto):
// - 10 MB por arquivo
// - 100 MB de total por escopo (cliente ou global), somando tudo que já existe.
//
// Observação: mantemos valores configuráveis por env para dev/ops, mas os defaults
// obedecem aos limites universais.

import fs from "fs/promises";
import path from "path";

export const DEFAULT_MAX_FILE_MB = 10;
export const DEFAULT_MAX_TOTAL_MB = 100;

// Defaults do catalog (sub-quota interna do total do cliente)
export const DEFAULT_CATALOG_TOTAL_PERCENT = 20;
export const DEFAULT_MAX_CATALOG_FILE_MB = 2;

export type StorageScope = "client" | "global" | "catalog";

export class StorageLimitError extends Error {
  code: "file_too_large" | "storage_quota_exceeded";
  details?: Record<string, unknown>;
  constructor(
    code: StorageLimitError["code"],
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "StorageLimitError";
    this.code = code;
    this.details = details;
  }
}

function envNumber(name: string, fallback: number): number {
  const raw = (process.env[name] || "").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getMaxFileBytes(): number {
  // Preferência por nomes explícitos do projeto.
  const mb = envNumber("NEXTIA_MAX_FILE_MB", DEFAULT_MAX_FILE_MB);
  // Compat: nomes antigos já presentes no projeto.
  const compat = envNumber("MAX_MEDIA_FILE_MB", mb);
  return compat * 1024 * 1024;
}

export function getMaxTotalBytes(): number {
  const mb = envNumber("NEXTIA_MAX_TOTAL_MB", DEFAULT_MAX_TOTAL_MB);
  const compat = envNumber("MAX_MEDIA_TOTAL_MB", mb);
  return compat * 1024 * 1024;
}


export function getCatalogTotalPercent(): number {
  const p = envNumber("NEXTIA_CATALOG_TOTAL_PERCENT", DEFAULT_CATALOG_TOTAL_PERCENT);
  const compat = envNumber("CATALOG_TOTAL_PERCENT", p);
  // manter entre 1 e 100
  return Math.min(100, Math.max(1, compat));
}

export function getCatalogMaxFileBytes(): number {
  const mb = envNumber("NEXTIA_MAX_CATALOG_FILE_MB", DEFAULT_MAX_CATALOG_FILE_MB);
  const compat = envNumber("MAX_CATALOG_FILE_MB", mb);
  return compat * 1024 * 1024;
}

export function getCatalogMaxTotalBytes(): number {
  const total = getMaxTotalBytes();
  const percent = getCatalogTotalPercent();
  return Math.floor((total * percent) / 100);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function getDirectorySizeBytes(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const stat = await fs.stat(path.join(dir, entry.name));
      total += stat.size;
    }
    return total;
  } catch (err: unknown) {
    // Pasta inexistente => 0
    if (typeof err === "object" && err && "code" in err && (err as any).code === "ENOENT") {
      return 0;
    }
    throw err;
  }
}

export function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export async function enforceStorageLimits(params: {
  scope: StorageScope;
  scopeLabel: string; // ex: clientId, "admin"
  scopeDir: string;
  incomingBytes: number;
  // Overrides opcionais (ex.: catalog scope)
  maxFileBytes?: number;
  maxTotalBytes?: number;
}): Promise<{ usedBefore: number; usedAfter: number; maxFileBytes: number; maxTotalBytes: number }> {
  const maxFileBytes = params.maxFileBytes ?? getMaxFileBytes();
  const maxTotalBytes = params.maxTotalBytes ?? getMaxTotalBytes();

  if (params.incomingBytes > maxFileBytes) {
    throw new StorageLimitError(
      "file_too_large",
      `Arquivo muito grande. Limite máximo por arquivo: ${formatMb(maxFileBytes)} MB.`,
      {
        scope: params.scope,
        scopeLabel: params.scopeLabel,
        incomingBytes: params.incomingBytes,
        maxFileBytes,
      }
    );
  }

  const usedBefore = await getDirectorySizeBytes(params.scopeDir);
  const usedAfter = usedBefore + params.incomingBytes;
  if (usedAfter > maxTotalBytes) {
    throw new StorageLimitError(
      "storage_quota_exceeded",
      `Limite total de armazenamento excedido. Uso atual: ${formatMb(usedBefore)} MB de ${formatMb(
        maxTotalBytes
      )} MB.`,
      {
        scope: params.scope,
        scopeLabel: params.scopeLabel,
        usedBefore,
        usedAfter,
        maxTotalBytes,
      }
    );
  }

  return { usedBefore, usedAfter, maxFileBytes, maxTotalBytes };
}
