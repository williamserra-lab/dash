// src/app/painel/page.tsx
import { getAllClientsSummary, getGlobalSummary } from "@/lib/analytics";
import { listClients } from "@/lib/clients";
import { resolveLlmDecision } from "@/lib/llmPolicy";

export const runtime = "nodejs";

export default async function PainelPage() {
  const clientSummaries = await getAllClientsSummary();
  const global = await getGlobalSummary();

  const clients = await listClients();
  const llmWarnings = (
    await Promise.all(
      clients.map(async (c) => {
        try {
          const d = await resolveLlmDecision({ clientId: c.id, context: "inbound" });
          if (d.severity === "none") return null;
          return { clientId: c.id, name: c.name, severity: d.severity, message: d.message, usagePct: d.usagePct };
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean) as Array<{ clientId: string; name: string; severity: "warn" | "error"; message: string; usagePct: number }>;


  const g: any = global as any;

  const totalOrdersCreated =
    g.totalOrdersCreated ?? g.totalPreordersCreated ?? g.totalOrders ?? 0;
  const totalOrdersConfirmedByHuman =
    g.totalOrdersConfirmedByHuman ?? g.totalPreordersConfirmedByHuman ?? 0;
  const totalOrdersCancelled =
    g.totalOrdersCancelled ?? g.totalPreordersCancelled ?? 0;

  const totalOutboundText =
    g.totalOutboundText ?? g.totalWhatsappOutboundText ?? 0;
  const totalOutboundMedia =
    g.totalOutboundMedia ?? g.totalWhatsappOutboundMedia ?? 0;


  return (
    <main className="p-6 space-y-8">
      {llmWarnings.length > 0 ? (
        <div
          data-testid="llm-budget-banner-painel"
          className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900"
        >
          <div className="font-semibold">Atenção: limite de IA próximo do fim</div>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {llmWarnings.slice(0, 5).map((w) => (
              <li key={w.clientId}>
                <span className="font-medium">{w.name}</span>: {Math.floor(w.usagePct)}% — {w.message}
              </li>
            ))}
          </ul>
          {llmWarnings.length > 5 ? (
            <div className="mt-2 text-xs opacity-80">+{llmWarnings.length - 5} outros clientes com aviso</div>
          ) : null}
        </div>
      ) : null}

      <header>
        <h1 className="text-2xl font-bold">Painel de resultados</h1>
        <p className="text-sm text-gray-600">
          Visão geral do uso da plataforma por cliente (loja).
        </p>
      </header>

      {/* Cards globais */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 shadow-sm bg-white">
          <h2 className="text-sm font-semibold text-gray-600">
            Lojas ativas (com eventos)
          </h2>
          <p className="text-2xl font-bold mt-2">
            {global.totalClients}
          </p>
        </div>

        <div className="border rounded-lg p-4 shadow-sm bg-white">
          <h2 className="text-sm font-semibold text-gray-600">
            Pedidos criados (bot + painel)
          </h2>
          <p className="text-2xl font-bold mt-2">
            {totalOrdersCreated}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {totalOrdersConfirmedByHuman} concluídos por humano ·{" "}
            {totalOrdersCancelled} cancelados
          </p>
        </div>

        <div className="border rounded-lg p-4 shadow-sm bg-white">
          <h2 className="text-sm font-semibold text-gray-600">
            Mensagens WhatsApp enviadas
          </h2>
          <p className="text-2xl font-bold mt-2">
            {totalOutboundText +
              totalOutboundMedia}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {totalOutboundText} texto ·{" "}
            {totalOutboundMedia} mídia
          </p>
        </div>
      </section>

      {/* Tabela por cliente */}
      <section className="border rounded-lg bg-white shadow-sm overflow-hidden">
        <div className="border-b px-4 py-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Desempenho por cliente
          </h2>
          <span className="text-xs text-gray-500">
            {clientSummaries.length} clientes com atividade registrada
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">
                  Cliente
                </th>
                <th className="px-4 py-2 text-right font-semibold text-gray-600">
                  Pedidos criados
                </th>
                <th className="px-4 py-2 text-right font-semibold text-gray-600">
                  Concluídos (humano)
                </th>
                <th className="px-4 py-2 text-right font-semibold text-gray-600">
                  Cancelados
                </th>
                <th className="px-4 py-2 text-right font-semibold text-gray-600">
                  Msgs WhatsApp
                </th>
                <th className="px-4 py-2 text-right font-semibold text-gray-600">
                  Campanhas (simuladas / enviadas)
                </th>
              </tr>
            </thead>
            <tbody>
              {clientSummaries.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-6 text-center text-gray-500"
                    colSpan={6}
                  >
                    Ainda não há eventos registrados. Gere pedidos ou
                    campanhas para ver dados aqui.
                  </td>
                </tr>
              ) : (
                clientSummaries.map((c) => {
                  const totalWhatsapp =
                    ((c as any).totalOutboundText ?? (c as any).totalWhatsappOutboundText ?? 0) +
                    ((c as any).totalOutboundMedia ?? (c as any).totalWhatsappOutboundMedia ?? 0);

                  const conversionRate =
                    c.totalOrdersCreated > 0
                      ? (
                          (c.totalOrdersConfirmedByHuman /
                            c.totalOrdersCreated) *
                          100
                        ).toFixed(1)
                      : "-";

                  return (
                    <tr
                      key={c.clientId}
                      className="border-t hover:bg-gray-50"
                    >
                      <td className="px-4 py-2 font-medium text-gray-800">
                        {c.clientId}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {c.totalOrdersCreated}
                        {conversionRate !== "-" && (
                          <span className="ml-1 text-xs text-gray-500">
                            ({conversionRate}% concl.)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {c.totalOrdersConfirmedByHuman}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {c.totalOrdersCancelled}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {totalWhatsapp}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {((c as any).totalCampaignSimulated ?? (c as any).totalSimulated ?? (c as any).campaignSimulated ?? 0)} /{" "}
                        {((c as any).totalCampaignSent ?? (c as any).totalSent ?? (c as any).campaignSent ?? 0)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
