import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

type Props = {
  /**
   * Next.js pode gerar `searchParams` como Promise (ex.: Next 15) nos tipos internos.
   * Para manter compatibilidade, aceitamos Promise e resolvemos aqui.
   */
  searchParams?: Promise<SearchParams>;
};

/**
 * Rota canônica de login.
 * Mantemos /admin-login como UI legada, mas padronizamos /login no contrato do V1.
 */
export default async function LoginPage({ searchParams }: Props) {
  const sp: SearchParams = (await searchParams) ?? {};

  const nextParam = sp.next;
  const next = Array.isArray(nextParam) ? nextParam[0] : nextParam;
  const qs = next ? `?next=${encodeURIComponent(next)}` : "";

  redirect(`/admin-login${qs}`);
}
