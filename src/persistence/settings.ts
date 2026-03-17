// ── Per-Chat Settings ────────────────────────────────────────────────────────
// Model overrides, TTS voice, and voice-reply toggle per chat.

import path from "path";
import { DATA_DIR, DEFAULT_MODEL } from "../config.js";
import { saveJSON, loadJSON } from "./store.js";
import log from "../logger.js";

// ── Chat Model Overrides ─────────────────────────────────────────────────────

export const chatModels = new Map<number, string>();

export async function loadChatModels(): Promise<void> {
  const data = await loadJSON<Record<string, string>>(
    path.join(DATA_DIR, "models.json"),
  );
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) chatModels.set(Number(k), v);
  }
  log.info("persist", `loaded ${chatModels.size} model overrides`);
}

export async function saveChatModels(): Promise<void> {
  await saveJSON(
    path.join(DATA_DIR, "models.json"),
    Object.fromEntries(chatModels),
  );
}

export function getChatModel(chatId: number): string {
  return chatModels.get(chatId) ?? DEFAULT_MODEL;
}

// ── Chat Voice Overrides ─────────────────────────────────────────────────────

export const TTS_VOICES = [
  "Aria",
  "Roger",
  "Sarah",
  "Laura",
  "Charlie",
  "George",
  "Callum",
  "River",
  "Liam",
  "Charlotte",
  "Alice",
  "Matilda",
  "Will",
  "Jessica",
  "Eric",
  "Chris",
  "Brian",
  "Daniel",
  "Lily",
  "Bill",
  "Rachel",
] as const;

export type TTSVoice = (typeof TTS_VOICES)[number];

export const DEFAULT_VOICE: TTSVoice = "Aria";

export const chatVoices = new Map<number, TTSVoice>();

export async function loadChatVoices(): Promise<void> {
  const data = await loadJSON<Record<string, string>>(
    path.join(DATA_DIR, "voices.json"),
  );
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data))
      chatVoices.set(Number(k), v as TTSVoice);
  }
  log.info("persist", `loaded ${chatVoices.size} voice overrides`);
}

export async function saveChatVoices(): Promise<void> {
  await saveJSON(
    path.join(DATA_DIR, "voices.json"),
    Object.fromEntries(chatVoices),
  );
}

export function getChatVoice(chatId: number): TTSVoice {
  return chatVoices.get(chatId) ?? DEFAULT_VOICE;
}

export function resolveVoice(input: string): TTSVoice | null {
  const lower = input.trim().toLowerCase();
  return TTS_VOICES.find((v) => v.toLowerCase() === lower) ?? null;
}

// ── Chat Voice Reply ─────────────────────────────────────────────────────────

export const chatVoiceReply = new Map<number, boolean>();

export async function loadChatVoiceReply(): Promise<void> {
  const data = await loadJSON<Record<string, boolean>>(
    path.join(DATA_DIR, "voice-reply.json"),
  );
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data))
      chatVoiceReply.set(Number(k), Boolean(v));
  }
  log.info("persist", `loaded ${chatVoiceReply.size} voice reply settings`);
}

export async function saveChatVoiceReply(): Promise<void> {
  await saveJSON(
    path.join(DATA_DIR, "voice-reply.json"),
    Object.fromEntries(chatVoiceReply),
  );
}

export function isVoiceReplyEnabled(chatId: number): boolean {
  return chatVoiceReply.get(chatId) ?? false;
}
