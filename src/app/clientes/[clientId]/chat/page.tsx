import ChatV1 from "./ui/ChatV1";

type RouteParams = { clientId: string };
type SearchParams = Record<string, string | string[] | undefined>;

export default async function ClientChatPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { clientId: rawId } = await params;
  const clientId = decodeURIComponent(rawId || "");
  await searchParams; // kept to match Next PageProps typing in this repo

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Chat</h1>
      <ChatV1 clientId={clientId} />
    </div>
  );
}
