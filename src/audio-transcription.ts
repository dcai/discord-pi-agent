import { createModuleLogger } from "./logger";
import {
  requiresOpenAiAudioTranscoding,
  transcodeAudioForOpenAi,
} from "./audio-transcoding";
import type { AudioAttachmentContent } from "./discord-attachments";
import type { ResolvedAudioTranscriptionConfig } from "./types";

const logger = createModuleLogger("audio-transcription");

const DEFAULT_OPENAI_ENDPOINT =
  "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIPTION_REQUEST_TIMEOUT_MS = 60_000;

function getEndpoint(config: ResolvedAudioTranscriptionConfig): string {
  return config.endpoint ?? DEFAULT_OPENAI_ENDPOINT;
}

/**
 * Transcribe an audio attachment using an OpenAI-compatible audio
 * transcription API. Returns the transcribed text, or null if
 * transcription failed or is not configured.
 */
export async function transcribeAudio(
  audio: AudioAttachmentContent,
  config: ResolvedAudioTranscriptionConfig,
): Promise<string | null> {
  if (!config.enabled) {
    logger.debug(
      { filename: audio.filename },
      "audio transcription not enabled",
    );
    return null;
  }

  if (!config.apiKey) {
    logger.warn("audio transcription enabled but no API key configured");
    return null;
  }

  const endpoint = getEndpoint(config);
  const model = config.model;

  try {
    logger.info(
      {
        filename: audio.filename,
        mimeType: audio.mimeType,
        size: audio.data.length,
        durationSecs: audio.durationSecs,
        model,
        endpoint,
      },
      "transcribing audio",
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, TRANSCRIPTION_REQUEST_TIMEOUT_MS);
    try {
      let response = await requestTranscription(
        endpoint,
        config.apiKey,
        model,
        audio,
        config.transcriptionPrompt,
        controller.signal,
      );

      if (!response.ok) {
        let errorBody = await response.text();
        if (
          shouldRetryWithTranscodedAudio(config, audio, response, errorBody)
        ) {
          logger.info(
            { filename: audio.filename, status: response.status },
            "retrying unsupported audio format after transcoding",
          );
          const transcodedAudio = await transcodeAudioForOpenAi(
            audio,
            config.ffmpegPath,
          );
          response = await requestTranscription(
            endpoint,
            config.apiKey,
            model,
            transcodedAudio,
            config.transcriptionPrompt,
            controller.signal,
          );
          errorBody = response.ok ? "" : await response.text();
        }

        if (response.ok) {
          return readTranscriptionResponse(response, audio.filename);
        }

        logger.error(
          {
            filename: audio.filename,
            status: response.status,
            body: errorBody.slice(0, 500),
          },
          "audio transcription API error",
        );
        return null;
      }

      return readTranscriptionResponse(response, audio.filename);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    logger.error(
      { filename: audio.filename, error },
      "audio transcription request failed",
    );
    return null;
  }
}

async function requestTranscription(
  endpoint: string,
  apiKey: string,
  model: string,
  audio: AudioAttachmentContent,
  transcriptionPrompt: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audio.data)], {
    type: audio.mimeType,
  });
  formData.append("file", blob, audio.filename);
  formData.append("model", model);
  formData.append("response_format", "text");
  if (transcriptionPrompt) {
    formData.append("prompt", transcriptionPrompt);
  }

  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    signal,
  });
}

function shouldRetryWithTranscodedAudio(
  config: ResolvedAudioTranscriptionConfig,
  audio: AudioAttachmentContent,
  response: Response,
  errorBody: string,
): boolean {
  if (
    config.provider !== "openai" ||
    config.endpoint !== null ||
    !requiresOpenAiAudioTranscoding(audio.filename) ||
    ![400, 415, 422].includes(response.status)
  ) {
    return false;
  }

  const normalizedError = errorBody.toLowerCase();
  return (
    normalizedError.includes("unsupported audio") ||
    normalizedError.includes("unsupported file") ||
    normalizedError.includes("invalid audio") ||
    normalizedError.includes("invalid file") ||
    normalizedError.includes("audio format") ||
    normalizedError.includes("file format")
  );
}

async function readTranscriptionResponse(
  response: Response,
  filename: string,
): Promise<string | null> {
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    logger.warn({ filename }, "audio transcription returned empty text");
    return null;
  }

  logger.info(
    {
      filename,
      transcribedLength: trimmed.length,
    },
    "audio transcription complete",
  );

  return trimmed;
}

/**
 * Transcribe multiple audio attachments and return a combined text block.
 * Returns null if none of the transcriptions succeeded.
 */
export async function transcribeAudioAttachments(
  audioAttachments: AudioAttachmentContent[],
  config: ResolvedAudioTranscriptionConfig,
): Promise<string | null> {
  if (audioAttachments.length === 0) {
    return null;
  }

  const results: string[] = [];

  for (const audio of audioAttachments) {
    const transcript = await transcribeAudio(audio, config);
    if (transcript) {
      const durationNote =
        audio.durationSecs !== null
          ? ` (${formatDuration(audio.durationSecs)})`
          : "";
      results.push(
        `[Audio transcription: ${audio.filename}${durationNote}]\n${transcript}`,
      );
    } else {
      results.push(
        `[Audio file received: ${audio.filename} — transcription failed]`,
      );
    }
  }

  return results.length > 0 ? results.join("\n\n") : null;
}

function formatDuration(secs: number): string {
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}
