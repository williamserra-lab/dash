"use client";

import React, { useEffect, useState } from "react";

type ClientRow = { id: string; name?: string | null; active?: boolean };

function getErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function AdminDashboardsPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadClients() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/clients", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : "Falha ao carregar clientes (admin).");
      }
      const items: ClientRow[] = Array.isArray(json?.items) ? json.items : Array.isArray(json?.clients) ? json.clients : [];
      setClients(items);
    } catch (e: unknown) {
      setError(getErr(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClients();
  }, []);

  return (
    <main style={{ padding: "1.5rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.6rem", marginBottom: "0.75rem" }}>Admin · Dashboards (28.5)</h1>

      <div style={{ marginBottom: "1rem", color: "#666" }}>
        Este painel é interno. Se estiver “cego”, faça login em <code>/admin-login</code>.
      </div>

      {error && (
        <div style={{ border: "1px solid #f3b3b3", background: "#fff5f5", padding: "0.75rem", marginBottom: "1rem" }}>
          <div style={{ color: "#b00020", whiteSpace: "pre-wrap" }}>{error}</div>
        </div>
      )}

      <section style={{ border: "1px solid #ddd", borderRadius: 6, padding: "1rem", background: "#fff" }}>
        <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.15rem" }}>Abrir dashboard do lojista</h2>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="clientId"
            style={{ padding: "0.35rem 0.5rem", width: 260 }}
          />
          <a
            href={clientId.trim() ? `/dashboard?clientId=${encodeURIComponent(clientId.trim())}` : "#"}
            onClick={(e) => {
              if (!clientId.trim()) e.preventDefault();
            }}
            style={{
              display: "inline-block",
              padding: "0.45rem 0.8rem",
              border: "1px solid #ccc",
              borderRadius: 4,
              textDecoration: "none",
              color: "#111",
              background: clientId.trim() ? "#fafafa" : "#f5f5f5",
            }}
          >
            Abrir
          </a>

          <button onClick={loadClients} disabled={loading} style={{ padding: "0.4rem 0.8rem" }}>
            {loading ? "Atualizando..." : "Atualizar lista"}
          </button>
        </div>

        <div style={{ marginTop: 10, color: "#666", fontSize: "0.9rem" }}>
          Dica: o dashboard do lojista aceita <code>?clientId=...</code> e opcionalmente <code>&amp;instance=...</code>.
        </div>
      </section>

      <section style={{ marginTop: "1rem", border: "1px solid #ddd", borderRadius: 6, padding: "1rem", background: "#fff" }}>
        <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.15rem" }}>Clientes</h2>

        {clients.length === 0 ? (
          <div style={{ color: "#666" }}>
            {loading ? "Carregando..." : "Sem clientes (ou sem permissão)."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>clientId</th>
                  <th style={th}>Nome</th>
                  <th style={th}>Ativo</th>
                  <th style={th}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td style={td}><code>{c.id}</code></td>
                    <td style={td}>{c.name || "—"}</td>
                    <td style={td}>{c.active ? "sim" : "não"}</td>
                    <td style={td}>
                      <a href={`/dashboard?clientId=${encodeURIComponent(c.id)}`}>abrir dashboard</a>
                      <span style={{ margin: "0 8px", color: "#bbb" }}>|</span>
                      <a href={`/arquivos?clientId=${encodeURIComponent(c.id)}`}>arquivos</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #ddd", padding: "0.5rem" };
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: "0.5rem", verticalAlign: "top" };
