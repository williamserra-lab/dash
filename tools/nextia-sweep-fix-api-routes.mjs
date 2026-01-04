#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

/*
Nextia SWEEP FIX (API Routes) - Next.js 16 expects context.params as Promise<...>

Usage:
  node tools/nextia-sweep-fix-api-routes.mjs --dry-run
  node tools/nextia-sweep-fix-api-routes.mjs --apply
*/

const PROJECT_ROOT = process.cwd();
const API_DIR = path.join(PROJECT_ROOT, "src", "app", "api");
const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const DRY_RUN = args.has("--dry-run") || !APPLY;

function isRouteTs(p){ return p.endsWith(`${path.sep}route.ts`); }

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

function applyFixes(text){
  let t = text;

  // RouteContext.params: { ... } -> Promise<{ ... }>
  t = t.replace(
    /type\s+RouteContext\s*=\s*\{\s*params:\s*\{([\s\S]*?)\}\s*;?\s*\};/g,
    (_m, inner) => `type RouteContext = {\n  params: Promise<{${inner}}>;\n};`
  );

  // ctx/context: { params: { ... } } -> Promise<{...}>
  t = t.replace(
    /(ctx|context)\s*:\s*\{\s*params:\s*\{\s*([\s\S]*?)\s*\}\s*\}/g,
    (_m, name, inner) => `${name}: { params: Promise<{ ${inner.trim()} }> }`
  );

  // Fix common syntax regression: Promise<{ ... }; -> Promise<{ ... }>;
  t = t.replace(/Promise<\s*\{([\s\S]*?)\}\s*;/g, (_m, inner) => `Promise<{${inner}}>;`);

  // Fix missing '>' in ctx/context Promise types: Promise<{...} } -> Promise<{...}> }
  t = t.replace(/params:\s*Promise<\{([\s\S]*?)\}\s*\}/g, (_m, inner) => `params: Promise<{${inner}}> }`);

  // Param extraction: const { ... } = ctx.params; -> await ctx.params
  t = t.replace(
    /const\s*\{\s*([^}]+?)\s*\}\s*=\s*(ctx|context)\.params\s*;/g,
    (_m, fields, name) => `const { ${fields.trim()} } = await ${name}.params;`
  );

  return t;
}

async function main(){
  const files = (await walk(API_DIR)).filter(isRouteTs);
  if (files.length === 0){
    console.log("No route.ts files found under src/app/api.");
    return;
  }

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
  if (DRY_RUN && changedFiles.length) console.log("\nRun with --apply to write changes (backups created as .bak).");
}

main().catch((err)=>{ console.error(err); process.exit(1); });
