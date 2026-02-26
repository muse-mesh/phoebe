// ── Bot ──────────────────────────────────────────────────────────────────────
// Barrel export. Re-exports shared state from instance.ts and wires up
// commands + message handlers in the correct order.

export {
  bot,
  provider,
  startedAt,
  sendChunked,
  downloadTelegramFile,
} from "./instance.js";

import { bot } from "./instance.js";
import { DEFAULT_MODEL, MAX_STEPS, OWNER_ID } from "../config.js";
import { getCatalogInfo } from "../models.js";
import { getSkillCount } from "../tools.js";

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
    await bot.api.sendMessage(
      OWNER_ID,
      `Phoebe is online!\n` +
        `Model: ${DEFAULT_MODEL}\n` +
        `Tools: ${toolNames.join(", ")}\n` +
        `Skills: ${getSkillCount()}\n` +
        `Catalog: ${getCatalogInfo().count} models\n` +
        `Max steps: ${MAX_STEPS}\n` +
        `Node: ${process.version}`,
    );
  } catch (err) {
    console.warn("[phoebe] startup notification failed:", err);
  }
}
