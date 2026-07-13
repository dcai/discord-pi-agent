import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requiresOpenAiAudioTranscoding,
  transcodeAudioForOpenAi,
} from "./audio-transcoding";

const { spawnMock } = vi.hoisted(() => {
  return {
    spawnMock: vi.fn(),
  };
});

vi.mock("node:child_process", () => {
  return {
    spawn: spawnMock,
  };
});

function createAudio(overrides = {}) {
  return {
    filename: "voice-message.ogg",
    data: Buffer.from("audio-data"),
    mimeType: "audio/ogg",
    durationSecs: 12,
    ...overrides,
  };
}

function createFfmpegProcess() {
  const ffmpeg = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });

  return ffmpeg;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("audio-transcoding", () => {
  it("only converts formats outside OpenAI's documented input set", () => {
    expect(requiresOpenAiAudioTranscoding("voice.ogg")).toBe(true);
    expect(requiresOpenAiAudioTranscoding("recording.flac")).toBe(true);
    expect(requiresOpenAiAudioTranscoding("recording.mp3")).toBe(false);
    expect(requiresOpenAiAudioTranscoding("recording.webm")).toBe(false);
  });

  it("leaves an OpenAI-supported attachment unchanged", async () => {
    const audio = createAudio({
      filename: "recording.mp3",
      mimeType: "audio/mpeg",
    });

    await expect(transcodeAudioForOpenAi(audio, "ffmpeg")).resolves.toBe(audio);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("converts unsupported attachments to bounded MP3 output", async () => {
    const ffmpeg = createFfmpegProcess();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        ffmpeg.stdout.end(Buffer.from("transcoded-audio"));
        ffmpeg.emit("close", 0, null);
      });
      return ffmpeg;
    });

    await expect(
      transcodeAudioForOpenAi(createAudio(), "/usr/local/bin/ffmpeg"),
    ).resolves.toEqual({
      filename: "voice-message.mp3",
      data: Buffer.from("transcoded-audio"),
      mimeType: "audio/mpeg",
      durationSecs: 12,
    });
    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/local/bin/ffmpeg",
      expect.arrayContaining(["-c:a", "libmp3lame", "-f", "mp3"]),
      { stdio: "pipe" },
    );
  });
});
