import type { AgentService } from "./agent-service";
import { runAgentTurn } from "./agent-turn-runner";
import { createModuleLogger } from "./logger";
import { wrapXmlTag } from "./prompt-context";
import type { ResolvedDiscordGatewayConfig, TaskModelTarget } from "./types";

const logger = createModuleLogger("audio-transcript-post-process");
const AUDIO_TRANSCRIPT_CLEANUP_CHUNK_MAX_CHARS = 12_000;
const AUDIO_TRANSCRIPT_INSTRUCTIONS_MAX_CHARS = 12_000;

type PostProcessAudioTranscriptInput = {
  agentService: AgentService;
  config: ResolvedDiscordGatewayConfig;
  filename: string;
  transcript: string;
  sourceModel?: TaskModelTarget;
};

export async function postProcessAudioTranscript(
  input: PostProcessAudioTranscriptInput,
): Promise<string | null> {
  const rawTranscript = input.transcript.trim();

  if (!rawTranscript) {
    return null;
  }

  logger.info(
    {
      filename: input.filename,
      rawTranscript,
    },
    "audio transcript received",
  );

  try {
    const session = await input.agentService.createTemporarySession();

    try {
      await input.agentService.models.ensureSessionUsesModel(
        session,
        input.sourceModel ?? {
          provider: input.config.modelProvider,
          id: input.config.modelId,
        },
      );

      const transcriptChunks = splitTranscriptForCleanup(rawTranscript);
      const cleanedChunks: string[] = [];

      for (const [index, transcriptChunk] of transcriptChunks.entries()) {
        const cleanedChunk = (
          await runAgentTurn(
            session,
            buildAudioTranscriptCleanupPrompt(
              input,
              transcriptChunk,
              index + 1,
              transcriptChunks.length,
            ),
          )
        ).trim();

        if (!cleanedChunk) {
          logger.warn(
            {
              filename: input.filename,
              rawTranscript,
              chunk: index + 1,
            },
            "audio transcript cleanup returned empty text",
          );
          return null;
        }

        cleanedChunks.push(cleanedChunk);
      }

      const cleanedTranscript = cleanedChunks.join("\n");
      logger.info(
        {
          filename: input.filename,
          rawTranscript,
          cleanedTranscript,
        },
        "audio transcript cleaned",
      );

      return cleanedTranscript;
    } finally {
      session.dispose();
    }
  } catch (error) {
    logger.warn(
      {
        filename: input.filename,
        rawTranscript,
        error,
      },
      "audio transcript cleanup failed",
    );
    return null;
  }
}

function buildAudioTranscriptCleanupPrompt(
  input: PostProcessAudioTranscriptInput,
  transcriptChunk: string,
  chunkNumber: number,
  chunkCount: number,
): string {
  const sections = [
    [
      "Clean this audio transcript.",
      "",
      "Rules:",
      "- Keep the same language as the input.",
      "- Do not translate.",
      "- Do not summarize.",
      "- Do not add new facts.",
      "- Fix obvious transcription mistakes, punctuation, spacing, and grammar.",
      "- Preserve names, code, commands, file paths, URLs, and technical terms.",
      "- If you are unsure, prefer the original wording over guessing.",
      "- Return only the cleaned transcript.",
    ].join("\n"),
  ];

  if (chunkCount > 1) {
    sections.push(
      `This is transcript part ${chunkNumber} of ${chunkCount}. Clean only this part.`,
    );
  }

  const customPrompt = input.config.audioTranscription.prompt?.trim();
  if (customPrompt) {
    sections.push(
      [
        "Additional host instructions:",
        wrapXmlTag(
          "host_audio_cleanup_instructions",
          limitPromptSection(
            customPrompt,
            AUDIO_TRANSCRIPT_INSTRUCTIONS_MAX_CHARS,
          ),
        ),
      ].join("\n"),
    );
  }

  sections.push(wrapXmlTag("audio_transcript", transcriptChunk));

  return sections.join("\n\n");
}

function splitTranscriptForCleanup(transcript: string): string[] {
  const chunks: string[] = [];
  let remaining = transcript;

  while (remaining.length > AUDIO_TRANSCRIPT_CLEANUP_CHUNK_MAX_CHARS) {
    const candidate = remaining.slice(
      0,
      AUDIO_TRANSCRIPT_CLEANUP_CHUNK_MAX_CHARS,
    );
    const lastWhitespace = Math.max(
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf(" "),
    );
    const splitAt = lastWhitespace > 0 ? lastWhitespace : candidate.length;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function limitPromptSection(value: string, maxLength: number): string {
  const trimmedValue = value.trim();

  if (trimmedValue.length <= maxLength) {
    return trimmedValue;
  }

  return `${trimmedValue.slice(0, maxLength)}\n\n[truncated for audio cleanup]`;
}
