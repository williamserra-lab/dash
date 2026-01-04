#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

/*
Nextia SWEEP FIX (Analytics Events)

Fixes TypeScript mismatches for AnalyticsEvent payload shape:
- at:        -> createdAt:
- data: {...} -> payload: {...}

Scope is intentionally conservative:
- Only touches files that contain "logAnalyticsEvent(".
- Only replaces object keys "at:" and "data:" (with whitespace) line-based.

Usage:
  node tools/nextia-sweep-fix-analytics-events.mjs --dry-run
  node tools/nextia-sweep-fix-analytics-events.mjs --apply
*/

const PROJECT_ROOT = process.cwd();
const SRC_DIR = path.join(PROJECT_ROOT, "src");

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const DRY_RUN = args.has("--dry-run") || !APPLY;

async function walk(dir){
  let out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries){
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out = out.concat(await walk(full));
    else out.push(full);
  }
  return out;
}

function isTs(p){
  return p.endsWith(".ts") || p.endsWith(".tsx");
}

function applyFixes(text){
  if (!text.includes("logAnalyticsEvent(")) return text;

  // Line-based replacements (object keys)
  // at: -> createdAt:
  let t = text.replace(/^(\s*)at\s*:/gm, "$1createdAt:");
  // data: -> payload:
  t = t.replace(/^(\s*)data\s*:/gm, "$1payload:");

  return t;
}

async function main(){
  const files = (await walk(SRC_DIR)).filter(isTs);
  const changedFiles = [];

  for (const file of files){
    const original = await fs.readFile(file, "utf8");
    const updated = applyFixes(original);
    if (updated !== original){
      changedFiles.push(file);
      if (APPLY){
        await fs.writeFile(`${file}.bak`, original, "utf8");
        await fs.writeFile(file, updated, "utf8");
      }
    }
  }

  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    scanned: files.length,
    changed: changedFiles.length,
    changedFiles: changedFiles.map(p => path.relative(PROJECT_ROOT, p)),
  }, null, 2));

  if (DRY_RUN && changedFiles.length){
    console.log("\nRun with --apply to write changes (backups created as .bak).");
  }
}

main().catch((err)=>{ console.error(err); process.exit(1); });
