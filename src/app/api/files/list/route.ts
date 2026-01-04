export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "deprecated",
      message: "Esta rota foi descontinuada. Use /api/admin/files/list (admin-only).",
    },
    { status: 410 }
  );
}
