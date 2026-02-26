// ── User Profiles ────────────────────────────────────────────────────────────

import path from "path";
import { DATA_DIR } from "../config.js";
import { saveJSON, loadJSON } from "./store.js";

export interface UserProfile {
  id: number;
  firstName: string;
  username: string;
  firstSeen: string;
  lastSeen: string;
}

interface TelegramFrom {
  id: number;
  first_name?: string;
  username?: string;
}

export const userProfiles = new Map<number, UserProfile>();

export async function loadUserProfiles(): Promise<void> {
  const data = await loadJSON<UserProfile[]>(path.join(DATA_DIR, "users.json"));
  if (Array.isArray(data)) {
    for (const u of data) userProfiles.set(u.id, u);
  }
  console.log(`[persist] loaded ${userProfiles.size} user profiles`);
}

export async function saveUserProfiles(): Promise<void> {
  await saveJSON(
    path.join(DATA_DIR, "users.json"),
    Array.from(userProfiles.values()),
  );
}

export function trackUser(from: TelegramFrom): void {
  const existing = userProfiles.get(from.id);
  userProfiles.set(from.id, {
    id: from.id,
    firstName: from.first_name ?? "",
    username: from.username ?? "",
    firstSeen: existing?.firstSeen ?? new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  });
  saveUserProfiles().catch(() => {});
}

export function getUserName(from?: TelegramFrom): string {
  if (!from) return "User";
  const profile = userProfiles.get(from.id);
  return profile?.firstName || from.first_name || from.username || "User";
}
