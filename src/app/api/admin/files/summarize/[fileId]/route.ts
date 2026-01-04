export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import { runLLM, type LLMProvider } from "@/lib/llm";
import { getAdminFileById, readAdminFileBytes, updateAdminFileSummary } from "@/lib/adminFiles";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asProvider(v: string | null): LLMProvider | null {
  if (!v) return null;
  const x = v.trim();
  return x === "ollama" || x === "openai" || x === "gemini" || x === "groq" ? (x as LLMProvider) : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId: rawId } = await params;
    const fileId = String(rawId || "").trim();
    if (!fileId) {
      return NextResponse.json({ error: "Parâmetro fileId não informado." }, { status: 400 });
    }

    const url = new URL(req.url);
    const providerParam = asProvider(url.searchParams.get("provider"));
    const modelParam = url.searchParams.get("model") || undefined;

    const record = await getAdminFileById(fileId);
    if (!record) {
      return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
    }

    // Cache: if summary exists for the same provider/model, return it.
    const meta = (record.summaryMeta || {}) as Record<string, unknown>;
    const metaProvider = typeof meta.provider === "string" ? meta.provider : "";
    const metaModel = typeof meta.model === "string" ? meta.model : "";
    const reqProvider = providerParam || "";
    const reqModel = modelParam || "";

    if (record.summary && metaProvider === reqProvider && metaModel === reqModel) {
      return NextResponse.json({ summary: record.summary, cached: true }, { status: 200 });
    }

    const pdfBytes = await readAdminFileBytes(fileId);
    if (!pdfBytes) {
      return NextResponse.json({ error: "Arquivo não acessível no storage." }, { status: 404 });
    }

    const parsed = await pdfParse(pdfBytes);
    const fullText = (parsed.text || "").trim();
    if (!fullText) {
      return NextResponse.json({ error: "Texto do PDF não extraído." }, { status: 400 });
    }

    const maxChars = Number(process.env.NEXTIA_PDF_SUMMARY_MAXCHARS || "8000");
    const text = fullText.length > maxChars ? fullText.slice(0, maxChars) : fullText;

    const prompt = `
Resuma o conteúdo abaixo em até 10 tópicos claros.
Use português brasileiro.
Foque em:
- ideias principais
- benefícios
- CTAs importantes

TEXTO:
${text}
`.trim();

    const summary = await runLLM({
      provider: providerParam ?? undefined,
      model: modelParam,
      prompt,
    });

    await updateAdminFileSummary(fileId, summary, {
      provider: providerParam ?? "",
      model: modelParam ?? "",
    });

    return NextResponse.json({ summary, cached: false }, { status: 200 });
  } catch (error: unknown) {
    console.error("admin files summarize error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) || "Erro interno ao resumir." },
      { status: 500 }
    );
  }
}
