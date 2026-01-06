import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");

  return NextResponse.json({
    uptime: process.uptime(),
    env: process.env.NODE_ENV || "unknown",
    storageMode: process.env.NEXTIA_STORAGE_MODE || "json",
    webhookCount: 0,
    ignoredMessages: 0,
    clientId,
  });
}
