import { Suspense } from "react";
import PageClient from "./page.client";

export const dynamic = "force-dynamic";

type RouteParams = { preorderId: string };
type PageProps = { params: Promise<RouteParams> };

export default async function Page(props: PageProps) {
  const { preorderId } = await props.params;
  return (
    <Suspense fallback={null}>
      <PageClient preorderId={preorderId} />
    </Suspense>
  );
}
