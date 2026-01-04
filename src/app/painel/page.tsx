// src/app/painel/page.tsx
import { getAllClientsSummary, getGlobalSummary } from "@/lib/analytics";

export const runtime = "nodejs";

export default async function PainelPage() {
  const clientSummaries = await getAllClientsSummary();
  const global = getGlobalSummary(clientSummaries);

  return (
    <main className="p-6 space-y-8">
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
            {global.totalOrdersCreated}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {global.totalOrdersConfirmedByHuman} concluídos por humano ·{" "}
            {global.totalOrdersCancelled} cancelados
          </p>
        </div>

        <div className="border rounded-lg p-4 shadow-sm bg-white">
          <h2 className="text-sm font-semibold text-gray-600">
            Mensagens WhatsApp enviadas
          </h2>
          <p className="text-2xl font-bold mt-2">
            {global.totalWhatsappOutboundText +
              global.totalWhatsappOutboundMedia}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {global.totalWhatsappOutboundText} texto ·{" "}
            {global.totalWhatsappOutboundMedia} mídia
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
                    c.totalWhatsappOutboundText +
                    c.totalWhatsappOutboundMedia;

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
                        {c.totalCampaignSimulated} /{" "}
                        {c.totalCampaignSent}
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
