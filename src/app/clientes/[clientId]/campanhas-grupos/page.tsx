import { Suspense } from "react";
import CampanhasGruposPageClient from "@/app/campanhas-grupos/page.client";

export const dynamic = "force-dynamic";

// Next.js (v15+) tipa `params` como Promise em Server Components.
export default async function Page({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  return (
    <Suspense fallback={null}>
      <CampanhasGruposPageClient clientId={clientId} />
    </Suspense>
  );
}
