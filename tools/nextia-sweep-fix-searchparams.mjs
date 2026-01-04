#!/usr/bin/env node
// nextia-sweep-fix-searchparams.mjs
//
// Sweeps src/app/**/page.tsx files that use `useSearchParams` and rewrites each as:
// - page.tsx (Server Component wrapper with <Suspense>)
// - page.client.tsx (original content, forced to include "use client")
//
// Safety:
// - Creates .bak backups when --apply is used.
// - Skips pages that export segment config/metadata/etc (dynamic/revalidate/runtime/generateMetadata...).

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const mode = args.has("--apply") ? "apply" : "dry-run";

const cwd = process.cwd();
const appDir = path.join(cwd, "src", "app");

const SKIP_EXPORT_PATTERNS = [
  /export\s+const\s+dynamic\s*=/,
  /export\s+const\s+revalidate\s*=/,
  /export\s+const\s+runtime\s*=/,
  /export\s+const\s+preferredRegion\s*=/,
  /export\s+const\s+fetchCache\s*=/,
  /export\s+const\s+maxDuration\s*=/,
  /export\s+const\s+metadata\s*=/,
  /export\s+async\s+function\s+generateMetadata\s*\(/,
  /export\s+function\s+generateStaticParams\s*\(/,
];

function usesSearchParams(source) {
  return source.includes("useSearchParams");
}

function shouldSkip(source) {
  return SKIP_EXPORT_PATTERNS.some((rx) => rx.test(source));
}

async function* walk(dir) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function ensureUseClient(source) {
  const trimmed = source.trimStart();
  if (trimmed.startsWith('"use client"') || trimmed.startsWith("'use client'")) return source;
  return `"use client";\n\n${source}`;
}

function wrapperSource() {
  return `import { Suspense } from "react";\nimport PageClient from "./page.client";\n\nexport default function Page() {\n  return (\n    <Suspense fallback={null}>\n      <PageClient />\n    </Suspense>\n  );\n}\n`;
}

async function main() {
  const result = {
    mode,
    scanned: 0,
    changed: 0,
    skipped: 0,
    skippedFiles: [],
    changedFiles: [],
  };

  if (!fs.existsSync(appDir)) {
    console.error(JSON.stringify({ error: "src/app not found", appDir }, null, 2));
    process.exit(1);
  }

  for await (const file of walk(appDir)) {
    if (!file.endsWith(path.join(path.sep, "page.tsx"))) continue;
    result.scanned += 1;

    const src = await fsp.readFile(file, "utf8");

    if (!usesSearchParams(src)) continue;

    if (shouldSkip(src)) {
      result.skipped += 1;
      result.skippedFiles.push(path.relative(cwd, file));
      continue;
    }

    const dir = path.dirname(file);
    const clientFile = path.join(dir, "page.client.tsx");

    result.changed += 1;
    result.changedFiles.push(path.relative(cwd, file));

    if (mode === "apply") {
      await fsp.writeFile(`${file}.bak`, src, "utf8");
      if (fs.existsSync(clientFile)) {
        const existingClient = await fsp.readFile(clientFile, "utf8");
        await fsp.writeFile(`${clientFile}.bak`, existingClient, "utf8");
      }

      await fsp.writeFile(clientFile, ensureUseClient(src), "utf8");
      await fsp.writeFile(file, wrapperSource(), "utf8");
    }
  }

  console.log(JSON.stringify(result, null, 2));
  if (mode === "dry-run") {
    console.log("\nRun with --apply to write changes (backups created as .bak).");
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err?.message ?? err) }, null, 2));
  process.exit(1);
});
