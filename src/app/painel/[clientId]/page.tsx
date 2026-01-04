// src/app/painel/[clientId]/page.tsx
// Painel detalhado de um único cliente: /painel/[clientId]

import { getClientDashboard } from "@/lib/clientDashboard";
import { readJsonValue } from "@/lib/jsonStore";
import Link from "next/link";

export const runtime = "nodejs";

type RouteParams = {
  clientId: string;
};

type PageProps = {
  // Em Next 16, params é uma Promise
  params: Promise<RouteParams>;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";

  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(amount: number | null | undefined): string {
  const value = typeof amount === "number" && !Number.isNaN(amount) ? amount : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function toMs(value: any): number | null {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function isWithinRangeMs(ms: number | null, startMs: number, endMs: number) {
  if (!ms) return false;
  return ms >= startMs && ms <= endMs;
}

function safeLower(x: any) {
  return String(x ?? "").toLowerCase();
}

function pickOrderId(o: any) {
  return o?.id ?? o?.orderId ?? null;
}

function pickOrderClientId(o: any) {
  return o?.clientId ?? o?.tenantId ?? null;
}

function pickOrderStatus(o: any) {
  return safeLower(o?.status);
}

function pickOrderCreatedAtMs(o: any) {
  return (
    toMs(o?.createdAt) ??
    toMs(o?.created_at) ??
    toMs(o?.created) ??
    toMs(o?.updatedAt) ??
    toMs(o?.modifiedAt) ??
    null
  );
}

function pickOrderLastTouchMs(o: any) {
  return (
    toMs(o?.lastActivityAt) ??
    toMs(o?.lastMessageAt) ??
    toMs(o?.updatedAt) ??
    toMs(o?.modifiedAt) ??
    pickOrderCreatedAtMs(o) ??
    null
  );
}

function pickOrderAbandonedAtMs(o: any) {
  return toMs(o?.abandonedAt) ?? null;
}

type OutboxAnyItem = Record<string, any>;

function isOutboxFollowup(item: OutboxAnyItem) {
  // Legado: itens podem não ter `type`, mas têm orderId + messageType
  if (typeof item?.orderId !== "string") return false;
  if (typeof item?.messageType === "string" && item.messageType.trim()) return true;
  return item?.type === "followup_message";
}

function isOutboxMedia(item: OutboxAnyItem) {
  // Legado: mídia pode não ter `status`
  if (typeof item?.mediaId === "string" && item.mediaId.trim()) return true;
  return item?.type === "media";
}

function pickOutboxStatusLower(item: OutboxAnyItem) {
  // Itens legados (ex.: media) podem não ter status; tratamos como pending para observabilidade operacional
  return safeLower(item?.status ?? "pending");
}



type AuditEventAny = Record<string, any>;
type AuditRecordAny = { clientId?: string; events?: AuditEventAny[] };

export default async function ClientPainelPage({ params }: PageProps) {
  // Em versões recentes do Next, params é uma Promise e precisa de await
  const { clientId: rawId } = await params;
  const clientId = decodeURIComponent(rawId || "");

  const data = await getClientDashboard(clientId);

  const midiasUrl = `/midias?clientId=${encodeURIComponent(clientId)}`;
  const configOk = data.config?.ok ?? false;
  const configIssues = data.config?.issues ?? [];
  const priceTable = data.config?.media;

  // ===== New: Operational metrics (outbox + followups audit + abandoned) =====
  const now = new Date();
  const nowMs = now.getTime();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const last7dStartMs = nowMs - 7 * 24 * 60 * 60 * 1000;

  const [outboxRaw, auditRaw, ordersRaw] = await Promise.all([
    readJsonValue<any>("data/whatsapp_outbox.json", []),
    readJsonValue<any>("data/order_followups.json", {}),
    readJsonValue<any>("data/orders.json", []),
  ]);

  const outbox: OutboxAnyItem[] = Array.isArray(outboxRaw) ? outboxRaw : [];
  const auditStore: Record<string, AuditRecordAny> =
    auditRaw && typeof auditRaw === "object" ? (auditRaw as any) : {};
  const ordersAny: any[] = Array.isArray(ordersRaw)
    ? ordersRaw
    : ordersRaw && typeof ordersRaw === "object"
      ? Object.values(ordersRaw)
      : [];

  const outboxClient = outbox.filter((it) => it?.clientId === clientId);
  const outboxPending = outboxClient.filter((it) => pickOutboxStatusLower(it) === "pending");

  const outboxPendingFollowups = outboxPending.filter(isOutboxFollowup);
  const outboxPendingMedia = outboxPending.filter(isOutboxMedia);

  const outboxPending7d = outboxPending.filter((it) =>
    isWithinRangeMs(toMs(it?.createdAt), last7dStartMs, nowMs)
  );
  const outboxPendingToday = outboxPending.filter((it) =>
    isWithinRangeMs(toMs(it?.createdAt), todayStartMs, nowMs)
  );

  const outboxPendingLatest = [...outboxPending]
    .sort((a, b) => (toMs(b?.createdAt) ?? 0) - (toMs(a?.createdAt) ?? 0))
    .slice(0, 10);

  // Audit (Format B): keys are orderId; record has clientId + events[]
  const auditClientRecords = Object.values(auditStore).filter(
    (rec) => rec?.clientId === clientId && Array.isArray(rec?.events)
  );

  const auditEvents: AuditEventAny[] = auditClientRecords
    .flatMap((rec) => (Array.isArray(rec.events) ? rec.events : []))
    .filter(Boolean);

  const followupEvents = auditEvents.filter((e) => safeLower(e?.type) === "followup");
  const abandonedEvents = auditEvents.filter((e) => safeLower(e?.type) === "abandoned");

  const followupsToday = followupEvents.filter((e) =>
    isWithinRangeMs(toMs(e?.at), todayStartMs, nowMs)
  );
  const followups7d = followupEvents.filter((e) =>
    isWithinRangeMs(toMs(e?.at), last7dStartMs, nowMs)
  );

  const followupsByType7d = {
    followup1: followups7d.filter((e) => e?.messageType === "followup1").length,
    followup2: followups7d.filter((e) => e?.messageType === "followup2").length,
    softclose: followups7d.filter((e) => e?.messageType === "softclose").length,
  };

  // Abandoned (prefer orders.json as source of truth for current state; events for audit)
  const ordersClient = ordersAny.filter((o) => pickOrderClientId(o) === clientId);

  const abandonedOrders = ordersClient.filter((o) => pickOrderStatus(o) === "abandonado");
  const abandonedOrdersToday = abandonedOrders.filter((o) =>
    isWithinRangeMs(pickOrderAbandonedAtMs(o) ?? pickOrderCreatedAtMs(o), todayStartMs, nowMs)
  );
  
  const abandonedOrders24h = abandonedOrders.filter((o) => {
    const t = pickOrderAbandonedAtMs(o);
    if (!t) return false;
    return nowMs - t <= 24 * 60 * 60 * 1000;
  });

const abandonedOrders7d = abandonedOrders.filter((o) =>
    isWithinRangeMs(pickOrderAbandonedAtMs(o) ?? pickOrderCreatedAtMs(o), last7dStartMs, nowMs)
  );

  // Ações pendentes (heurísticas baseadas em campos reais do order; não muda lógica de negócio)
  const isTerminal = (status: string) =>
    ["concluido", "concluído", "finalizado", "cancelado", "canceled", "cancelled"].includes(status);

  const isAbandoned = (status: string) => status === "abandonado" || status === "abandoned";

  const itemNeedsFix = (o: any) => {
    const items = Array.isArray(o?.items) ? o.items : [];
    if (items.length === 0) return true;
    return items.some((it: any) => {
      const q = typeof it?.quantity === "number" ? it.quantity : null;
      const price = it?.unitPriceCents ?? it?.unitPrice ?? null;
      if (q === null || q <= 0) return true;
      if (price === null || price === undefined || price === "") return true;
      return false;
    });
  };

  const totalsNeedsFix = (o: any) => {
    const cents = o?.totalAmountCents ?? o?.totalCents ?? null;
    const total = o?.totalAmount ?? o?.total ?? null;
    // aceitamos totalAmount (em centavos ou reais) como legado, mas se não tiver nada, é pendente
    return cents === null && total === null;
  };

  const deliveryNeedsFix = (o: any) => {
    // no seu exemplo, delivery pode ser null; isso é ação humana para definir entrega/retirada
    return o?.delivery === null || o?.delivery === undefined;
  };

  const paymentNeedsFix = (o: any) => {
    return o?.payment === null || o?.payment === undefined;
  };

  const pendingHumanOrders = ordersClient
    .filter((o) => {
      const st = pickOrderStatus(o);
      if (!st || isTerminal(st) || isAbandoned(st)) return false;
      return true;
    })
    .map((o) => {
      const orderId = pickOrderId(o) ?? "—";
      const st = pickOrderStatus(o);
      const lastMs = pickOrderLastTouchMs(o);
      const ageMin = lastMs ? Math.max(0, Math.round((nowMs - lastMs) / 1000 / 60)) : null;

      // motivo: prioridade por consistência operacional
      let reason = "Revisar/confirmar pedido";
      if (itemNeedsFix(o)) reason = "Corrigir itens (quantidade/preço)";
      else if (totalsNeedsFix(o)) reason = "Definir total do pedido";
      else if (deliveryNeedsFix(o)) reason = "Definir entrega/retirada";
      else if (paymentNeedsFix(o)) reason = "Definir pagamento";

      return { orderId, status: st, ageMin, reason };
    })
    .sort((a, b) => (b.ageMin ?? 0) - (a.ageMin ?? 0));

  const pendingHumanTop = pendingHumanOrders.slice(0, 20);

  // Abandonados recentes (ação operacional típica: recuperar)
  const abandonedRecentTop = abandonedOrders24h
    .map((o) => {
      const orderId = pickOrderId(o) ?? "—";
      const lastMs = pickOrderLastTouchMs(o);
      const ageMin = lastMs ? Math.max(0, Math.round((nowMs - lastMs) / 1000 / 60)) : null;
      const abandonedAt = (o as any)?.abandonedAt ?? (o as any)?.abandoned_at ?? null;
      const lastMsg = (o as any)?.lastMessage ?? (o as any)?.last_message ?? "";
      const items = Array.isArray((o as any)?.items) ? (o as any).items : [];
      const itemSummary =
        items.length > 0
          ? items
              .slice(0, 2)
              .map((it: any) => `${it?.quantity || 0}x ${it?.name || "item"}`)
              .join(", ") + (items.length > 2 ? "…" : "")
          : "—";
      return { orderId, ageMin, abandonedAt, lastMsg, itemSummary };
    })
    .sort((a, b) => (b.ageMin ?? 0) - (a.ageMin ?? 0))
    .slice(0, 20);


  // Optional: show latest 5 followup events for quick inspection
  const followupEventsLatest = [...followupEvents]
    .sort((a, b) => (toMs(b?.at) ?? 0) - (toMs(a?.at) ?? 0))
    .slice(0, 5);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Header */}
        <header className="mb-6 border-b border-slate-200 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">
                Painel &gt; Cliente &gt; <span className="font-mono">{clientId}</span>
              </p>
              <h1 className="mt-1 text-xl font-semibold text-slate-800">
                Visão detalhada do cliente
              </h1>
              <p className="mt-1 text-xs text-slate-600">
                Contatos, pré-pedidos/pedidos e mensagens do bot para este cliente.
              </p>
            </div>

            <div className="flex flex-col items-end gap-1 text-right">
              <Link href="/painel" className="text-xs font-medium text-sky-700 hover:underline">
                Voltar para visão geral
              </Link>
              <Link href={midiasUrl} className="text-xs font-medium text-emerald-700 hover:underline">
                Abrir mídias do cliente
              </Link>
              <span className="font-mono text-[11px] text-slate-500">clientId: {clientId}</span>
            </div>
          </div>
        </header>

        {/* Cards principais */}
        <section className="mb-6 grid gap-4 md:grid-cols-5">
          {/* Contatos totais */}
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Contatos totais</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">{data.totalContacts}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              {data.activeContactsLast30d} ativos nos últimos 30 dias
            </p>
          </div>

          {/* Pedidos totais */}
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Registros (pré-pedidos/pedidos)</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">{data.totalOrders}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              {data.openOrders} em aberto · {data.finishedOrders} concluídos
            </p>
          </div>

          {/* Cancelamentos */}
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Cancelamentos</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">{data.cancelledOrders}</p>
            <p className="mt-1 text-[11px] text-slate-500">Status “cancelado”.</p>
          </div>

          {/* Receita total */}
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Receita estimada</p>
            <p className="mt-1 text-2xl font-semibold text-sky-700">{formatMoney(data.totalRevenue)}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Soma de totalAmount / total / payment.total de pedidos não cancelados.
            </p>
          </div>

          {/* Configuração do cliente */}
          <div
            className={`rounded-lg p-4 shadow-sm ${
              configOk ? "bg-emerald-50 border border-emerald-200" : "bg-amber-50 border border-amber-200"
            }`}
          >
            <p className="text-[11px] text-slate-600">Configuração</p>
            <p
              className={`mt-1 text-sm font-semibold ${configOk ? "text-emerald-800" : "text-amber-800"}`}
            >
              {configOk ? "OK" : "Pendente"}
            </p>

            <div className="mt-2 text-[11px] text-slate-700">
              <p className="font-medium text-slate-700">Tabela de preços</p>
              {priceTable?.hasOfficialPriceTable ? (
                <p className="text-slate-700">{"Tabela oficial configurada"}</p>
              ) : (
                <p className="text-amber-800">Nenhuma tabela oficial ativa.</p>
              )}

              {!configOk && configIssues.length > 0 && (
                <ul className="mt-2 list-disc pl-4 text-amber-900">
                  {configIssues.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              )}

              <Link href={midiasUrl} className="mt-2 inline-block font-medium text-emerald-800 hover:underline">
                Corrigir nas mídias
              </Link>
            </div>
          </div>
        </section>

        {/* New: Cards operacionais */}
        <section className="mb-6 grid gap-4 md:grid-cols-4">
          {/* Outbox pendente */}
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Outbox pendente</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">{outboxPending.length}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Hoje: {outboxPendingToday.length} · 7d: {outboxPending7d.length}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Follow-up: {outboxPendingFollowups.length} · Mídia: {outboxPendingMedia.length}
            </p>
          </div>

          {/* Abandonados */}
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Abandonados</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">{abandonedOrders.length}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Hoje: {abandonedOrdersToday.length} · 7d: {abandonedOrders7d.length}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Eventos (audit): {abandonedEvents.filter((e) => isWithinRangeMs(toMs(e?.at), last7dStartMs, nowMs)).length} em 7d
            </p>
          </div>

          {/* Follow-ups (audit) */}
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Follow-ups (audit)</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">{followups7d.length}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Hoje: {followupsToday.length} · 7d: {followups7d.length}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              F1: {followupsByType7d.followup1} · F2: {followupsByType7d.followup2} · Soft: {followupsByType7d.softclose}
            </p>
          </div>

          {/* Qualidade de dados (sinal) */}
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Sinais</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">Operação rastreável</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Auditoria no formato events (B) e mensagens enfileiradas em outbox.
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Próximo: conversão pré-pedido → confirmado + confirmação ao cliente (toggle + teste).
            </p>
          </div>
        </section>
        {/* New: Ações pendentes (fila operacional) */}
        <section className="mb-6 rounded-lg bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Ações pendentes</h2>
              <p className="text-[11px] text-slate-500">Pedidos que normalmente exigem intervenção humana (top 20)</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-500">Total</p>
              <p className="text-lg font-semibold text-slate-800">{pendingHumanOrders.length}</p>
            </div>
          </div>

          {pendingHumanTop.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhuma ação pendente detectada para este cliente.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[12px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] text-slate-500">
                    <th className="py-2 pr-4">Pedido</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Idade</th>
                    <th className="py-2 pr-2">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingHumanTop.map((row) => (
                    <tr key={row.orderId} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-4 font-mono text-[11px] text-slate-700">{row.orderId}</td>
                      <td className="py-2 pr-4">
                        <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700">
                          {row.status || "—"}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-slate-700">
                        {typeof row.ageMin === "number" ? `${row.ageMin} min` : "—"}
                      </td>
                      <td className="py-2 pr-2 text-slate-700">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-[11px] text-slate-500">
                  Dica: use <span className="font-medium">/pedidos?clientId={clientId}</span> para inspecionar os registros.
                </p>
                <Link
                  className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  href={`/pedidos?clientId=${encodeURIComponent(clientId)}`}
                >
                  Abrir pedidos
                </Link>
              </div>
            </div>
          )}
        </section>

        {/* New: Abandonados recentes (fila de recuperação) */}
        <section className="mb-6 rounded-lg bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Abandonados recentes (24h)</h2>
              <p className="text-[11px] text-slate-500">Prioridade de recuperação: pedidos encerrados pelo soft close</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-500">Total (24h)</p>
              <p className="text-lg font-semibold text-slate-800">{abandonedOrders24h.length}</p>
            </div>
          </div>

          {abandonedRecentTop.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhum pedido abandonado nas últimas 24h.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[12px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] text-slate-500">
                    <th className="py-2 pr-4">Pedido</th>
                    <th className="py-2 pr-4">Idade</th>
                    <th className="py-2 pr-4">Itens</th>
                    <th className="py-2 pr-2">Última msg</th>
                  </tr>
                </thead>
                <tbody>
                  {abandonedRecentTop.map((row) => (
                    <tr key={row.orderId} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-4 font-mono text-[11px] text-slate-700">{row.orderId}</td>
                      <td className="py-2 pr-4 text-slate-700">
                        {typeof row.ageMin === "number" ? `${row.ageMin} min` : "—"}
                      </td>
                      <td className="py-2 pr-4 text-slate-700">{row.itemSummary}</td>
                      <td className="py-2 pr-2 text-slate-700">
                        {row.lastMsg ? row.lastMsg.slice(0, 80) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-[11px] text-slate-500">
                  Operação: priorize contatos desses pedidos. Se o cliente responder, o inbound deve retomar o fluxo.
                </p>
                <Link
                  className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  href={`/pedidos?clientId=${encodeURIComponent(clientId)}`}
                >
                  Abrir pedidos
                </Link>
              </div>
            </div>
          )}
        </section>




        {/* New: Outbox pendente (lista rápida) */}
        <section className="mb-6 rounded-lg bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Pendências na outbox</h2>
            <p className="text-[11px] text-slate-500">Últimos 10 itens pending</p>
          </div>

          {outboxPendingLatest.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhuma pendência na outbox para este cliente.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-2 py-1 text-left font-medium text-slate-600">Hora</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-600">Tipo</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-600">Destino</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-600">Pedido</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-600">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {outboxPendingLatest.map((it) => {
                    const createdAt = it?.createdAt ?? null;
                    const kind = isOutboxFollowup(it) ? "FOLLOWUP" : isOutboxMedia(it) ? "MEDIA" : (it?.type ?? "OUTBOX");
                    const to = it?.to ?? it?.contactId ?? "-";
                    const orderId = it?.orderId ?? "-";
                    const detail = isOutboxFollowup(it)
                      ? `${it?.messageType ?? "followup"}`
                      : isOutboxMedia(it)
                        ? `${it?.mediaId ?? "media"}`
                        : `${it?.label ?? it?.messageType ?? "-"}`;

                    return (
                      <tr key={it?.id ?? `${orderId}:${createdAt}:${kind}`} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-1 align-top">
                          <span className="font-mono text-[10px] text-slate-600">{formatDateTime(createdAt)}</span>
                        </td>
                        <td className="px-2 py-1 align-top">
                          <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700">
                            {kind}
                          </span>
                        </td>
                        <td className="px-2 py-1 align-top">
                          <span className="font-mono text-[10px] text-slate-500 break-all">{to}</span>
                        </td>
                        <td className="px-2 py-1 align-top">
                          <span className="font-mono text-[10px] text-slate-500 break-all">
                            {orderId}
                          </span>
                        </td>
                        <td className="px-2 py-1 align-top">
                          <span className="text-[11px] text-slate-700">{detail}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Duas colunas: últimos pedidos + mensagens do bot */}
        <section className="grid gap-6 md:grid-cols-2">
          {/* Últimos pedidos */}
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Últimos pedidos</h2>
              <p className="text-[11px] text-slate-500">Mostrando até 10 mais recentes</p>
            </div>

            {data.lastOrders.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhum pedido registrado para este cliente.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-2 py-1 text-left font-medium text-slate-600">Hora</th>
                      <th className="px-2 py-1 text-left font-medium text-slate-600">Status</th>
                      <th className="px-2 py-1 text-right font-medium text-slate-600">Total</th>
                      <th className="px-2 py-1 text-left font-medium text-slate-600">Identificador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lastOrders.map((o) => (
                      <tr key={o.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-1 align-top">
                          <span className="font-mono text-[10px] text-slate-600">{formatDateTime(o.createdAt)}</span>
                        </td>
                        <td className="px-2 py-1 align-top">
                          <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700">
                            {o.status}
                          </span>
                        </td>
                        <td className="px-2 py-1 align-top text-right">
                          {o.totalAmount != null ? (
                            <span className="font-medium text-slate-800">{formatMoney(o.totalAmount)}</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-2 py-1 align-top">
                          <span className="font-mono text-[10px] text-slate-500 break-all">{o.identifier || "-"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Mensagens do bot */}
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Últimas mensagens enviadas pelo bot</h2>
              <p className="text-[11px] text-slate-500">Inclui texto, mídias e confirmações · até 10 registros</p>
            </div>

            {data.lastMessages.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhuma mensagem de saída registrada para este cliente.</p>
            ) : (
              <div className="space-y-2">
                {data.lastMessages.map((m) => (
                  <div key={m.id} className="rounded border border-slate-200 px-3 py-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-700">
                          {m.type}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">{formatDateTime(m.createdAt)}</span>
                      </div>
                      <div className="text-right text-[10px] text-slate-500">
                        {m.channel && <span className="mr-2 uppercase">{m.channel}</span>}
                        {m.to && <span className="font-mono">→ {m.to}</span>}
                      </div>
                    </div>
                    {m.label && <p className="mt-1 text-[11px] text-slate-700">{m.label}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* New: Últimos follow-ups (audit) — inspeção rápida */}
        <section className="mt-6 rounded-lg bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Últimos eventos de follow-up (audit)</h2>
            <p className="text-[11px] text-slate-500">Até 5 eventos mais recentes</p>
          </div>

          {followupEventsLatest.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhum evento de follow-up registrado para este cliente.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-2 py-1 text-left font-medium text-slate-600">Hora</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-600">Pedido</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-600">Tipo</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-600">Attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {followupEventsLatest.map((e) => (
                    <tr key={`${e?.orderId ?? "ord"}:${e?.at ?? "t"}:${e?.messageType ?? "m"}`} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-1 align-top">
                        <span className="font-mono text-[10px] text-slate-600">{formatDateTime(e?.at ?? null)}</span>
                      </td>
                      <td className="px-2 py-1 align-top">
                        <span className="font-mono text-[10px] text-slate-500 break-all">{e?.orderId ?? "-"}</span>
                      </td>
                      <td className="px-2 py-1 align-top">
                        <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700">
                          {e?.messageType ?? "followup"}
                        </span>
                      </td>
                      <td className="px-2 py-1 align-top">
                        <span className="font-mono text-[10px] text-slate-600">{String(e?.attempt ?? "-")}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
