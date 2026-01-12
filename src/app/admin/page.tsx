"use client";

import React from "react";

export default function AdminHubPage() {
  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Admin</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        Hub interno (UI básica) para acessar telas de administração e testes. Não é UI de produto.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <a
          href="/admin/budget-test"
          style={{
            padding: "10px 14px",
            border: "1px solid #ccc",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Budget Test (tokens)
        </a>

        <a
          href="/clientes"
          style={{
            padding: "10px 14px",
            border: "1px solid #ccc",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Clientes (limite/política)
        </a>

        <a
          href="/painel"
          style={{
            padding: "10px 14px",
            border: "1px solid #ccc",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Painel
        </a>

        <a
          href="/admin-login"
          style={{
            padding: "10px 14px",
            border: "1px solid #ccc",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Admin Login
        </a>
      </div>

      <div style={{ marginTop: 18, fontSize: 12, color: "#777" }}>
        Dica: faça login e use estes botões. Evite colar links diretos durante testes para reduzir falso-negativo de sessão.
      </div>
    </main>
  );
}