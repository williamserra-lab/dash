"use client";

import React, { useMemo, useState } from "react";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = useMemo(() => {
    if (typeof window === "undefined") return "/clientes";
    return new URLSearchParams(window.location.search).get("next") || "/clientes";
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.message || data?.error || "Falha no login (admin).";
        throw new Error(msg);
      }

      window.location.href = next;
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "1rem", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Login (Admin)</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Acesso interno para administrar e testar funcionalidades. Esta UI não é para lojista.
      </p>

      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          Usuário
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ width: "100%", padding: "0.5rem" }}
            placeholder="admin"
            autoComplete="username"
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          Senha
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%", padding: "0.5rem" }}
            placeholder="senha"
            autoComplete="current-password"
          />
        </label>

        <button type="submit" disabled={loading || !username.trim() || !password.trim()} style={{ marginTop: "0.25rem", padding: "0.6rem 0.8rem" }}>
          {loading ? "Entrando..." : "Entrar"}
        </button>

        {error && (
          <div style={{ marginTop: "0.25rem", color: "red", whiteSpace: "pre-wrap" }}>{error}</div>
        )}
      </form>

      <details style={{ marginTop: "1rem", color: "#666", fontSize: "0.9rem" }}>
        <summary>Credenciais esperadas</summary>
        <div style={{ marginTop: "0.5rem" }}>
          <div>
            O acesso de admin está restrito a um único par de credenciais (sem fallback).
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            Usuário: <code>admin</code> (senha definida pelo projeto; não exibida aqui).
          </div>
        </div>
      </details>
    </main>
  );
}
