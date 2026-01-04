/**
 * scripts/runWhatsappOutbox.ts
 *
 * Runner CLI para processar data/whatsapp_outbox.json.
 * Uso:
 *   npm run outbox:run -- --clientId catia_foods --limit 50 --dryRun false
 *   npx tsx scripts/runWhatsappOutbox.ts --clientId catia_foods --limit 50 --dryRun false
 */
import { runWhatsappOutbox } from "../src/lib/whatsappOutboxRunner";

type ArgMap = Record<string, string | boolean>;

function parseArgs(argv: string[]): ArgMap {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function toBool(v: unknown, def: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return def;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return def;
}

function toInt(v: unknown, def: number): number {
  if (typeof v !== "string") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientId = typeof args.clientId === "string" ? args.clientId : undefined;
  const limit = toInt(args.limit, 100);
  const dryRun = toBool(args.dryRun, true);

  const res = await runWhatsappOutbox({ clientId, limit, dryRun });

  // saída curta e útil para operação
  console.log(JSON.stringify(res, null, 2));

  // exit code pragmático: falha se runner sinalizar ok=false
  process.exit(res.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("Falha ao rodar whatsapp outbox:", err?.message || err);
  process.exit(1);
});
