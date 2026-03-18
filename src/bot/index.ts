// ── Bot ──────────────────────────────────────────────────────────────────────
// Barrel export. Re-exports shared state from instance.ts and wires up
// commands + message handlers in the correct order.

export {
  bot,
  mumeProvider,
  ollamaProvider,
  resolveProvider,
  isOllamaModel,
  startedAt,
  sendChunked,
  downloadTelegramFile,
} from "./instance.js";

import { bot } from "./instance.js";
import { DEFAULT_MODEL, MAX_STEPS, OWNER_ID } from "../config.js";
import { getCatalogInfo } from "../models.js";
import { getSkillCount } from "../tools.js";
import { getChatModel } from "../persistence/index.js";
import { isOllamaModel } from "./instance.js";
import { isOllamaEnabled } from "../config.js";
import log from "../logger.js";

// ── Register all handlers ────────────────────────────────────────────────────
// Import order matters: commands first (specific), then message handlers (general).

import { registerCommands } from "./commands.js";
import { registerMessageHandlers, toolNames } from "./handlers.js";

registerCommands();
registerMessageHandlers();

// ── Startup Notification ─────────────────────────────────────────────────────

export async function notifyOwner(): Promise<void> {
  if (!OWNER_ID) return;
  try {
    const currentModel = OWNER_ID ? getChatModel(OWNER_ID) : DEFAULT_MODEL;
    const catalogInfo = getCatalogInfo();
    const ollamaLine = isOllamaEnabled()
      ? `\nOllama: ${catalogInfo.ollamaCount} local models`
      : "";
    await bot.api.sendMessage(
      OWNER_ID,
      `Phoebe is online!\n` +
        `Model: ${currentModel}${isOllamaModel(currentModel) ? " (local)" : ""}\n` +
        `Tools: ${toolNames.join(", ")}\n` +
        `Skills: ${getSkillCount()}\n` +
        `Catalog: ${catalogInfo.count} models${ollamaLine}\n` +
        `Max steps: ${MAX_STEPS}\n` +
        `Node: ${process.version}`,
    );
  } catch (err) {
    log.warn("phoebe", "startup notification failed", { err: String(err) });
  }
}
