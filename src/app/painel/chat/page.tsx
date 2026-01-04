// src/app/painel/chat/page.tsx
import ChatConsole from "./ui/ChatConsole";

type SearchParams = Record<string, string | string[] | undefined>;

// Next.js 16+ may type `searchParams` as a Promise in generated PageProps.
// `await` is safe even if it is already a plain object.
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;

  const clientId = typeof sp.clientId === "string" ? sp.clientId : "";
  const instance = typeof sp.instance === "string" ? sp.instance : "NextIA";

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Chat do lojista</h1>
      <ChatConsole clientId={clientId} instance={instance} />
    </div>
  );
}
