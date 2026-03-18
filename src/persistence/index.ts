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
  convKey,
  convPath,
  getContextMessages,
  addUserMessage,
  appendResponseMessages,
  addAssistantMessage,
} from "./conversations.js";

export {
  getSessionIndex,
  getActiveSession,
  getActiveSessionId,
  createSession,
  switchSession,
  renameSession,
  deleteSession,
  listSessions,
  autoTitleSession,
  touchSession,
  sessionSkillsPath,
  ensureSessionSkillsDir,
  saveAllSessionIndices,
} from "./sessions.js";
export type { Session, SessionIndex } from "./sessions.js";

// ── Persist All ──────────────────────────────────────────────────────────────

import { conversations, saveConversation } from "./conversations.js";
import { saveAllSessionIndices } from "./sessions.js";
import {
  saveChatModels,
  saveChatVoices,
  saveChatVoiceReply,
} from "./settings.js";
import { saveUserProfiles } from "./users.js";

export async function persistAll(): Promise<void> {
  // Save all loaded session conversations
  for (const key of conversations.keys()) {
    const idx = key.indexOf("_");
    if (idx === -1) continue;
    const chatId = Number(key.slice(0, idx));
    const sessionId = key.slice(idx + 1);
    await saveConversation(chatId, sessionId).catch(() => {});
  }
  await saveAllSessionIndices().catch(() => {});
  await saveChatModels().catch(() => {});
  await saveChatVoices().catch(() => {});
  await saveChatVoiceReply().catch(() => {});
  await saveUserProfiles().catch(() => {});
}
