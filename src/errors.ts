// ── Error Formatting ─────────────────────────────────────────────────────────

export function formatError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("rate limit") || msg.includes("429"))
    return "Rate limited! Try again in a minute.";
  if (msg.includes("401") || msg.includes("nauthorized"))
    return "Authentication issue with the AI provider. Let the admin know.";
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT"))
    return "Request timed out. Try again?";
  if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND"))
    return "Can't reach the AI server right now.";
  if (msg.includes("context length") || msg.includes("too long"))
    return "Conversation too long for this model. Try /clear.";
  if (msg.includes("500") || msg.includes("Internal Server Error"))
    return "AI server error. Try again, or /model to switch.";

  const short = msg.length > 300 ? msg.slice(0, 300) + "..." : msg;
  return `Error: ${short}\n\nTry again, or /clear to reset.`;
}
