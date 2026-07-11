import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  transcribeAudio,
  transcribeAudioAttachments,
} from "./audio-transcription";
import type { AudioAttachmentContent } from "./discord-attachments";
import type { ResolvedAudioTranscriptionConfig } from "./types";

function createConfig(
  overrides: Partial<ResolvedAudioTranscriptionConfig> = {},
): ResolvedAudioTranscriptionConfig {
  return {
    enabled: true,
    provider: "openai",
    model: "gpt-4o-mini-transcribe",
    apiKey: "sk-test-key",
    endpoint: null,
    ...overrides,
  };
}

function createAudio(
  overrides: Partial<AudioAttachmentContent> = {},
): AudioAttachmentContent {
  return {
    filename: "voice-message.ogg",
    data: Buffer.from("fake-audio-data"),
    mimeType: "audio/ogg",
    durationSecs: 12.5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("audio-transcription", () => {
  describe("transcribeAudio", () => {
    it("returns null when transcription is not enabled", async () => {
      const config = createConfig({ enabled: false });

      await expect(transcribeAudio(createAudio(), config)).resolves.toBeNull();
    });

    it("returns null when no API key is configured", async () => {
      const config = createConfig({ apiKey: null });

      await expect(transcribeAudio(createAudio(), config)).resolves.toBeNull();
    });

    it("transcribes audio via OpenAI endpoint", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        text: async () => "This is the transcribed text.",
      }));
      vi.stubGlobal("fetch", fetchMock);

      const config = createConfig();
      const result = await transcribeAudio(createAudio(), config);

      expect(result).toBe("This is the transcribed text.");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer sk-test-key");
      expect(init.body).toBeInstanceOf(FormData);
    });

    it("uses custom endpoint when configured", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        text: async () => "transcribed",
      }));
      vi.stubGlobal("fetch", fetchMock);

      const config = createConfig({
        endpoint: "https://custom.example.com/transcribe",
      });
      await transcribeAudio(createAudio(), config);

      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://custom.example.com/transcribe",
      );
    });

    it("returns null on API error", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => '{"error": "invalid api key"}',
      }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await transcribeAudio(createAudio(), createConfig());

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      vi.stubGlobal("fetch", async () => {
        throw new Error("network error");
      });

      const result = await transcribeAudio(createAudio(), createConfig());

      expect(result).toBeNull();
    });

    it("returns null when transcription is empty", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        text: async () => "   ",
      }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await transcribeAudio(createAudio(), createConfig());

      expect(result).toBeNull();
    });
  });

  describe("transcribeAudioAttachments", () => {
    it("returns null for empty input", async () => {
      await expect(
        transcribeAudioAttachments([], createConfig()),
      ).resolves.toBeNull();
    });

    it("transcribes multiple files and formats output", async () => {
      let callCount = 0;
      const fetchMock = vi.fn(async () => ({
        ok: true,
        text: async () => {
          callCount++;
          return `transcript ${callCount}`;
        },
      }));
      vi.stubGlobal("fetch", fetchMock);

      const config = createConfig();
      const audioFiles = [
        createAudio({ filename: "first.ogg", durationSecs: 30 }),
        createAudio({ filename: "second.mp3", durationSecs: null }),
      ];

      const result = await transcribeAudioAttachments(audioFiles, config);

      expect(result).toBe(
        "[Audio transcription: first.ogg (30s)]\ntranscript 1\n\n[Audio transcription: second.mp3]\ntranscript 2",
      );
    });

    it("includes failure note when one transcription fails", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "good transcript",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "error",
        });
      vi.stubGlobal("fetch", fetchMock);

      const audioFiles = [
        createAudio({ filename: "good.ogg" }),
        createAudio({ filename: "bad.ogg" }),
      ];

      const result = await transcribeAudioAttachments(
        audioFiles,
        createConfig(),
      );

      expect(result).toBe(
        "[Audio transcription: good.ogg (12s)]\ngood transcript\n\n[Audio file received: bad.ogg — transcription failed]",
      );
    });
  });
});
