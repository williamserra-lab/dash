// src/app/clientes/[clientId]/painel/llm/page.tsx

type RouteParams = { clientId: string };

type Props = {
  params: Promise<RouteParams>;
};

export default async function ClientLLMSettingsPage({ params }: Props) {
  const { clientId: rawId } = await params;
  const clientId = decodeURIComponent(rawId || "");

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
        <div className="text-lg font-semibold">Configurações de LLM</div>
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Cliente: <span className="font-mono">{clientId}</span>
        </div>
        <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Esta tela ainda está em implementação. Por enquanto, configure via API:
        </div>
        <pre className="mt-3 overflow-x-auto rounded-md bg-slate-100 p-3 text-xs text-slate-900 dark:bg-slate-900 dark:text-slate-100">
{`# Ler\ncurl -s -H \"x-nextia-admin-key: %NEXTIA_ADMIN_KEY%\" http://192.168.3.252:3000/api/clients/${clientId}/assistant-settings\n\n# Gravar (exemplo OpenAI)\ncurl -s -X POST -H \"content-type: application/json\" -H \"x-nextia-admin-key: %NEXTIA_ADMIN_KEY%\" -d \"{\\\"provider\\\":\\\"openai\\\",\\\"model\\\":\\\"gpt-4o-mini\\\",\\\"apiKeyPlain\\\":\\\"SUA_CHAVE\\\"}\" http://192.168.3.252:3000/api/clients/${clientId}/assistant-settings`}
        </pre>
        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Observação: a chave nunca é retornada pela API (apenas indica se existe e os 4 últimos dígitos).
        </div>
      </div>
    </div>
  );
}
