// ── Speech-to-Text ───────────────────────────────────────────────────────────
// Converts audio to text using ElevenLabs Scribe V2 via fal.ai.
// Swappable: replace the implementation while keeping the exported interface.

import { FAL_API_KEY } from "./config.js";

const SCRIBE_URL = "https://fal.run/fal-ai/elevenlabs/speech-to-text/scribe-v2";

export interface STTResult {
  text: string;
  language?: string;
}

/**
 * Transcribe audio to text.
 * Accepts either a public URL (Telegram file link) or a raw Buffer.
 * For buffers, uploads to fal.ai storage first to get a URL.
 */
export async function speechToText(
  audio: string | Buffer,
  mediaType = "audio/ogg",
): Promise<STTResult> {
  if (!FAL_API_KEY) {
    throw new Error("FAL_KEY is required for speech-to-text");
  }

  let audioUrl: string;
  if (typeof audio === "string") {
    // Already a URL — pass directly
    audioUrl = audio;
  } else {
    // Buffer — upload to fal.ai storage
    audioUrl = await uploadToFalStorage(audio, mediaType);
  }

  const res = await fetch(SCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      tag_audio_events: false,
      diarize: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`STT failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    text?: string;
    language_code?: string;
  };
  return {
    text: (data.text ?? "").trim(),
    language: data.language_code,
  };
}

/** Upload a buffer to fal.ai CDN storage, returns a public URL. */
async function uploadToFalStorage(
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const ext = contentType.split("/")[1] ?? "bin";
  const res = await fetch(
    `https://fal.ai/api/fal/storage/upload/v3?file_name=audio.${ext}&content_type=${encodeURIComponent(contentType)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        "Content-Type": contentType,
      },
      body: new Uint8Array(buffer),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`fal upload failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("fal upload returned no URL");
  return data.url;
}
