// ── Phoebe — AI Telegram Bot ─────────────────────────────────────────────────
// Entry point. Loads env, initialises persistence + skills, starts bot.

import "dotenv/config";

// Global error handlers — prevent silent crashes
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err);
});

import {
  DEFAULT_MODEL,
  MUME_BASE_URL,
  ALLOWED_IDS,
  MODELS,
  DATA_DIR,
  SKILLS_DIR,
} from "./config.js";
import {
  ensureDataDir,
  loadUserProfiles,
  loadChatModels,
  loadChatVoices,
  persistAll,
} from "./persistence.js";
import { discoverSkills } from "./tools";
import { bot, notifyOwner } from "./bot.js";

async function main(): Promise<void> {
  await ensureDataDir();
  await loadUserProfiles();
  await loadChatModels();
  await loadChatVoices();

  // Discover skills
  console.log("[phoebe] discovering skills...");
  await discoverSkills();

  // Start bot
  await bot.start({
    drop_pending_updates: true,
    onStart: async (botInfo) => {
      console.log(`[phoebe] @${botInfo.username} (${botInfo.id})`);
      console.log(`[phoebe] model: ${DEFAULT_MODEL}`);
      console.log(`[phoebe] gateway: ${MUME_BASE_URL}`);
      console.log(
        `[phoebe] allowlist: ${ALLOWED_IDS.length === 0 ? "everyone" : ALLOWED_IDS.join(", ")}`,
      );
      console.log(`[phoebe] data: ${DATA_DIR}`);
      console.log(`[phoebe] skills: ${SKILLS_DIR}`);
      console.log(`[phoebe] models: ${MODELS.length}`);
      await notifyOwner();
    },
  });
}

// Graceful shutdown
const stop = async (): Promise<void> => {
  console.log("[phoebe] shutting down...");
  await persistAll();
  bot.stop();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

main().catch((err) => {
  console.error("[phoebe] fatal:", err);
  process.exit(1);
});
