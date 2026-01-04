export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "deprecated",
      message: "Esta rota foi descontinuada. Use /api/admin/files/upload (admin-only).",
    },
    { status: 410 }
  );
}
