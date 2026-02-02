// src/lib/trace.ts
// Helpers de observabilidade (traceId + errorCode) para endpoints operacionais.

import { createId } from "@/lib/id";
import { NextResponse } from "next/server";

export type ErrorPayload = {
  ok: false;
  traceId: string;
  errorCode: string;
  message: string;
  details?: unknown;
};

export function newTraceId(prefix = "trc_"): string {
  return createId(prefix);
}

export function jsonError(
  status: number,
  input: { traceId: string; errorCode: string; message: string; details?: unknown }
) {
  const payload: ErrorPayload = {
    ok: false,
    traceId: input.traceId,
    errorCode: input.errorCode,
    message: input.message,
    details: input.details,
  };
  return NextResponse.json(payload, { status });
}
