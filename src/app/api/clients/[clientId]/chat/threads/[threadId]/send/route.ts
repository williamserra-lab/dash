// src/app/api/clients/[clientId]/chat/threads/[threadId]/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import {
  appendMessage,
  estimateTokens,
  getCache,
  getThread,
  makeCacheKey,
  setCache,
  listMessages,
  updateThread,
} from "@/lib/chatV1/storage";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

function buildContext(messages: { role: string; content: string }[], maxChars = 4000) {
  const parts: string[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const piece = `[${m.role}] ${m.content}`.trim();
    if (!piece) continue;
    if (total + piece.length > maxChars) break;
    parts.unshift(piece);
    total += piece.length;
  }
  return parts.join("\n");
}

/**
 * POST /api/clients/:clientId/chat/threads/:threadId/send
 * Body: { content, contactId?, attachments? }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string; threadId: string }> }
): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req));
  if (denied) return denied;

  const { clientId: rawClientId, threadId: rawThreadId } = await ctx.params;
  const clientId = decodeURIComponent(String(rawClientId || "")).trim();
  const threadId = decodeURIComponent(String(rawThreadId || "")).trim();

  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });
  if (!threadId) return NextResponse.json({ error: "threadId_required" }, { status: 400 });

  // Strong tenant isolation: threadId must belong to clientId
  const thread = await getThread(clientId, threadId);
  if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const content = String(body.content || "").trim();
  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : undefined;
  const attachments = Array.isArray(body.attachments) ? body.attachments : undefined;

  if (!content) return NextResponse.json({ error: "content_required" }, { status: 400 });

  const now = new Date().toISOString();

  // Persist user message
  const userMsg = {
    id: randomUUID(),
    role: "user" as const,
    content,
    createdAt: now,
    contactId,
    attachments,
  };

  await appendMessage(clientId, threadId, userMsg);

  // Cache key based on recent context + prompt
  const history = await listMessages(clientId, threadId);
  const context = buildContext(history.slice(0, -1));
  const key = makeCacheKey({ clientId, threadId, contactId, prompt: content, context });

  const cached = await getCache(clientId, key);
  if (cached) {
    // Cache hit: do NOT charge credits. We still provide an estimate for transparency.
    const estimatedPrompt = estimateTokens(context + "\n" + content);
    const estimatedCompletion = estimateTokens(cached.value.assistant);
    const usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cached: true,
      isEstimated: false,
      estimatedTotalTokens: estimatedPrompt + estimatedCompletion,
    };

    const assistantMsg = {
      id: randomUUID(),
      role: "assistant" as const,
      content: cached.value.assistant,
      createdAt: new Date().toISOString(),
      contactId,
      usage,
    };

    await appendMessage(clientId, threadId, assistantMsg);
    await updateThread(clientId, threadId, { lastMessagePreview: assistantMsg.content.slice(0, 140) });
    return NextResponse.json({ assistant: assistantMsg, cached: true }, { status: 200 });
  }

  // Stub assistant behavior for now (backend integration is phase 2).
  const assistantText =
    `Entendi. Vou registrar isso para o cliente "${clientId}".\n\n` +
    `Mensagem: ${content}`;

  // No real provider call in this stub flow yet; keep usage as estimated.
  const promptTokens = estimateTokens(context + "\n" + content);
  const completionTokens = estimateTokens(assistantText);
  const usage = {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cached: false,
    isEstimated: true,
  };

  const assistantMsg = {
    id: randomUUID(),
    role: "assistant" as const,
    content: assistantText,
    createdAt: new Date().toISOString(),
    contactId,
    usage,
  };

  await appendMessage(clientId, threadId, assistantMsg);
  await updateThread(clientId, threadId, { lastMessagePreview: assistantMsg.content.slice(0, 140) });

  await setCache(clientId, { key, value: { assistant: assistantText, usage } });

  return NextResponse.json({ assistant: assistantMsg, cached: false }, { status: 200 });
}
