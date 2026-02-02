"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";

type SeedResult = {
  ok: boolean;
  clientId: string;
  created?: { contactId: string; orderId: string; bookingId: string };
  warnings?: { code: string; message: string }[];
  errorCode?: string;
  message?: string;
  details?: any;
};

export default function DevSeedPageClient() {
  const [clientId, setClientId] = React.useState("loja_teste");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SeedResult | null>(null);

  async function runSeed() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/dev/seed?clientId=${encodeURIComponent(clientId)}`, {
        method: "POST",
      });

      const data = (await res.json()) as SeedResult;

      if (!res.ok || !data.ok) {
        const msg = data.message || data.errorCode || "seed_failed";
        setError(msg);
        setResult(data);
        return;
      }

      setResult(data);
    } catch (e: any) {
      setError(e?.message || "Falha inesperada ao chamar seed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Dados de teste</h1>
        <p className="text-sm text-slate-600">
          Gerador rápido para você testar sem depender do bot: cria 1 <b>Pedido</b> (orders.json) e 1 <b>Agendamento</b> (requested).
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Observação: este seed não cria Pré-pedido nesta etapa (para não bloquear os testes enquanto o caminho de payload no Postgres é revisado).
        </p>
      </div>

      {error ? (
        <div className="mb-4">
          <Alert variant="error">
            <div className="font-medium">Erro</div>
            <div className="text-sm opacity-90">{error}</div>
            {result?.errorCode ? (
              <div className="mt-2 text-xs opacity-80">Código: {result.errorCode}</div>
            ) : null}
          </Alert>

          {result?.details ? (
            <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
              <div className="font-semibold">Detalhes (debug)</div>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(result.details, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {result?.ok && result.created ? (
        <div className="mb-4">
          <Alert variant="success">
            <div className="font-medium">OK</div>
            <div className="text-sm opacity-90">Dados gerados para {result.clientId}.</div>
            <div className="mt-2 text-xs opacity-80">
              orderId: {result.created.orderId} • bookingId: {result.created.bookingId}
            </div>
            {result.warnings?.length ? (
              <div className="mt-2 text-xs opacity-80">
                {result.warnings.map((w) => (
                  <div key={w.code}>
                    <span className="font-semibold">{w.code}</span>: {w.message}
                  </div>
                ))}
              </div>
            ) : null}
          </Alert>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Gerar para um cliente</CardTitle>
          <CardDescription>Informe o clientId. Se o cliente não existir, será criado automaticamente.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700">clientId</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="loja_teste"
              />
            </div>
            <Button onClick={runSeed} disabled={loading || !clientId.trim()}>
              {loading ? "Gerando..." : "Gerar dados"}
            </Button>
          </div>

          {!result ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              Nenhum dado gerado ainda. Clique em <b>Gerar dados</b> para criar itens de teste.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
