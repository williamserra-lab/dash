import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ADMIN_SESSION_COOKIE = "nextia_admin_session";

// Canonical entrypoint.
// - If authenticated, go to /clientes
// - If not, go to /login
export default async function HomePage() {
  const jar = await cookies();
  const hasSession = Boolean(jar.get(ADMIN_SESSION_COOKIE)?.value);

  redirect(hasSession ? "/clientes" : "/login");
}
