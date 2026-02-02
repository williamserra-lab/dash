export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import { requireAdmin } from "@/lib/adminAuth";
import { runLLMWithUsage, type LLMProvider } from "@/lib/llm";
import { addUsage } from "@/lib/llmBudget";
import { getClientById } from "@/lib/clients";
import { getAdminFileById, readAdminFileBytes, updateAdminFileSummary } from "@/lib/adminFiles";
import { getAdminSummary, hashText, makeSummaryId, upsertAdminSummary, type SummaryPurpose } from "@/lib/adminSummaries";

const PROMPT_VERSION = "v1";
function getAdminActorId(req: NextRequest): string {
  // Admin auth in this project is key-based; we derive a stable-ish actor id from the session cookie timestamp.
  const cookie = req.cookies.get("nextia_admin_session")?.value || "";
  const ts = cookie.split(".", 1)[0] || "";
  const ua = req.headers.get("user-agent") || "";
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
  const base = (ts || "no-session") + "|" + (ip || "no-ip") + "|" + ua.slice(0, 80);
  // lightweight hash
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return `admin_${h.toString(16)}`;
}

async function resolveAdminBilledClientId(targetClientId: string): Promise<string> {
  try {
    const client = await getClientById(targetClientId);
    const charge = Boolean(client?.billing?.chargeAdminTokensToTenant);
    return charge ? targetClientId : "__admin__";
  } catch {
    return "__admin__";
  }
}


function featureEnabled(): boolean {
  return String(process.env.NEXTIA_FEATURE_FILE_SUMMARY || "").trim() === "1";
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asProvider(v: string | null): LLMProvider | null {
  if (!v) return null;
  const x = v.trim();
  return x === "ollama" || x === "openai" || x === "gemini" || x === "groq" ? (x as LLMProvider) : null;
}

function buildPrompt(purpose: SummaryPurpose, text: string): string {
  // For files, keep it generic for now.
  if (purpose === "handoff") {
    return `Você vai gerar um resumo para HANDOFF interno.

Regras:
- português brasileiro
- até 10 tópicos
- destaque fatos, números, decisões e pontos de atenção

TEXTO:
${text}`.trim();
  }

  // review_file
  return `Resuma o conteúdo abaixo em até 10 tópicos claros.
Use português brasileiro.
Foque em:
- ideias principais
- benefícios
- CTAs importantes

TEXTO:
${text}`.trim();
}

function getActorMeta(req: NextRequest): Record<string, unknown> {
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
  const ua = req.headers.get("user-agent") || "";
  const sess = req.cookies.get("nextia_admin_session")?.value || "";
  return {
    ip: String(ip).slice(0, 256),
    userAgent: String(ua).slice(0, 256),
    hasAdminSessionCookie: !!sess,
  };
}

async function readPdfText(fileId: string): Promise<string> {
  const pdfBytes = await readAdminFileBytes(fileId);
  if (!pdfBytes) throw new Error("Arquivo não acessível no storage.");

  const parsed = await pdfParse(pdfBytes);
  const fullText = (parsed.text || "").trim();
  if (!fullText) throw new Error("Texto do PDF não extraído.");

  const maxChars = Number(process.env.NEXTIA_PDF_SUMMARY_MAXCHARS || "8000");
  return fullText.length > maxChars ? fullText.slice(0, maxChars) : fullText;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const denied = await requireAdmin(req);
    if (denied) return denied;

    if (!featureEnabled()) {
      return NextResponse.json({ ok: false, error: "feature_disabled" }, { status: 404 });
    }

    const { fileId: rawId } = await params;
    const fileId = String(rawId || "").trim();
    if (!fileId) {
      return NextResponse.json({ ok: false, error: "Parâmetro fileId não informado." }, { status: 400 });
    }

    const url = new URL(req.url);
    const providerParam = asProvider(url.searchParams.get("provider"));
    const modelParam = url.searchParams.get("model") || "";
    const purposeParam = (url.searchParams.get("purpose") || "review_file").trim();
    const purpose: SummaryPurpose = (purposeParam === "handoff" ? "handoff" : "review_file") as SummaryPurpose;

    const record = await getAdminFileById(fileId);
    if (!record) {
      return NextResponse.json({ ok: false, error: "Arquivo não encontrado." }, { status: 404 });
    }

    // Build a deterministic hash from PDF-extracted text to ensure cache invalidation when file changes.
    const pdfText = await readPdfText(fileId);
    const targetId = `file|${fileId}`;
    const targetHash = hashText(pdfText);

    const cached = await getAdminSummary({
      targetType: "file",
      targetId,
      targetHash,
      purpose,
      provider: providerParam ?? "",
      model: modelParam,
      promptVersion: PROMPT_VERSION,
    });

    if (cached) {
      return NextResponse.json({ ok: true, exists: true, cached: true, summary: cached.summary, createdAt: cached.createdAt }, { status: 200 });
    }

    // Back-compat: if older summary exists on adminFiles record, expose it as cached (but do NOT assume valid if file changed).
    if (record.summary) {
      return NextResponse.json({ ok: true, exists: true, cached: true, summary: record.summary, createdAt: null, legacy: true }, { status: 200 });
    }

    return NextResponse.json({ ok: true, exists: false, cached: false }, { status: 200 });
  } catch (error: unknown) {
    console.error("admin files summarize status error:", error);
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error) || "Erro interno ao resumir." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const denied = await requireAdmin(req);
    if (denied) return denied;

    if (!featureEnabled()) {
      return NextResponse.json({ ok: false, error: "feature_disabled" }, { status: 404 });
    }

    const { fileId: rawId } = await params;
    const fileId = String(rawId || "").trim();
    if (!fileId) {
      return NextResponse.json({ ok: false, error: "Parâmetro fileId não informado." }, { status: 400 });
    }

    const url = new URL(req.url);
    const providerParam = asProvider(url.searchParams.get("provider"));
    const modelParam = url.searchParams.get("model") || "";
    const purposeParam = (url.searchParams.get("purpose") || "review_file").trim();
    const purpose: SummaryPurpose = (purposeParam === "handoff" ? "handoff" : "review_file") as SummaryPurpose;
    const force = String(url.searchParams.get("force") || "").trim() === "1";

    const record = await getAdminFileById(fileId);
    if (!record) {
      return NextResponse.json({ ok: false, error: "Arquivo não encontrado." }, { status: 404 });
    }

    const pdfText = await readPdfText(fileId);
    const targetId = `file|${fileId}`;
    const targetHash = hashText(pdfText);

    const existing = await getAdminSummary({
      targetType: "file",
      targetId,
      targetHash,
      purpose,
      provider: providerParam ?? "",
      model: modelParam,
      promptVersion: PROMPT_VERSION,
    });

    if (existing && !force) {
      return NextResponse.json({ ok: true, cached: true, summary: existing.summary, createdAt: existing.createdAt }, { status: 200 });
    }

    const prompt = buildPrompt(purpose, pdfText);

    const out = await runLLMWithUsage({
      provider: providerParam ?? undefined,
      model: modelParam || undefined,
      prompt,
      temperature: 0.2,
    });


    const targetClientId = (url.searchParams.get("clientId") || "").trim();
    const billedClientId = targetClientId ? await resolveAdminBilledClientId(targetClientId) : "__admin__";
    const actorId = getAdminActorId(req);

    // Track admin usage under a reserved clientId.
    try {
      await addUsage(billedClientId, {
        provider: out.usage.provider ?? (providerParam ?? null),
        model: out.usage.model ?? (modelParam || null),
        promptTokens: out.usage.promptTokens,
        completionTokens: out.usage.completionTokens,
        totalTokens: out.usage.totalTokens,
      }, { context: "admin_file_summary", actorType: "admin", actorId });
    } catch {
      // best-effort
    }

    const id = makeSummaryId({
      targetType: "file",
      targetId,
      targetHash,
      purpose,
      provider: providerParam ?? "",
      model: modelParam,
      promptVersion: PROMPT_VERSION,
    });

    await upsertAdminSummary({
      id,
      targetType: "file",
      targetId,
      targetHash,
      purpose,
      provider: providerParam ?? "",
      model: modelParam,
      promptVersion: PROMPT_VERSION,
      summary: out.text,
      usage: out.usage,
      actorMeta: getActorMeta(req),
    });

    // Keep legacy adminFiles summary for UI compatibility.
    await updateAdminFileSummary(fileId, out.text, {
      provider: providerParam ?? "",
      model: modelParam ?? "",
      promptVersion: PROMPT_VERSION,
      purpose,
      targetHash,
    });

    return NextResponse.json({ ok: true, cached: false, summary: out.text }, { status: 200 });
  } catch (error: unknown) {
    console.error("admin files summarize generate error:", error);
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error) || "Erro interno ao resumir." },
      { status: 500 }
    );
  }
}
