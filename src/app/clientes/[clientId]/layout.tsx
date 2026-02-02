import Link from "next/link";

import { resolveLlmDecision } from "@/lib/llmPolicy";

type RouteParams = { clientId: string };

type Props = {
  params: Promise<RouteParams>;
  children: React.ReactNode;
};

function ClientNav({ base }: { base: string }) {
  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-white">
      <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-auto px-3 py-4">
        <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Cliente
        </div>
        <nav className="space-y-4">
          <div>
            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Operação
            </div>
            <ul className="mt-2 space-y-1">
              <li>
                <Link
                  href={`${base}/painel`}
                  className="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                >
                  Painel
                </Link>
              </li>
              <li>
                <Link
                  href={`${base}/chat`}
                  className="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                >
                  Chat
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Campanhas
            </div>
            <ul className="mt-2 space-y-1">
              <li>
                <Link
                  href={`${base}/campanhas`}
                  className="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                >
                  Campanhas
                </Link>
              </li>
              <li>
                <Link
                  href={`${base}/campanhas-grupos`}
                  className="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                >
                  Campanhas em grupos
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Financeiro
            </div>
            <ul className="mt-2 space-y-1">
              <li>
                <Link
                  href={`${base}/financeiro`}
                  className="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                >
                  Financeiro
                </Link>
              </li>
              <li>
                <Link
                  href={`${base}/budget`}
                  className="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                >
                  Budget
                </Link>
              </li>
            </ul>
          </div>
        </nav>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <Link href="/clientes" className="px-2 text-xs font-semibold text-slate-600 underline">
            Voltar para Clientes
          </Link>
        </div>
      </div>
    </aside>
  );
}

export default async function ClientScopedLayout({ params, children }: Props) {
  const { clientId: rawId } = await params;
  const clientId = decodeURIComponent(rawId || "");

  const base = `/clientes/${encodeURIComponent(clientId)}`;

  let decision: Awaited<ReturnType<typeof resolveLlmDecision>> | null = null;
  try {
    decision = await resolveLlmDecision({ clientId, context: "inbound" });
  } catch {
    decision = null;
  }

  const showBanner = decision && decision.severity !== "none";
  const isError = decision?.severity === "error";

  return (
    <div className="px-6 py-4">
      <div className="mb-4">
        <div className="text-sm text-slate-600">Cliente</div>
        <div className="font-mono text-sm font-semibold text-slate-900">{clientId}</div>
      </div>

      {showBanner ? (
        <div
          data-testid="llm-budget-banner-client"
          className={`mb-4 rounded-md border px-4 py-3 text-sm ${
            isError ? "border-red-200 bg-red-50 text-red-900" : "border-yellow-200 bg-yellow-50 text-yellow-900"
          }`}
        >
          <div className="font-semibold">
            {isError ? "Limite mensal de créditos de IA atingido" : "Limite mensal de créditos de IA perto do fim"}
          </div>
          <div className="mt-1 break-words">{decision!.message}</div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs opacity-80">
            <span>{Math.floor(decision!.usagePct)}% usado · mês {decision!.snapshot.monthKey}</span>
            <Link href={`${base}/budget`} className="underline">
              Ajustar em Budget
            </Link>
          </div>
        </div>
      ) : null}

      <div className="flex gap-6">
        <ClientNav base={base} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
