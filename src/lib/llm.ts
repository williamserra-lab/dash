// src/lib/llm.ts
export type LLMProvider = "groq" | "openai" | "ollama" | "gemini";

export type RunLLMInput = {
  prompt: string;
  system?: string;
  temperature?: number; // default 0.3
  maxTokens?: number; // default 700
  model?: string; // opcional: override
  provider?: LLMProvider; // opcional: override explícito
};

export type LLMUsage = {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  provider?: LLMProvider | null;
  model?: string | null;
};

function env(name: string): string {
  return (process.env[name] || "").trim();
}

function llmTimeoutMs(): number {
  const raw =
    env("NEXTIA_LLM_TIMEOUT_MS") ||
    env("LLM_TIMEOUT_MS") ||
    env("OLLAMA_TIMEOUT_MS") ||
    env("OPENAI_TIMEOUT_MS") ||
    env("GROQ_TIMEOUT_MS");

  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    // clamp 1s..300s
    return Math.min(Math.max(n, 1_000), 300_000);
  }
  return 25_000;
}

function pickProvider(explicit?: LLMProvider): LLMProvider {
  if (explicit) return explicit;

  const forced =
    env("NEXTIA_LLM_PROVIDER") ||
    env("LLM_PROVIDER") ||
    env("AI_PROVIDER") ||
    env("PROVIDER");

  if (forced === "groq" || forced === "openai" || forced === "ollama" || forced === "gemini") return forced as any;

  // Heurística: se tiver GROQ_API_KEY, usa Groq. Senão OpenAI. Senão Ollama.
  if (env("GROQ_API_KEY")) return "groq";
  if (env("OPENAI_API_KEY")) return "openai";
  return "ollama";
}

function withTimeout(ms: number) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(id) };
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string, init: RequestInit, timeoutMs?: number): Promise<string> {
  const effectiveTimeout = typeof timeoutMs === "number" ? timeoutMs : llmTimeoutMs();
  const t = withTimeout(effectiveTimeout);
  try {
    const res = await fetch(url, { ...init, signal: t.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
    }
    return text;
  } finally {
    t.cancel();
  }
}

function defaultSystem(): string {
  return (
    "Você é um assistente operacional de loja (WhatsApp). " +
    "Nunca invente dados. Se faltar informação essencial, encaminhe ao humano. " +
    "Responda em português do Brasil."
  );
}

/**
 * Retorna SOMENTE texto (conteúdo da resposta do modelo).
 */
export async function runLLM(input: RunLLMInput): Promise<string> {
  const out = await runLLMWithUsage(input);
  return out.text;
}

/**
 * Versão com telemetria: tenta extrair usage (tokens) quando o provider suporta.
 * Não altera o comportamento da resposta, apenas devolve metadados adicionais.
 */
export async function runLLMWithUsage(input: RunLLMInput): Promise<{ text: string; usage: LLMUsage }> {
  const provider = pickProvider(input.provider);

  const system = (input.system || defaultSystem()).trim();
  const prompt = (input.prompt || "").trim();

  if (!prompt) {
    throw new Error("runLLM: prompt vazio.");
  }

  const temperature = typeof input.temperature === "number" ? input.temperature : 0.3;
  const maxTokens = typeof input.maxTokens === "number" ? input.maxTokens : 700;

  if (provider === "ollama") {
    const baseUrl = (env("OLLAMA_BASE_URL") || "http://127.0.0.1:11434").trim();
    const model = input.model || env("OLLAMA_MODEL") || "llama3.1";

    const payload = {
      model,
      prompt: `${system}\n\n${prompt}`,
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    };

    const raw = await fetchText(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const parsed = safeJson<{ response?: string }>(raw);
    if (!parsed?.response) {
      throw new Error(`Ollama: resposta inválida: ${raw}`);
    }

    // Ollama /api/generate não padroniza usage. Mantemos best-effort (null).
    return {
      text: String(parsed.response),
      usage: { provider, model, promptTokens: null, completionTokens: null, totalTokens: null },
    };
  }

  // Groq e OpenAI usam compatibilidade Chat Completions estilo OpenAI.
  const isGroq = provider === "groq";
  const apiKey = isGroq ? env("GROQ_API_KEY") : env("OPENAI_API_KEY");

  if (!apiKey) {
    throw new Error(
      provider === "groq"
        ? "GROQ_API_KEY não configurada no .env.local"
        : "OPENAI_API_KEY não configurada no .env.local"
    );
  }

  const url = isGroq
    ? (env("GROQ_BASE_URL") || "https://api.groq.com/openai/v1").replace(/\/$/, "")
    : (env("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");

  const model =
    input.model ||
    (isGroq ? env("GROQ_MODEL") : env("OPENAI_MODEL")) ||
    (isGroq ? "llama-3.1-70b-versatile" : "gpt-4o-mini");

  const payload = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  };

  const raw = await fetchText(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const parsed = safeJson<{
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  }>(raw);

  const content = parsed?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`LLM(${provider}): resposta inválida: ${raw}`);

  const usage = parsed?.usage || undefined;
  return {
    text: String(content),
    usage: {
      provider,
      model,
      promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
      completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
      totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Public helpers (used by admin endpoints / observability)
// These wrap the internal selection logic without changing runtime behavior.
// ---------------------------------------------------------------------------

export function resolveLLMProvider(explicit?: string | LLMProvider): LLMProvider {
  const v = (explicit || "").toString().trim().toLowerCase();
  if (v === "groq" || v === "openai" || v === "ollama" || v === "gemini") return v as LLMProvider;
  return pickProvider(undefined);
}

export function resolveLLMModel(provider: LLMProvider, explicitModel?: string): string {
  const m = (explicitModel || "").toString().trim();
  if (m) return m;

  if (provider === "ollama") return env("OLLAMA_MODEL") || "llama3.1";
  if (provider === "groq") return env("GROQ_MODEL") || "llama-3.1-70b-versatile";
  if (provider === "openai") return env("OPENAI_MODEL") || "gpt-4o-mini";
  // Gemini currently not implemented in runLLM; keep a sensible default for callers.
  return env("GEMINI_MODEL") || "gemini-1.5-flash";
}

export function getLLMTimeoutMs(): number {
  return llmTimeoutMs();
}
