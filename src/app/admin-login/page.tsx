"use client";

import React, { useState } from "react";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function AdminLoginPage() {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("next") || "/arquivos"
      : "/arquivos";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = typeof data?.message === "string" ? data.message : "Falha no login.";
        throw new Error(msg);
      }

      window.location.href = next;
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 560, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.6rem", marginBottom: "1rem" }}>Login Admin</h1>

      <form onSubmit={onSubmit} style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: 4 }}>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>
          NEXTIA_ADMIN_KEY
        </label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          style={{ width: "100%", padding: "0.5rem" }}
          placeholder="cole a chave aqui"
        />
        <button type="submit" disabled={loading || !key.trim()} style={{ marginTop: "0.75rem" }}>
          {loading ? "Entrando..." : "Entrar"}
        </button>

        {error && (
          <div style={{ marginTop: "0.75rem", color: "red", whiteSpace: "pre-wrap" }}>{error}</div>
        )}
      </form>

      <p style={{ marginTop: "0.75rem", fontSize: "0.9rem", color: "#666" }}>
        Este login só habilita ferramentas internas (admin). Nada aqui é para lojista.
      </p>
    </main>
  );
}
