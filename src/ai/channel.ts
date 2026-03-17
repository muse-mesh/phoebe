// ── Output Channel ────────────────────────────────────────────────────────────
// Interface-agnostic abstraction for sending messages to different frontends
// (Telegram, web via Firestore, etc.).

export interface OutputChannel {
  /** Indicate that the agent is working (typing indicator). */
  sendTyping(): Promise<void>;

  /** Send a text message to the user. */
  sendText(text: string): Promise<void>;

  /** Send a specific tool action notification (e.g. "$ ls -la /home"). */
  sendToolAction(toolName: string, detail: string): Promise<void>;

  /** Called with incremental text chunks as they stream from the model. */
  onStreamChunk(text: string): void;

  /** Called when setting is complete, with the full final text. */
  onStreamDone(fullText: string): Promise<void>;

  /** Send a voice audio reply. */
  sendVoice(audio: Buffer): Promise<void>;

  /** Send an error message. */
  sendError(message: string): Promise<void>;
}
