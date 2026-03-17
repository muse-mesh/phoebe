// ── Firestore Channel ─────────────────────────────────────────────────────────
// OutputChannel implementation for the web interface via Firestore.
// Writes streaming chunks to a status doc; final messages to the messages subcollection.

import { getDb, statusDocPath, Timestamp } from "../firestore.js";
import type { OutputChannel } from "./channel.js";
import log from "../logger.js";

const CHUNK_THROTTLE_MS = 300;

export class FirestoreChannel implements OutputChannel {
  private pendingText = "";
  private lastFlush = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private sessionId: string,
    private chatId: string,
  ) {}

  private get statusRef() {
    return getDb().doc(statusDocPath(this.sessionId, this.chatId));
  }

  async sendTyping(): Promise<void> {
    await this.statusRef.set(
      { state: "typing", updatedAt: Timestamp.now() },
      { merge: true },
    );
  }

  async sendText(text: string): Promise<void> {
    // Intermediate text (tool step summaries) → append to pending and flush
    this.pendingText += (this.pendingText ? "\n\n" : "") + text;
    await this.flushPendingText();
  }

  async sendToolAction(toolName: string, detail: string): Promise<void> {
    await this.statusRef.set(
      {
        state: "tool",
        toolLabel: `${toolName}: ${detail}`,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  onStreamChunk(chunk: string): void {
    this.pendingText += chunk;

    const now = Date.now();
    if (now - this.lastFlush >= CHUNK_THROTTLE_MS) {
      this.flushPendingTextSync();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushPendingTextSync();
      }, CHUNK_THROTTLE_MS);
    }
  }

  async onStreamDone(text: string): Promise<void> {
    // Clear any pending flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Final text may include the last chunk already accumulated
    // The caller (web listener) writes the actual message doc
    // Here we just update the status to idle with the full final text
    await this.statusRef.set(
      {
        state: "idle",
        pendingText: "",
        finalText: text,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  async sendVoice(_audio: Buffer): Promise<void> {
    // Voice not supported in web channel (for now)
  }

  async sendError(message: string): Promise<void> {
    await this.statusRef.set(
      {
        state: "error",
        error: message,
        pendingText: "",
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async flushPendingText(): Promise<void> {
    this.lastFlush = Date.now();
    await this.statusRef
      .set(
        {
          state: "streaming",
          pendingText: this.pendingText,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )
      .catch((e) =>
        log.error("firestore", "flush error", { err: (e as Error).message }),
      );
  }

  private flushPendingTextSync(): void {
    this.lastFlush = Date.now();
    this.statusRef
      .set(
        {
          state: "streaming",
          pendingText: this.pendingText,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )
      .catch((e) =>
        log.error("firestore", "flush error", { err: (e as Error).message }),
      );
  }
}
