import { spawn } from "node:child_process";
import { createModuleLogger } from "./logger";
import type { AudioAttachmentContent } from "./discord-attachments";

const logger = createModuleLogger("audio-transcoding");

const OPENAI_SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".m4a",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".wav",
  ".webm",
]);
const MAX_TRANSCODED_AUDIO_BYTES = 24_000_000;
const TRANSCODE_TIMEOUT_MS = 30_000;

export function requiresOpenAiAudioTranscoding(filename: string): boolean {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return !OPENAI_SUPPORTED_AUDIO_EXTENSIONS.has(extension);
}

export async function transcodeAudioForOpenAi(
  audio: AudioAttachmentContent,
  ffmpegPath: string,
): Promise<AudioAttachmentContent> {
  if (!requiresOpenAiAudioTranscoding(audio.filename)) {
    return audio;
  }

  logger.info(
    {
      filename: audio.filename,
      mimeType: audio.mimeType,
      size: audio.data.byteLength,
      ffmpegPath,
    },
    "transcoding audio for OpenAI",
  );

  const data = await transcodeToMp3(audio.data, ffmpegPath);
  const baseName = audio.filename.slice(0, audio.filename.lastIndexOf("."));

  return {
    ...audio,
    filename: `${baseName || "audio"}.mp3`,
    data,
    mimeType: "audio/mpeg",
  };
}

function transcodeToMp3(input: Buffer, ffmpegPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-map",
        "0:a:0",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "96k",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { stdio: "pipe" },
    );
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let errorOutput = "";
    let settled = false;

    const finish = (error?: Error, output?: Buffer): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve(output ?? Buffer.alloc(0));
      }
    };

    const timeout = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
      finish(new Error("ffmpeg transcoding timed out"));
    }, TRANSCODE_TIMEOUT_MS);

    if (!ffmpeg.stdin || !ffmpeg.stdout || !ffmpeg.stderr) {
      ffmpeg.kill("SIGKILL");
      finish(new Error("ffmpeg did not provide standard input/output streams"));
      return;
    }

    ffmpeg.once("error", (error) => {
      finish(new Error(`failed to start ffmpeg: ${error.message}`));
    });
    ffmpeg.stdin.once("error", (error) => {
      finish(new Error(`ffmpeg input failed: ${error.message}`));
    });
    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_TRANSCODED_AUDIO_BYTES) {
        ffmpeg.kill("SIGKILL");
        finish(
          new Error(
            `transcoded audio exceeds ${MAX_TRANSCODED_AUDIO_BYTES} bytes`,
          ),
        );
        return;
      }

      chunks.push(chunk);
    });
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      errorOutput = `${errorOutput}${chunk.toString()}`.slice(-1_000);
    });
    ffmpeg.once("close", (code, signal) => {
      if (code !== 0) {
        const detail = errorOutput.trim();
        finish(
          new Error(
            `ffmpeg exited with ${signal ? `signal ${signal}` : `code ${code}`}${detail ? `: ${detail}` : ""}`,
          ),
        );
        return;
      }

      finish(undefined, Buffer.concat(chunks));
    });

    ffmpeg.stdin.end(input);
  });
}
