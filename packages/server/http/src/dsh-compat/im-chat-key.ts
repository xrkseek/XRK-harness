/**
 * Stable chatKey for IM ↔ Face session bind (AGT getEventHistoryKey grain).
 */

export function imChatKey(
  channel: string,
  raw: Record<string, unknown> | undefined,
  botId?: string,
): string {
  const ch = channel.trim() || "unknown";
  const body = raw ?? {};
  if (body.isGroup === true && body.group_id != null) {
    return `${ch}:g:${String(body.group_id)}`;
  }
  if (body.isDevice === true && body.device_id != null) {
    return `${ch}:d:${String(body.device_id)}`;
  }
  if (body.user_id != null) {
    return `${ch}:p:${String(body.user_id)}`;
  }
  const chatId =
    body.chatId ?? body.chat_id ?? body.conversationId ?? body.conversation_id;
  if (chatId != null && String(chatId).trim()) {
    return `${ch}:c:${String(chatId).trim()}`;
  }
  if (botId?.trim()) {
    return `${ch}:bot:${botId.trim()}`;
  }
  return `${ch}:default`;
}

/** Inbound text that requests a fresh Face session for this chatKey. */
export function isImNewSessionCommand(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^\/new\b/i.test(t)) return true;
  if (t === "新会话" || t.startsWith("新会话 ") || t.startsWith("新会话\n")) {
    return true;
  }
  return false;
}
