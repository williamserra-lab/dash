// src/lib/followupsRunner.ts
// Thin wrapper module to provide a stable import surface for followups runner.
// Business logic remains in src/lib/followups.ts.

export type Vertical = "delivery" | "appointments";

export type RunInput = {
  clientId?: string;
  vertical: Vertical;
  nowIso?: string; // for tests
};

export { runFollowupsAndQueue } from "@/lib/followups";
