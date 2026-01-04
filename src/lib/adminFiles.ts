import path from "path";
import { promises as fs } from "fs";
import { createHash, randomUUID } from "crypto";
import { dbQuery, isDbEnabled, ensureDbSchema } from "@/lib/db";
import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";
import { enforceStorageLimits } from "@/lib/storageLimits";

export type AdminUploadedFile = {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
  summary?: string | null;
  summaryMeta?: Record<string, unknown> | null;
  summaryUpdatedAt?: string | null;
};

type AdminUploadedFileRow = {
  id: string;
  created_at: string;
  updated_at: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size: number;
  sha256: string;
  storage_path: string;
  summary: string | null;
  summary_meta: Record<string, unknown> | null;
  summary_updated_at: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __nextiaFilesInit: Promise<void> | undefined;
}

const uploadDir = (process.env.NEXTIA_UPLOADS_DIR || "").trim()
  ? String(process.env.NEXTIA_UPLOADS_DIR).trim()
  : path.join(process.cwd(), "uploads");

export function getAdminUploadsDir(): string {
  return uploadDir;
}

const jsonPath = getDataPath("admin_files.json");

function safeName(name: string): string {
  const base = (name || "arquivo.pdf").trim() || "arquivo.pdf";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function fileId(): string {
  try {
    return "file_" + randomUUID().replace(/-/g, "");
  } catch {
    return "file_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }
}

async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(uploadDir, { recursive: true });
}

async function ensureFilesSchema(): Promise<void> {
  // Schema is managed by db migrations (db/migrations/*.sql).
  // Keep this wrapper for backward compatibility.
  return ensureDbSchema();
}

function toPublic(row: AdminUploadedFileRow): AdminUploadedFile {
  return {
    id: row.id,
    originalName: row.original_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    size: Number(row.size || 0),
    sha256: row.sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: row.summary,
    summaryMeta: row.summary_meta,
    summaryUpdatedAt: row.summary_updated_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function listAdminFiles(limit = 200): Promise<AdminUploadedFile[]> {
  if (isDbEnabled()) {
    await ensureFilesSchema();
    const res = await dbQuery<AdminUploadedFileRow>(
      `
      SELECT id, created_at, updated_at, original_name, stored_name, mime_type, size, sha256, storage_path,
             summary, summary_meta, summary_updated_at
      FROM nextia_files
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [limit]
    );
    return res.rows.map(toPublic);
  }

  const data = await readJsonArray<AdminUploadedFile>(jsonPath);
  const sorted = [...data].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return sorted.slice(0, limit);
}

export async function getAdminFileById(id: string): Promise<AdminUploadedFile | null> {
  const fileIdNorm = String(id || "").trim();
  if (!fileIdNorm) return null;

  if (isDbEnabled()) {
    await ensureFilesSchema();
    const res = await dbQuery<AdminUploadedFileRow>(
      `
      SELECT id, created_at, updated_at, original_name, stored_name, mime_type, size, sha256, storage_path,
             summary, summary_meta, summary_updated_at
      FROM nextia_files
      WHERE id = $1
      LIMIT 1
      `,
      [fileIdNorm]
    );
    if (!res.rows[0]) return null;
    return toPublic(res.rows[0]);
  }

  const data = await readJsonArray<AdminUploadedFile>(jsonPath);
  return data.find((x) => x.id === fileIdNorm) || null;
}

export async function readAdminFileBytes(id: string): Promise<Uint8Array | null> {
  const rec = await getAdminFileById(id);
  if (!rec) return null;

  const filePath = path.join(uploadDir, rec.storedName);

  try {
    const buffer = await fs.readFile(filePath);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch {
    return null;
  }
}

export async function saveAdminUpload(file: File): Promise<AdminUploadedFile> {
  await ensureUploadDir();

  const originalName = safeName(file.name || "arquivo.pdf");
  const mimeType = String(file.type || "application/octet-stream");
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Limites universais: 10MB por arquivo, 100MB total (escopo global de admin uploads).
  await enforceStorageLimits({
    scope: "global",
    scopeLabel: "admin",
    scopeDir: uploadDir,
    incomingBytes: buffer.length,
  });

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const id = fileId();
  const storedName = `${id}-${originalName}`;
  const filePath = path.join(uploadDir, storedName);

  await fs.writeFile(filePath, buffer);

  const createdAt = nowIso();
  const updatedAt = createdAt;

  const record: AdminUploadedFile = {
    id,
    originalName,
    storedName,
    mimeType,
    size: buffer.length,
    sha256,
    createdAt,
    updatedAt,
    summary: null,
    summaryMeta: null,
    summaryUpdatedAt: null,
  };

  if (isDbEnabled()) {
    await ensureFilesSchema();
    await dbQuery(
      `
      INSERT INTO nextia_files (
        id, created_at, updated_at, original_name, stored_name, mime_type, size, sha256, storage_path,
        summary, summary_meta, summary_updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12
      )
      `,
      [
        id,
        createdAt,
        updatedAt,
        record.originalName,
        record.storedName,
        record.mimeType,
        record.size,
        record.sha256,
        filePath,
        null,
        null,
        null,
      ]
    );
    return record;
  }

  const data = await readJsonArray<AdminUploadedFile>(jsonPath);
  data.push(record);
  await writeJsonArray(jsonPath, data);
  return record;
}

export async function updateAdminFileSummary(
  id: string,
  summary: string,
  summaryMeta: Record<string, unknown>
): Promise<void> {
  const fileIdNorm = String(id || "").trim();
  if (!fileIdNorm) return;

  if (isDbEnabled()) {
    await ensureFilesSchema();
    await dbQuery(
      `
      UPDATE nextia_files
      SET summary = $2,
          summary_meta = $3,
          summary_updated_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      `,
      [fileIdNorm, summary, summaryMeta]
    );
    return;
  }

  const data = await readJsonArray<AdminUploadedFile>(jsonPath);
  const idx = data.findIndex((x) => x.id === fileIdNorm);
  if (idx >= 0) {
    data[idx] = {
      ...data[idx],
      summary,
      summaryMeta,
      summaryUpdatedAt: nowIso(),
      updatedAt: nowIso(),
    };
    await writeJsonArray(jsonPath, data);
  }
}
