// Voice-note transcription for seller onboarding. Any language (Hindi included)
// comes back in its own language; listing generation translates it to English.
import OpenAI, { toFile } from "openai";

const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-transcribe";
let client: OpenAI | null = null;

export async function transcribe(audio: File): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY || (process.env.MANDIX_FAKE_AI ?? process.env.MANDI_FAKE_AI) === "1") return null;
  try {
    client ??= new OpenAI();
    const file = await toFile(Buffer.from(await audio.arrayBuffer()), audio.name || "voice-note.webm", {
      type: audio.type || "audio/webm",
    });
    const res = await client.audio.transcriptions.create({ file, model: MODEL });
    return res.text?.trim() || null;
  } catch (err) {
    console.error("[transcribe] failed", err);
    return null;
  }
}
