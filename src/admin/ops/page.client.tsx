"use client";

import { useEffect, useState } from "react";

type Summary = {
  uptime: number;
  env: string;
  storageMode: string;
  webhookCount: number;
  ignoredMessages: number;
};

export default function OpsPageClient() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [clientId, setClientId] = useState("");

  useEffect(() => {
    const url = clientId
      ? `/api/admin/ops/summary?clientId=${clientId}`
      : `/api/admin/ops/summary`;

    fetch(url)
      .then(r => r.json())
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [clientId]);

  return (
    <div style={{ padding: 24 }}>
      <h1>Admin · Ops</h1>

      <label>
        ClientId (opcional):
        <input
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          style={{ marginLeft: 8 }}
        />
      </label>

      {!summary && <p>Carregando…</p>}

      {summary && (
        <ul>
          <li>Uptime: {Math.floor(summary.uptime)}s</li>
          <li>Env: {summary.env}</li>
          <li>Storage: {summary.storageMode}</li>
          <li>Webhooks recebidos: {summary.webhookCount}</li>
          <li>Mensagens ignoradas: {summary.ignoredMessages}</li>
        </ul>
      )}
    </div>
  );
}
