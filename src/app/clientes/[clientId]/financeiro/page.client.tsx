"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

async function apiGet(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function formatMoneyCents(amountCents: any, currency: string): string {
  const n = Number(amountCents || 0);
  const c = (currency || "BRL").toUpperCase();
  if (c === "BRL") return `R$ ${(n / 100).toFixed(2)}`.replace(".", ",");
  return `${c} ${(n / 100).toFixed(2)}`;
}

export default function FinanceiroClient() {
  const params = useParams<{ clientId: string }>();
  const clientId = params?.clientId;
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const baseUrl = useMemo(() => {
    const b = (process.env.NEXT_PUBLIC_BASE_URL || "").trim();
    return b || "";
  }, []);

  async function refresh() {
    if (!clientId) return;
    setLoading(true);
    setErr(null);
    try {
      const json = await apiGet(`${baseUrl}/api/clients/${encodeURIComponent(clientId)}/billing`);
      setData(json);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const invoice = data?.invoice || null;
  const plan = data?.plan || null;
  const billing = data?.billing || null;
  const instructions = plan?.paymentInstructions || null;

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Financeiro</h1>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button onClick={refresh} style={{ padding: "6px 10px", borderRadius: 6 }} disabled={loading}>
          Atualizar
        </button>
        {loading ? <span style={{ opacity: 0.7 }}>Carregando...</span> : null}
      </div>

      {err ? (
        <div style={{ padding: 10, background: "#2a0000", border: "1px solid #550000", borderRadius: 8, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Erro</div>
          <div style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{err}</div>
        </div>
      ) : null}

      {billing ? (
        <div style={{ padding: 12, border: "1px solid #333", borderRadius: 8, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Status da conta</div>
          <div>
            <b>Status:</b> {billing.status}
          </div>
          {billing.status !== "active" ? (
            <div style={{ marginTop: 6, opacity: 0.85 }}>
              {billing.status === "grace" ? (
                <span>
                  Sua mensalidade está em atraso. A conta entra em suspensão após a tolerância (grace) até: <b>{String(billing.graceUntil || "")}</b>
                </span>
              ) : (
                <span>
                  Conta suspensa por inadimplência. Entre em contato para regularizar e liberar novamente.
                </span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {invoice ? (
        <div style={{ padding: 12, border: "1px solid #333", borderRadius: 8, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Fatura do mês</div>
          <div>
            <b>Valor:</b> {formatMoneyCents(invoice.amountCents, invoice.currency)}
          </div>
          <div>
            <b>Vencimento:</b> {String(invoice.dueDate).replace("T", " ").slice(0, 19)}
          </div>
          <div>
            <b>Status:</b> {invoice.status}
          </div>
          {invoice.paidAt ? (
            <div>
              <b>Pago em:</b> {String(invoice.paidAt).replace("T", " ").slice(0, 19)}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ padding: 12, border: "1px solid #333", borderRadius: 8 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Como pagar</div>
        {instructions ? (
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", opacity: 0.9 }}>{
            typeof instructions === "string" ? instructions : JSON.stringify(instructions, null, 2)
          }</pre>
        ) : (
          <div style={{ opacity: 0.8 }}>
            Pagamento assistido: fale com o suporte para receber as instruções (PIX/link) e liberar o uso.
          </div>
        )}
        <div style={{ marginTop: 10, opacity: 0.8 }}>
          Se já pagou, envie o comprovante para o suporte. (Próximo patch: botão "Enviar comprovante".)
        </div>
      </div>
    </div>
  );
}
