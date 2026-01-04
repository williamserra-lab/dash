import { redirect } from "next/navigation";

// Next.js (v15+) tipa `params` como Promise em Server Components.
export default async function Page({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  redirect(`/campanhas?clientId=${encodeURIComponent(clientId)}`);
}
