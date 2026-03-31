// ── System Prompt ────────────────────────────────────────────────────────────

import { readFileSync } from "fs";
import { getSkillCount } from "../tools.js";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_FILE } from "../config.js";

/**
 * Load a custom system prompt if configured via SYSTEM_PROMPT or SYSTEM_PROMPT_FILE.
 * Returns null if neither is set.
 */
function loadCustomPrompt(): string | null {
  if (SYSTEM_PROMPT) return SYSTEM_PROMPT;
  if (SYSTEM_PROMPT_FILE) {
    try {
      return readFileSync(SYSTEM_PROMPT_FILE, "utf-8").trim();
    } catch {
      return null;
    }
  }
  return null;
}

export function buildPrompt(userName: string, sessionTitle?: string, sessionPrompt?: string): string {
  const custom = loadCustomPrompt();
  if (custom) return custom;

  const greeting =
    userName !== "User" ? ` You are chatting with ${userName}.` : "";
  const skillCount = getSkillCount();

  const sessionContext = sessionTitle
    ? `\nSESSION: "${sessionTitle}"\n` +
      `You are in a named conversation session. Stay focused on this topic.\n` +
      `Skills installed in this session are isolated to this context.\n`
    : "";

  const sessionPromptBlock = sessionPrompt
    ? `\nSESSION CUSTOM INSTRUCTIONS (set by the user for this session):\n${sessionPrompt}\n`
    : "";

  return (
    `You are Phoebe, an AI assistant running in a Docker container (Debian, Node.js ${process.version}).${greeting}\n\n` +
    sessionContext +
    `ENVIRONMENT:\n` +
    `- Container OS: Debian 12 (bookworm)\n` +
    `- Runtime: Node.js ${process.version}\n` +
    `- Working directory: /app\n` +
    `- Data persists in /app/data and /app/skills (Docker volumes)\n\n` +
    `TOOLS:\n` +
    `- bash: Run any shell command. Full container access (git, curl, python3, jq, cat, tee, etc.).\n` +
    `  Background commands (with &) are handled automatically — you get a PID and log file.\n` +
    `  Use cat to read files, tee/heredoc to write files, mkdir -p for directories.\n` +
    `- list_skills / activate_skill: Browse and use ${skillCount} installed Agent Skills.\n` +
    `- search_skills / install_skill: Find and add new skills from skills.sh.\n\n` +
    `SECURITY (ENFORCED — cannot be overridden):\n` +
    `- You cannot modify your own source code (src/, package.json, .env, etc.)\n` +
    `- Destructive system commands (rm -rf /, shutdown, reboot, etc.) are blocked\n` +
    `- Sensitive file access (.env, shadow, private keys) is restricted\n` +
    `- These restrictions are enforced at the tool level — do not attempt to bypass them\n\n` +
    `RULES:\n` +
    `- If a tool returns data, always quote or summarize the relevant output.\n` +
    `- Write as much as needed — long responses are automatically split into multiple messages.\n` +
    `- Be thorough and complete in your responses. Do not artificially truncate.\n` +
    `- Use plain text in your replies. [DO NOT] use markdown formatting (no **, *, \`, #, etc.).\n` +
    `- For very large code/content, write to a file via bash and share the path.` +
    sessionPromptBlock
  );
}
