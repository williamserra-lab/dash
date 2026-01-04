// src/lib/migrations.ts
// Lightweight SQL migrations runner (no Prisma/Drizzle).
// Applies *.sql files in db/migrations in lexicographic order.
//
// Design goals:
// - Build-safe (no toolchain)
// - Deterministic and auditable (nextia_migrations table with checksums)
// - Idempotent when migrations are written with IF NOT EXISTS

import path from "path";
import { promises as fs } from "fs";
import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pool = any;

type AppliedRow = { name: string; checksum: string };

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function defaultMigrationsDir(): string {
  return path.join(process.cwd(), "db", "migrations");
}

export async function applyMigrations(pool: Pool, migrationsDir?: string): Promise<void> {
  const dir = (migrationsDir || "").trim() ? String(migrationsDir).trim() : defaultMigrationsDir();

  // Migration ledger (idempotent)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nextia_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedRes = await pool.query(`SELECT name, checksum FROM nextia_migrations ORDER BY name ASC;`);
  const applied = new Map<string, string>(
    (appliedRes?.rows || []).map((r: AppliedRow) => [String(r.name), String(r.checksum)])
  );

  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    // No migrations directory (dev), nothing to do.
    return;
  }

  const sqlFiles = files
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of sqlFiles) {
    const fullPath = path.join(dir, fileName);
    const sql = await fs.readFile(fullPath, "utf8");
    const checksum = sha256(sql);

    const prior = applied.get(fileName);
    if (prior) {
      if (prior !== checksum) {
        throw new Error(
          `Migration checksum mismatch for ${fileName}. Applied=${prior} Current=${checksum}. ` +
            `Do not edit applied migrations; create a new migration instead.`
        );
      }
      continue;
    }

    await pool.query("BEGIN");
    try {
      // Multi-statement SQL is allowed by pg for simple query strings.
      await pool.query(sql);
      await pool.query(`INSERT INTO nextia_migrations (name, checksum) VALUES ($1, $2);`, [fileName, checksum]);
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  }
}
