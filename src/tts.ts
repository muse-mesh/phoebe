// ── Text-to-Speech ───────────────────────────────────────────────────────────
// Converts text to audio using ElevenLabs TTS Turbo v2.5 via fal.ai.
// Swappable: replace the implementation while keeping the exported interface.

import { FAL_API_KEY } from "./config.js";

const TTS_URL = "https://fal.run/fal-ai/elevenlabs/tts/turbo-v2.5";

/** Max characters to synthesize. Longer replies fall back to text. */
const MAX_TTS_CHARS = 3000;

/**
 * Convert text to speech audio.
 * @returns Audio buffer (MP3), or null if TTS is unavailable or text too long.
 */
export async function textToSpeech(
  text: string,
  voice = "Aria",
): Promise<Buffer | null> {
  if (!FAL_API_KEY || !text.trim() || text.length > MAX_TTS_CHARS) return null;

  try {
    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice,
        stability: 0.5,
        similarity_boost: 0.75,
        speed: 1,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[tts] API error (${res.status}): ${body.slice(0, 300)}`);
      return null;
    }

    const data = (await res.json()) as {
      audio?: { url?: string };
    };

    const audioUrl = data.audio?.url;
    if (!audioUrl) {
      console.error("[tts] no audio URL in response");
      return null;
    }

    // Download the generated audio file
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      console.error(`[tts] audio download failed (${audioRes.status})`);
      return null;
    }

    const buffer = Buffer.from(await audioRes.arrayBuffer());
    console.log(`[tts] generated ${buffer.length} bytes`);
    return buffer;
  } catch (err) {
    console.error("[tts] error:", err);
    return null;
  }
}
