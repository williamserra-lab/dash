// src/lib/adminSummaries.ts
// Summary cache store for admin tools (conversation/file summaries).
// Primary: Postgres when enabled (nextia_admin_summaries). Fallback: JSON file.

import crypto from "crypto";
import { dbQuery, isDbEnabled } from "./db";
import { getDataPath, readJsonArray, writeJsonArray } from "./jsonStore";

export type SummaryTargetType = "conversation" | "file";
export type SummaryPurpose = "handoff" | "review_chat" | "review_file";

export type AdminSummaryRecord = {
  id: string;
  targetType: SummaryTargetType;
  targetId: string;
  targetHash: string;
  purpose: SummaryPurpose;
  provider: string;
  model: string;
  promptVersion: string;
  summary: string;
  usage: unknown | null;
  actorMeta: Record<string, unknown> | null;
  createdAt: string;
};

const FILE = getDataPath("admin_summaries.json");

function sha1(v: string): string {
  return crypto.createHash("sha1").update(v).digest("hex");
}

export function makeSummaryId(parts: {
  targetType: SummaryTargetType;
  targetId: string;
  targetHash: string;
  purpose: SummaryPurpose;
  provider: string;
  model: string;
  promptVersion: string;
}): string {
  return sha1(
    [
      parts.targetType,
      parts.targetId,
      parts.targetHash,
      parts.purpose,
      parts.provider || "",
      parts.model || "",
      parts.promptVersion || "v1",
    ].join("|")
  );
}

export async function getAdminSummary(params: {
  targetType: SummaryTargetType;
  targetId: string;
  targetHash: string;
  purpose: SummaryPurpose;
  provider?: string;
  model?: string;
  promptVersion?: string;
}): Promise<AdminSummaryRecord | null> {
  const provider = (params.provider || "").trim();
  const model = (params.model || "").trim();
  const promptVersion = (params.promptVersion || "v1").trim() || "v1";

  if (isDbEnabled()) {
    const res = await dbQuery<any>(
      `
      SELECT id, target_type, target_id, target_hash, purpose, provider, model, prompt_version, summary, usage, actor_meta, created_at
      FROM nextia_admin_summaries
      WHERE target_type=$1 AND target_id=$2 AND target_hash=$3 AND purpose=$4 AND provider=$5 AND model=$6 AND prompt_version=$7
      ORDER BY created_at DESC
      LIMIT 1;
      `,
      [params.targetType, params.targetId, params.targetHash, params.purpose, provider, model, promptVersion]
    );

    const r = res.rows?.[0];
    if (!r) return null;

    return {
      id: String(r.id),
      targetType: String(r.target_type) as SummaryTargetType,
      targetId: String(r.target_id),
      targetHash: String(r.target_hash),
      purpose: String(r.purpose) as SummaryPurpose,
      provider: String(r.provider || ""),
      model: String(r.model || ""),
      promptVersion: String(r.prompt_version || "v1"),
      summary: String(r.summary || ""),
      usage: r.usage ?? null,
      actorMeta: (r.actor_meta ?? null) as any,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  const list = await readJsonArray<AdminSummaryRecord>(FILE);
  const found = list
    .filter((x) => x && typeof x === "object")
    .filter(
      (x: any) =>
        x.targetType === params.targetType &&
        x.targetId === params.targetId &&
        x.targetHash === params.targetHash &&
        x.purpose === params.purpose &&
        String(x.provider || "") === provider &&
        String(x.model || "") === model &&
        String(x.promptVersion || "v1") === promptVersion
    )
    .sort((a: any, b: any) => (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0));

  return found[0] || null;
}

export async function upsertAdminSummary(input: Omit<AdminSummaryRecord, "createdAt">): Promise<void> {
  const createdAt = new Date().toISOString();

  if (isDbEnabled()) {
    await dbQuery(
      `
      INSERT INTO nextia_admin_summaries
        (id, target_type, target_id, target_hash, purpose, provider, model, prompt_version, summary, usage, actor_meta)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
      ON CONFLICT (id) DO UPDATE
        SET summary = EXCLUDED.summary,
            usage = EXCLUDED.usage,
            actor_meta = EXCLUDED.actor_meta,
            created_at = NOW();
      `,
      [
        input.id,
        input.targetType,
        input.targetId,
        input.targetHash,
        input.purpose,
        input.provider || "",
        input.model || "",
        input.promptVersion || "v1",
        input.summary,
        JSON.stringify(input.usage ?? null),
        JSON.stringify(input.actorMeta ?? null),
      ]
    );
    return;
  }

  const list = await readJsonArray<AdminSummaryRecord>(FILE);
  const idx = list.findIndex((x: any) => x && typeof x === "object" && x.id === input.id);
  const record: AdminSummaryRecord = { ...input, createdAt };
  if (idx >= 0) list[idx] = record;
  else list.push(record);

  // Bound file size (best-effort)
  const MAX = 5000;
  if (list.length > MAX) list.splice(0, list.length - MAX);

  await writeJsonArray(FILE, list);
}

export function hashText(v: string): string {
  return sha1(v);
}
