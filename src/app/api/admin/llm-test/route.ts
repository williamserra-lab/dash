import { NextRequest, NextResponse } from "next/server";
import { runLLM, resolveLLMProvider, resolveLLMModel, getLLMTimeoutMs, type LLMProvider } from "@/lib/llm";

type Body = {
  prompt?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  apiKey?: string;
};

function isLLMProvider(v: string): v is LLMProvider {
  return v === "ollama" || v === "openai" || v === "groq" || v === "gemini";
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let body: Body = {};
  try {
    body = raw ? (JSON.parse(raw) as Body) : {};
  } catch {
    body = {};
  }

  // Prompt: JSON body > querystring > plain text body (se não for JSON)
  const qsPrompt = req.nextUrl.searchParams.get("prompt") || "";
  const plainPrompt = raw && !raw.trim().startsWith("{") ? raw : "";
  const prompt = String(body.prompt || qsPrompt || plainPrompt || "").trim();

  if (!prompt) {
    return NextResponse.json(
      { error: "prompt é obrigatório", code: "missing_prompt" },
      { status: 400 },
    );
  }

  // Provider: override explícito (body.provider) > regra padrão do /lib/llm
  const providerOverrideRaw = String(body.provider || "").trim();
  const providerOverride: LLMProvider | undefined =
    providerOverrideRaw && isLLMProvider(providerOverrideRaw) ? providerOverrideRaw : undefined;

  const provider = resolveLLMProvider(providerOverride);
  const model = resolveLLMModel(provider, body.model);
  const temperature = typeof body.temperature === "number" ? body.temperature : undefined;
  const apiKey = body.apiKey;

  const startedAt = Date.now();
  try {
    const text = await runLLM({
      prompt,
      provider,
      model,
      temperature,
      apiKey: apiKey as any,
    } as any);

    const ms = Date.now() - startedAt;

    return NextResponse.json(
      {
        ok: true,
        provider,
        model,
        ms,
        timeoutMs: getLLMTimeoutMs(),
        text,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    const ms = Date.now() - startedAt;
    return NextResponse.json(
      {
        ok: false,
        provider,
        model,
        ms,
        timeoutMs: getLLMTimeoutMs(),
        error: getErrorMessage(err),
        code: "llm_test_failed",
      },
      { status: 500 },
    );
  }
}
