// src/app/clientes/[clientId]/page.tsx
// Canonical entry: /clientes/[clientId] -> /clientes/[clientId]/painel

import { redirect } from "next/navigation";

export const runtime = "nodejs";

type RouteParams = { clientId: string };
type PageProps = { params: Promise<RouteParams> };

export default async function ClientRoot({ params }: PageProps) {
  const { clientId: rawId } = await params;
  const clientId = encodeURIComponent(decodeURIComponent(rawId || ""));
  redirect(`/clientes/${clientId}/painel`);
}
