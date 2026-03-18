// ── Persistence Store ─────────────────────────────────────────────────────────
// Low-level JSON read/write helpers shared by all persistence modules.

import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "../config.js";

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(path.join(DATA_DIR, "conversations"), { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, "sessions"), { recursive: true });
}

export async function saveJSON(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function loadJSON<T = unknown>(
  filePath: string,
): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
