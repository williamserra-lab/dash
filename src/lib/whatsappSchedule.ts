// src/lib/whatsappSchedule.ts
import { PaceProfile, getWhatsAppOperationalPolicy } from "./whatsappOperationalPolicy";

function parseHHMM(hhmm: string): { h: number; m: number } {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hhmm);
  if (!m) return { h: 9, m: 0 };
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const mi = Math.max(0, Math.min(59, Number(m[2])));
  return { h, m: mi };
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function setLocalTime(base: Date, hhmm: string): Date {
  const { h, m } = parseHHMM(hhmm);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

export function computeFirstNotBefore(now: Date): Date {
  const policy = getWhatsAppOperationalPolicy();
  const day = startOfLocalDay(now);
  const start = setLocalTime(day, policy.window.start);
  const end = setLocalTime(day, policy.window.end);

  if (now < start) return start;
  if (now > end) {
    const tomorrow = new Date(day);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return setLocalTime(tomorrow, policy.window.start);
  }
  return now;
}

export function buildNotBeforeSchedule(params: {
  count: number;
  profile?: PaceProfile;
  startAt?: Date;
}): string[] {
  const policy = getWhatsAppOperationalPolicy();
  const profile = params.profile ?? policy.defaultPaceProfile;
  const pace = policy.pace[profile];

  const base = params.startAt ? new Date(params.startAt) : new Date();
  let cursor = computeFirstNotBefore(base).getTime();

  const out: string[] = [];
  for (let i = 0; i < params.count; i++) {
    // intervalo normal
    const step = randInt(pace.minSecondsBetween, pace.maxSecondsBetween);
    cursor += step * 1000;

    // pausa longa
    if (pace.longPauseEvery > 0 && (i + 1) % pace.longPauseEvery === 0) {
      const lp = randInt(pace.longPauseMinSeconds, pace.longPauseMaxSeconds);
      cursor += lp * 1000;
    }

    out.push(new Date(cursor).toISOString());
  }

  return out;
}
