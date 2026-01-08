// src/app/api/admin/chat/summary/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listStoredMessages } from "@/lib/nextiaMessageStore";
import { getAdminSummary, hashText, makeSummaryId, upsertAdminSummary, type SummaryPurpose } from "@/lib/adminSummaries";
import { runLLMWithUsage, type LLMProvider } from "@/lib/llm";
import { addUsage } from "@/lib/llmBudget";
import { getClientById } from "@/lib/clients";

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


const QuerySchema = z.object({
  clientId: z.string().min(1),
  instance: z.string().min(1),
  remoteJid: z.string().min(1),
  purpose: z.enum(["handoff", "review_chat"]).optional(),
  provider: z.enum(["ollama", "openai", "gemini", "groq"]).optional(),
  model: z.string().optional(),
});

const BodySchema = z.object({
  force: z.boolean().optional(),
  purpose: z.enum(["handoff", "review_chat"]).optional(),
  provider: z.enum(["ollama", "openai", "gemini", "groq"]).optional(),
  model: z.string().optional(),
});

function featureEnabled(): boolean {
  return String(process.env.NEXTIA_FEATURE_CHAT_SUMMARY || "").trim() === "1";
}

function buildPrompt(purpose: SummaryPurpose, transcript: string): string {
  if (purpose === "handoff") {
    return `Você vai gerar um RESUMO DE HANDOFF para um atendente humano assumir uma conversa de WhatsApp.

Objetivo:
- dar contexto mínimo para continuar o atendimento
- destacar pendências, dúvidas do cliente e próximos passos
- citar dados importantes (produto, quantidade, endereço, pagamento) se existirem

Formato:
1) Contexto (1-2 linhas)
2) O que o cliente quer
3) O que já foi respondido/feito
4) Pendências / perguntas em aberto
5) Próximo passo recomendado

Conversa:
${transcript}`.trim();
  }

  // review_chat
  return `Resuma a conversa abaixo para entendimento rápido do que aconteceu.

Regras:
- português brasileiro
- máximo 12 tópicos
- destaque decisões, mudanças de rumo, erros e pontos críticos

Conversa:
${transcript}`.trim();
}

function normalizeLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

async function buildTranscript(params: { clientId: string; instance: string; remoteJid: string }): Promise<string> {
  const msgs = await listStoredMessages({ ...params, limit: 200 });
  // listStoredMessages returns newest-first; we want chronological.
  const ordered = [...msgs].sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));

  const lines: string[] = [];
  for (const m of ordered) {
    const who = m.fromMe ? "LOJISTA" : "CLIENTE";
    const text = normalizeLine(String(m.text || ""));
    if (!text) continue;
    lines.push(`${who}: ${text}`);
  }

  const transcript = lines.join("\n").trim();
  // Guardrail: cap transcript size
  const maxChars = Number(process.env.NEXTIA_CHAT_SUMMARY_MAXCHARS || "12000");
  return transcript.length > maxChars ? transcript.slice(0, maxChars) : transcript;
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

export async function GET(req: NextRequest) {
  try {
    if (!featureEnabled()) {
      return NextResponse.json({ ok: false, error: "feature_disabled" }, { status: 404 });
    }

    const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Query inválida.", details: parsed.error.format() }, { status: 400 });
    }

    const purpose: SummaryPurpose = (parsed.data.purpose || "handoff") as SummaryPurpose;
    const provider = (parsed.data.provider || "").trim();
    const model = (parsed.data.model || "").trim();

    const transcript = await buildTranscript(parsed.data);
    if (!transcript) {
      return NextResponse.json({ ok: false, error: "Sem mensagens suficientes para resumir." }, { status: 400 });
    }

    const targetId = `${parsed.data.clientId}|${parsed.data.instance}|${parsed.data.remoteJid}`;
    const targetHash = hashText(transcript);

    const cached = await getAdminSummary({
      targetType: "conversation",
      targetId,
      targetHash,
      purpose,
      provider,
      model,
      promptVersion: PROMPT_VERSION,
    });

    if (!cached) {
      return NextResponse.json({ ok: true, exists: false, cached: false }, { status: 200 });
    }

    return NextResponse.json(
      {
        ok: true,
        exists: true,
        cached: true,
        summary: cached.summary,
        createdAt: cached.createdAt,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Erro interno.", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!featureEnabled()) {
      return NextResponse.json({ ok: false, error: "feature_disabled" }, { status: 404 });
    }

    const q = QuerySchema.pick({ clientId: true, instance: true, remoteJid: true }).safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    if (!q.success) {
      return NextResponse.json({ ok: false, error: "Query inválida.", details: q.error.format() }, { status: 400 });
    }

    const bodyRaw = await req.text();
    let bodyJson: unknown = {};
    if (bodyRaw) {
      try {
        bodyJson = JSON.parse(bodyRaw);
      } catch {
        bodyJson = {};
      }
    }
    const body = BodySchema.safeParse(bodyJson);
    if (!body.success) {
      return NextResponse.json({ ok: false, error: "Body inválido.", details: body.error.format() }, { status: 400 });
    }

    const purpose: SummaryPurpose = (body.data.purpose || "handoff") as SummaryPurpose;
    const provider = (body.data.provider || "").trim();
    const model = (body.data.model || "").trim();
    const force = body.data.force === true;

    const transcript = await buildTranscript(q.data);
    if (!transcript) {
      return NextResponse.json({ ok: false, error: "Sem mensagens suficientes para resumir." }, { status: 400 });
    }

    const targetId = `${q.data.clientId}|${q.data.instance}|${q.data.remoteJid}`;
    const targetHash = hashText(transcript);

    const existing = await getAdminSummary({
      targetType: "conversation",
      targetId,
      targetHash,
      purpose,
      provider,
      model,
      promptVersion: PROMPT_VERSION,
    });

    if (existing && !force) {
      return NextResponse.json({ ok: true, cached: true, summary: existing.summary, createdAt: existing.createdAt }, { status: 200 });
    }

    const prompt = buildPrompt(purpose, transcript);

    const out = await runLLMWithUsage({
      provider: (provider || undefined) as LLMProvider | undefined,
      model: model || undefined,
      prompt,
      temperature: 0.2,
    });

    const billedClientId = await resolveAdminBilledClientId(q.data.clientId);
    const actorId = getAdminActorId(req);

    // Track admin usage under a reserved clientId.
    try {
      await addUsage(billedClientId, {
        provider: out.usage.provider ?? (provider || null),
        model: out.usage.model ?? (model || null),
        promptTokens: out.usage.promptTokens,
        completionTokens: out.usage.completionTokens,
        totalTokens: out.usage.totalTokens,
      }, { context: "admin_chat_summary", actorType: "admin", actorId });
    } catch {
      // best-effort
    }

    const id = makeSummaryId({
      targetType: "conversation",
      targetId,
      targetHash,
      purpose,
      provider,
      model,
      promptVersion: PROMPT_VERSION,
    });

    await upsertAdminSummary({
      id,
      targetType: "conversation",
      targetId,
      targetHash,
      purpose,
      provider,
      model,
      promptVersion: PROMPT_VERSION,
      summary: out.text,
      usage: out.usage,
      actorMeta: getActorMeta(req),
    });

    return NextResponse.json({ ok: true, cached: false, summary: out.text }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Erro interno.", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
