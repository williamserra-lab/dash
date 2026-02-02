"use client";

import React, { useEffect, useState } from "react";

type StoredFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
};

type ProviderOption = "ollama" | "openai" | "gemini" | "groq";

const DEFAULT_MODELS: Record<ProviderOption, string> = {
  ollama: "phi3:mini",
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-flash",
  groq: "llama-3.1-8b-instant",
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ArquivosPage() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [loadingSummaryFor, setLoadingSummaryFor] = useState<string | null>(null);

  const [provider, setProvider] = useState<ProviderOption>("ollama");
  const [model, setModel] = useState<string>(DEFAULT_MODELS["ollama"]);

  const [purpose, setPurpose] = useState<"review_file" | "handoff">("review_file");

  // quando mudar provider, ajusta modelo padrão
  useEffect(() => {
    setModel((current) => {
      const def = DEFAULT_MODELS[provider];
      if (Object.values(DEFAULT_MODELS).includes(current) && current !== def) {
        return def;
      }
      return current || def;
    });
  }, [provider]);

  async function loadFiles() {
    try {
      setError(null);
      const res = await fetch("/api/admin/files/list");
      if (res.status === 401) {
        setError("Acesso admin necessário. Faça login em /login.");
        setFiles([]);
        return;
      }
      if (!res.ok) throw new Error("Falha ao listar arquivos.");
      const data = await res.json();
      setFiles(Array.isArray(data.files) ? (data.files as StoredFile[]) : []);
    } catch (e: unknown) {
      console.error("Erro ao carregar arquivos:", e);
      setError("Erro ao carregar arquivos.");
    }
  }

  useEffect(() => {
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;

    try {
      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/admin/files/upload", {
        method: "POST",
        body: formData,
      });

      if (res.status === 401) {
        setError("Acesso admin necessário. Faça login em /login.");
        return;
      }

      if (!res.ok) throw new Error("Falha no upload.");

      const data = await res.json();
      const file = data.file as StoredFile;

      setFiles((prev) => [file, ...prev]);
      setSelectedFile(null);
    } catch (e: unknown) {
      console.error("Erro ao enviar arquivo:", e);
      setError("Erro ao enviar arquivo.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSummarize(fileId: string) {
    try {
      setLoadingSummaryFor(fileId);
      setError(null);

      const params = new URLSearchParams({ provider, model, purpose });

      // 1) status/cache
      const statusRes = await fetch(
        `/api/admin/files/summarize/${encodeURIComponent(fileId)}?${params.toString()}`,
        { cache: "no-store" }
      );

      const status = await statusRes.json().catch(() => ({}));

      if (statusRes.status === 401) {
        setError("Acesso admin necessário. Faça login em /login.");
        return;
      }

      // Feature flag disabled returns 404.
      if (statusRes.status === 404 && (status as any)?.error === "feature_disabled") {
        setError("Resumo de arquivo desativado. Habilite NEXTIA_FEATURE_FILE_SUMMARY=1.");
        return;
      }

      if (statusRes.ok && typeof (status as any)?.summary === "string") {
        setSummaries((prev) => ({ ...prev, [fileId]: String((status as any).summary) }));
        return;
      }

      // 2) generate on demand
      const genRes = await fetch(
        `/api/admin/files/summarize/${encodeURIComponent(fileId)}?${params.toString()}`,
        { method: "POST" }
      );
      const gen = await genRes.json().catch(() => ({}));

      if (genRes.status === 401) {
        setError("Acesso admin necessário. Faça login em /login.");
        return;
      }

      if (!genRes.ok) {
        const msg = typeof (gen as any)?.error === "string" ? (gen as any).error : "Falha ao gerar resumo.";
        throw new Error(msg);
      }

      const summary: string = typeof (gen as any).summary === "string" ? (gen as any).summary : "Resumo não retornado.";
      setSummaries((prev) => ({ ...prev, [fileId]: summary }));
    } catch (e: unknown) {
      console.error("Erro ao gerar resumo:", e);
      setError(getErrorMessage(e) || "Erro ao gerar resumo.");
    } finally {
      setLoadingSummaryFor(null);
    }
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.8rem", marginBottom: "1rem" }}>Arquivos (Admin)</h1>

      <section
        style={{
          border: "1px solid #ccc",
          padding: "1rem",
          marginBottom: "1.5rem",
          borderRadius: 4,
        }}
      >
        <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Configuração do modelo</h2>

        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <label>
            Provider:&nbsp;
            <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderOption)}>
              <option value="ollama">Ollama (local / sem custo)</option>
              <option value="openai">OpenAI (pago)</option>
              <option value="gemini">Gemini (pago)</option>
              <option value="groq">Groq (pago)</option>
            </select>
          </label>

          <label>
            Modelo:&nbsp;
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{ minWidth: "220px" }}
            />
          </label>

          <label>
            Tipo de resumo:&nbsp;
            <select value={purpose} onChange={(e) => setPurpose(e.target.value as any)}>
              <option value="review_file">Leitura rápida</option>
              <option value="handoff">Handoff</option>
            </select>
          </label>

          <button type="button" onClick={loadFiles}>
            Recarregar
          </button>
        </div>

        <p style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.5rem" }}>
          Dica: deixe em Ollama enquanto estiver testando para evitar custos. OpenAI/Gemini só funcionam se a
          chave estiver configurada no servidor.
        </p>

        <p style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.25rem" }}>
          Aviso: gerar resumo pode consumir tokens quando provider/model pagos estiverem selecionados.
        </p>
      </section>

      <section
        style={{
          border: "1px solid #ccc",
          padding: "1rem",
          marginBottom: "1.5rem",
          borderRadius: 4,
        }}
      >
        <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Enviar novo arquivo PDF</h2>

        <form onSubmit={handleUpload}>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setSelectedFile(e.target.files ? e.target.files[0] : null)}
          />
          <button type="submit" disabled={!selectedFile || uploading} style={{ marginLeft: "0.5rem" }}>
            {uploading ? "Enviando..." : "Enviar"}
          </button>
        </form>
      </section>

      {error && (
        <div style={{ color: "red", marginBottom: "1rem", whiteSpace: "pre-wrap" }}>
          {error}{" "}
          {error.includes("/login") ? (
            <a href="/login" style={{ textDecoration: "underline" }}>
              Abrir login
            </a>
          ) : null}
        </div>
      )}

      <section style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: 4 }}>
        <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Arquivos armazenados</h2>

        {files.length === 0 && <p>Nenhum arquivo armazenado.</p>}

        {files.map((file) => (
          <div
            key={file.id}
            style={{
              borderTop: "1px solid #eee",
              paddingTop: "0.75rem",
              marginTop: "0.75rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{file.originalName}</div>
                <div style={{ fontSize: "0.8rem", color: "#666" }}>
                  id: {file.id} · {file.size} bytes · {file.createdAt}
                </div>
              </div>

              <button onClick={() => handleSummarize(file.id)} disabled={loadingSummaryFor === file.id}>
                {loadingSummaryFor === file.id ? "Resumindo..." : "Resumir"}
              </button>
            </div>

            {summaries[file.id] && (
              <div
                style={{
                  marginTop: "0.75rem",
                  padding: "0.5rem",
                  background: "#f9f9f9",
                  borderRadius: 4,
                  whiteSpace: "pre-wrap",
                }}
              >
                {summaries[file.id]}
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
