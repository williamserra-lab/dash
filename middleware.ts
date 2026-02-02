import { NextRequest } from "next/server";
import { proxy, config } from "./src/proxy";

// Root middleware delegates to the single implementation in src/proxy.ts.
// Keep this file thin to avoid diverging auth logic.
export async function middleware(req: NextRequest) {
  return proxy(req);
}

export { config };
