import type { AgentService } from "./agent-service";
import { runAgentTurn } from "./agent-turn-runner";
import { createModuleLogger } from "./logger";
import { wrapXmlTag } from "./prompt-context";
import type { ResolvedDiscordGatewayConfig, TaskModelTarget } from "./types";

const logger = createModuleLogger("discord-reply-reflection");
const NO_FOLLOW_UP_PATTERN = /<no_follow_up\s*\/>/i;
const FOLLOW_UP_PATTERN = /<follow_up>([\s\S]*?)<\/follow_up>/i;
const FOLLOW_UP_TEST_TOKEN = "FOLLOW_UP_TEST";

const DEFAULT_REVIEW_PROMPT_MAX_CHARS = 12_000;

type GeneratePostReplyFollowUpInput = {
  config: ResolvedDiscordGatewayConfig;
  agentService: AgentService;
  promptText: string;
  assistantReply: string;
  discordMetadata?: string;
  sourceModel?: TaskModelTarget;
};

export async function generatePostReplyFollowUp(
  input: GeneratePostReplyFollowUpInput,
): Promise<string | null> {
  if (!input.config.replyReflection.enabled) {
    return null;
  }

  if (!input.assistantReply.trim()) {
    return null;
  }

  if (input.promptText.includes(FOLLOW_UP_TEST_TOKEN)) {
    return buildDeterministicTestFollowUp(
      input.config.replyReflection.maxFollowUpLength,
    );
  }

  try {
    const reviewSession = await input.agentService.createTemporarySession();

    try {
      await input.agentService.models.ensureSessionUsesModel(
        reviewSession,
        input.sourceModel ?? {
          provider: input.config.modelProvider,
          id: input.config.modelId,
        },
      );

      const reviewResponse = await runAgentTurn(
        reviewSession,
        buildPostReplyReviewPrompt(input),
      );

      return parsePostReplyReviewResponse(
        reviewResponse,
        input.config.replyReflection.maxFollowUpLength,
      );
    } finally {
      reviewSession.dispose();
    }
  } catch (error) {
    logger.warn({ error }, "post-reply review failed");
    return null;
  }
}

function buildPostReplyReviewPrompt(
  input: GeneratePostReplyFollowUpInput,
): string {
  const maxFollowUpLength = input.config.replyReflection.maxFollowUpLength;
  const sections = [
    [
      "Review the assistant reply below and decide whether sending one extra proactive Discord follow-up message would materially help the user.",
      "",
      "Only send a follow-up if at least one is true:",
      "- the reply contains a meaningful mistake",
      "- the reply missed an important caveat or required next step",
      "- the reply would likely confuse the user without a short clarification",
      "- the reply promised something important and needs one immediate correction or completion",
      "- the user would likely benefit from a short, sincere, supportive follow-up with warmth, positivity, empathy, and sensitivity because the context calls for it",
      `- the user explicitly asks you to send a follow-up or says this is a follow-up test, including the literal token ${FOLLOW_UP_TEST_TOKEN}`,
      "",
      "Supportive follow-ups are appropriate not only for stress or vulnerability, but also when a brief warm, encouraging, or affirming message would help the user feel supported, seen, or motivated in a real way.",
      "This can include moments where they are trying hard, making progress, asking for help, taking a risk, dealing with uncertainty, or starting a new long-term process such as learning a skill, building a habit, or taking up a hobby.",
      "In those cases, if the main reply is useful but emotionally flat, you may add a short confidence-building follow-up that acknowledges their effort, affirms that steady progress is enough, or gently encourages them to keep going.",
      "Keep it warm, human, and grounded. Do not sound clinical, cheesy, or overbearing. Do not invent feelings or facts.",
      "",
      `If the review turn finds any materially helpful addition worth telling the user, send it as the follow-up instead of withholding it just because the original reply was technically correct.`,
      "",
      `Do not send a follow-up for style tweaks, optional nice-to-have details, repetition, minor elaborations, or generic encouragement that adds no real value, unless the user explicitly asked for a follow-up test such as ${FOLLOW_UP_TEST_TOKEN}.`,
      "",
      "If no follow-up is needed, respond with exactly:",
      "<no_follow_up/>",
      "",
      "If a follow-up is needed, respond with exactly:",
      "<follow_up>",
      "...message to send...",
      "</follow_up>",
      "",
      `Rules for the follow-up message:`,
      `- keep it under ${maxFollowUpLength} characters`,
      "- add only new value",
      "- do not mention this review process",
      "- do not restate the whole original answer",
      "- sound natural, like one short extra message",
      "- when offering support, be specific, kind, positive, and concise",
    ].join("\n"),
  ];

  const hostInstructions = input.config.replyReflection.instructions?.trim();
  if (hostInstructions) {
    sections.push(
      [
        "Additional host instructions:",
        wrapXmlTag(
          "host_review_instructions",
          limitPromptSection(hostInstructions, DEFAULT_REVIEW_PROMPT_MAX_CHARS),
        ),
      ].join("\n"),
    );
  }

  if (input.discordMetadata?.trim()) {
    sections.push(input.discordMetadata.trim());
  }

  sections.push(
    wrapXmlTag(
      "user_message",
      limitPromptSection(input.promptText, DEFAULT_REVIEW_PROMPT_MAX_CHARS),
    ),
  );
  sections.push(
    wrapXmlTag(
      "assistant_reply",
      limitPromptSection(input.assistantReply, DEFAULT_REVIEW_PROMPT_MAX_CHARS),
    ),
  );

  return sections.join("\n\n");
}

function buildDeterministicTestFollowUp(maxFollowUpLength: number): string {
  const message =
    "Test follow-up: deterministic FOLLOW_UP_TEST trigger worked.";

  if (message.length <= maxFollowUpLength) {
    return message;
  }

  return message.slice(0, maxFollowUpLength).trim();
}

function parsePostReplyReviewResponse(
  response: string,
  maxFollowUpLength: number,
): string | null {
  const trimmedResponse = response.trim();

  if (!trimmedResponse || NO_FOLLOW_UP_PATTERN.test(trimmedResponse)) {
    return null;
  }

  const followUpMatch = trimmedResponse.match(FOLLOW_UP_PATTERN);
  const followUp = followUpMatch?.[1]?.trim();

  if (!followUp) {
    return null;
  }

  if (followUp.length > maxFollowUpLength) {
    logger.info(
      {
        maxFollowUpLength,
        responseLength: followUp.length,
      },
      "discarding post-reply follow-up that exceeded max length",
    );
    return null;
  }

  return followUp;
}

function limitPromptSection(value: string, maxLength: number): string {
  const trimmedValue = value.trim();

  if (trimmedValue.length <= maxLength) {
    return trimmedValue;
  }

  return `${trimmedValue.slice(0, maxLength)}\n\n[truncated for review]`;
}
