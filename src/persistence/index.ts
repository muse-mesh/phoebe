// ── Persistence ──────────────────────────────────────────────────────────────
// Barrel export for all persistence modules + combined persistAll.

export { ensureDataDir } from "./store.js";

export {
  userProfiles,
  loadUserProfiles,
  trackUser,
  getUserName,
} from "./users.js";
export type { UserProfile } from "./users.js";

export {
  chatModels,
  loadChatModels,
  saveChatModels,
  getChatModel,
  TTS_VOICES,
  chatVoices,
  loadChatVoices,
  saveChatVoices,
  getChatVoice,
  resolveVoice,
  chatVoiceReply,
  loadChatVoiceReply,
  saveChatVoiceReply,
  isVoiceReplyEnabled,
} from "./settings.js";
export type { TTSVoice } from "./settings.js";

export {
  conversations,
  convPath,
  getContextMessages,
  addUserMessage,
  appendResponseMessages,
  addAssistantMessage,
} from "./conversations.js";

// ── Persist All ──────────────────────────────────────────────────────────────

import { conversations, saveConversation } from "./conversations.js";
import {
  saveChatModels,
  saveChatVoices,
  saveChatVoiceReply,
} from "./settings.js";
import { saveUserProfiles } from "./users.js";

export async function persistAll(): Promise<void> {
  for (const chatId of conversations.keys()) {
    await saveConversation(chatId).catch(() => {});
  }
  await saveChatModels().catch(() => {});
  await saveChatVoices().catch(() => {});
  await saveChatVoiceReply().catch(() => {});
  await saveUserProfiles().catch(() => {});
}
