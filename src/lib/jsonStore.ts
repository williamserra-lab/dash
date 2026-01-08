// src/lib/jsonStore.ts
// Camada única para leitura/escrita segura de arquivos JSON em disco.

import { promises as fs } from "fs";
import path from "path";

const dataDir = path.join(process.cwd(), "data");

async function ensureDataDirExists() {
  // Garante que a pasta /data exista
  await fs.mkdir(dataDir, { recursive: true });
}

/**
 * Retorna o caminho absoluto para um arquivo dentro de /data.
 * Ex.: getDataPath("contacts.json")
 */
export function getDataPath(fileName: string): string {
  return path.join(dataDir, fileName);
}

/**
 * Lê um arquivo JSON cuja raiz é um ARRAY.
 *
 * - Se o arquivo não existir: cria com [] e retorna [].
 * - Se o arquivo estiver vazio: grava [] e retorna [].
 * - Se o JSON estiver corrompido: renomeia para .corrupted-*.bak, recria como []
 *   e retorna [].
 */
export async function readJsonArray<T>(filePath: string): Promise<T[]> {
  await ensureDataDirExists();

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const trimmed = raw.trim();

    if (!trimmed) {
      // Arquivo vazio: normaliza para []
      await fs.writeFile(filePath, "[]", "utf-8");
      return [];
    }

    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON root is not an array");
    }

    return parsed as T[];
  } catch (err: unknown) {
    // Arquivo não existe: cria e segue
    const code =
      err && typeof err === "object" && "code" in (err as Record<string, unknown>)
        ? (err as Record<string, unknown>).code
        : undefined;
    if (code === "ENOENT") {
      await fs.writeFile(filePath, "[]", "utf-8");
      return [];
    }

    // Qualquer outro erro de leitura / parse -> tratamos como corrupção
    try {
      const backupPath =
        filePath +
        ".corrupted-" +
        new Date().toISOString().replace(/[:.]/g, "-") +
        ".bak";
      await fs.rename(filePath, backupPath);
      // se der erro ao renomear, ignoramos – é best-effort
    } catch {
      // ignore
    }

    // Recomeça arquivo "zerado"
    await fs.writeFile(filePath, "[]", "utf-8");
    return [];
  }
}

/**
 * Lê um arquivo JSON genérico (objeto, número, string, etc).
 *
 */
export async function readJsonValue<T>(filePath: string): Promise<T | undefined>;
export async function readJsonValue<T>(filePath: string, defaultValue: T): Promise<T>;
export async function readJsonValue<T>(
  filePath: string,
  defaultValue?: T
): Promise<T | undefined> {
  await ensureDataDirExists();

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const trimmed = raw.trim();

    if (!trimmed) {
      if (defaultValue === undefined) return undefined;
      await fs.writeFile(
        filePath,
        JSON.stringify(defaultValue, null, 2),
        "utf-8"
      );
      return defaultValue;
    }

    const parsed = JSON.parse(trimmed) as T;
    return parsed;
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in (err as Record<string, unknown>)
        ? (err as Record<string, unknown>).code
        : undefined;
    if (code === "ENOENT") {
      if (defaultValue === undefined) return undefined;
      await fs.writeFile(
        filePath,
        JSON.stringify(defaultValue, null, 2),
        "utf-8"
      );
      return defaultValue;
    }

    try {
      const backupPath =
        filePath +
        ".corrupted-" +
        new Date().toISOString().replace(/[:.]/g, "-") +
        ".bak";
      await fs.rename(filePath, backupPath);
    } catch {
      // ignore
    }

    await fs.writeFile(
      filePath,
      JSON.stringify(defaultValue, null, 2),
      "utf-8"
    );
    return defaultValue;
  }
}

/**
 * Escreve um ARRAY em arquivo JSON de forma segura.
 *
 * - Escreve primeiro em arquivo temporário (.tmp).
 * - Depois faz rename atômico para o arquivo final.
 */
export async function writeJsonArray<T>(
  filePath: string,
  data: T[]
): Promise<void> {
  await ensureDataDirExists();

  const tmpPath = filePath + ".tmp";
  const payload = JSON.stringify(data, null, 2);

  await fs.writeFile(tmpPath, payload, "utf-8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Escreve um valor genérico (objeto, número, string, etc) em JSON de forma segura.
 */
export async function writeJsonValue<T>(
  filePath: string,
  value: T
): Promise<void> {
  await ensureDataDirExists();

  const tmpPath = filePath + ".tmp";
  const payload = JSON.stringify(value, null, 2);

  await fs.writeFile(tmpPath, payload, "utf-8");
  await fs.rename(tmpPath, filePath);
}
