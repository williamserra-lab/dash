// src/app/clientes/[clientId]/painel/page.tsx
// Canonical V1: /clientes/[clientId]/painel
// Implementation is shared with the legacy route /painel/[clientId] for compatibility.

import LegacyClientPainelPage from "../../../painel/[clientId]/page";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteParams = { clientId: string };
type PageProps = { params: Promise<RouteParams> };

export default async function ClientPainelCanonical(props: PageProps) {
  return LegacyClientPainelPage(props as any);
}
