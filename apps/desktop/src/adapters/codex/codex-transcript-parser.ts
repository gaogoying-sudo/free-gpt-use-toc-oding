import { STEP_CODES, StepError } from "../../types/step-codes";

export interface ParseLatestCodexReplyInput {
  transcript: string;
  lastSentToCodexRaw: string | null;
  previousForwardedReplyHash: string | null;
  promptFingerprintChars: number;
  maxTranscriptChars: number;
  minExtractedReplyLength: number;
  getHash: (value: string) => string;
}

export interface ParseLatestCodexReplyOutput {
  reply: string;
  strategy: "prompt-boundary" | "prompt-fingerprint" | "fallback-block";
  transcriptLength: number;
}

interface PromptBoundaryMatch {
  strategy: "prompt-boundary" | "prompt-fingerprint";
  boundaryIndex: number;
}

const UI_NOISE_PATTERNS: RegExp[] = [
  /^codex$/i,
  /^chat$/i,
  /^tasks?$/i,
  /^history$/i,
  /^extra high$/i,
  /^ide context$/i,
  /^local$/i,
  /^custom\(config\.toml\)$/i,
  /^follow up$/i,
  /^copy$/i,
  /^retry$/i,
  /^stop$/i,
  /^new chat$/i
];

const normalizeText = (value: string): string =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const trimTranscript = (value: string, maxChars: number): string =>
  value.length <= maxChars ? value : value.slice(value.length - maxChars);

const isNoiseLine = (line: string): boolean => {
  const normalized = line.trim();
  if (!normalized) {
    return true;
  }

  return UI_NOISE_PATTERNS.some((pattern) => pattern.test(normalized));
};

const stripNoiseEdges = (value: string): string => {
  const lines = value.split("\n");
  while (lines.length > 0 && isNoiseLine(lines[0])) {
    lines.shift();
  }
  while (lines.length > 0 && isNoiseLine(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join("\n").trim();
};

const tooSimilarToPrompt = (candidate: string, prompt: string): boolean => {
  if (!candidate || !prompt) {
    return false;
  }

  const normalizedCandidate = normalizeText(candidate).toLowerCase();
  const normalizedPrompt = normalizeText(prompt).toLowerCase();
  if (!normalizedCandidate || !normalizedPrompt) {
    return false;
  }

  if (normalizedCandidate === normalizedPrompt) {
    return true;
  }

  const shorter = Math.min(normalizedCandidate.length, normalizedPrompt.length);
  const longer = Math.max(normalizedCandidate.length, normalizedPrompt.length);
  const lengthRatio = shorter / longer;
  if (lengthRatio >= 0.9) {
    return normalizedCandidate.includes(normalizedPrompt) || normalizedPrompt.includes(normalizedCandidate);
  }

  return false;
};

const findPromptBoundary = (
  transcript: string,
  prompt: string,
  fingerprintChars: number
): PromptBoundaryMatch | null => {
  if (!prompt) {
    return null;
  }

  const directIndex = transcript.lastIndexOf(prompt);
  if (directIndex >= 0) {
    return {
      strategy: "prompt-boundary",
      boundaryIndex: directIndex + prompt.length
    };
  }

  const head = prompt.slice(0, fingerprintChars).trim();
  const tail = prompt.slice(-fingerprintChars).trim();
  if (!head || !tail) {
    return null;
  }

  let searchFrom = transcript.length;
  while (searchFrom >= 0) {
    const headIndex = transcript.lastIndexOf(head, searchFrom);
    if (headIndex < 0) {
      break;
    }

    const tailIndex = transcript.indexOf(tail, headIndex + head.length);
    if (tailIndex >= 0) {
      return {
        strategy: "prompt-fingerprint",
        boundaryIndex: tailIndex + tail.length
      };
    }

    searchFrom = headIndex - 1;
  }

  return null;
};

const pickFallbackBlock = (
  transcript: string,
  prompt: string,
  minLength: number
): string | null => {
  const blocks = transcript
    .split(/\n{2,}/)
    .map((part) => stripNoiseEdges(part))
    .filter((part) => part.length > 0);

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.length < minLength) {
      continue;
    }

    if (tooSimilarToPrompt(block, prompt)) {
      continue;
    }

    return block;
  }

  return null;
};

const validateExtractedReply = (
  reply: string,
  prompt: string,
  previousForwardedReplyHash: string | null,
  minLength: number,
  getHash: (value: string) => string
): void => {
  const normalizedReply = normalizeText(reply);
  if (!normalizedReply) {
    throw new StepError(STEP_CODES.CODEX_EXTRACTED_REPLY_INVALID, "parsed latest reply is empty");
  }

  if (normalizedReply.length < minLength) {
    throw new StepError(
      STEP_CODES.CODEX_EXTRACTED_REPLY_INVALID,
      `parsed latest reply is shorter than min length ${minLength}`,
      {
        length: normalizedReply.length
      }
    );
  }

  if (tooSimilarToPrompt(normalizedReply, prompt)) {
    throw new StepError(
      STEP_CODES.CODEX_EXTRACTED_REPLY_INVALID,
      "parsed latest reply is too similar to last sent prompt"
    );
  }

  if (previousForwardedReplyHash && getHash(normalizedReply) === previousForwardedReplyHash) {
    throw new StepError(
      STEP_CODES.CODEX_EXTRACTED_REPLY_INVALID,
      "parsed latest reply hash matches previous forwarded codex reply"
    );
  }
};

export const parseLatestCodexReply = (
  input: ParseLatestCodexReplyInput
): ParseLatestCodexReplyOutput => {
  const normalizedTranscript = normalizeText(
    trimTranscript(input.transcript, Math.max(1000, input.maxTranscriptChars))
  );
  const normalizedPrompt = input.lastSentToCodexRaw ? normalizeText(input.lastSentToCodexRaw) : "";

  if (!normalizedTranscript) {
    throw new StepError(
      STEP_CODES.CODEX_TRANSCRIPT_PARSE_FAILED,
      "full transcript is empty after normalization"
    );
  }

  const boundary = findPromptBoundary(
    normalizedTranscript,
    normalizedPrompt,
    Math.max(16, input.promptFingerprintChars)
  );

  let extracted = "";
  let strategy: ParseLatestCodexReplyOutput["strategy"] = "fallback-block";

  if (boundary) {
    extracted = stripNoiseEdges(normalizedTranscript.slice(boundary.boundaryIndex));
    strategy = boundary.strategy;
  }

  if (!extracted) {
    const fallback = pickFallbackBlock(
      normalizedTranscript,
      normalizedPrompt,
      Math.max(8, input.minExtractedReplyLength)
    );

    if (!fallback) {
      throw new StepError(
        STEP_CODES.CODEX_TRANSCRIPT_PARSE_FAILED,
        "failed to locate latest codex reply from full transcript",
        {
          strategyTried: boundary ? [boundary.strategy, "fallback-block"] : ["fallback-block"]
        }
      );
    }

    extracted = fallback;
    strategy = "fallback-block";
  }

  validateExtractedReply(
    extracted,
    normalizedPrompt,
    input.previousForwardedReplyHash,
    input.minExtractedReplyLength,
    input.getHash
  );

  return {
    reply: extracted,
    strategy,
    transcriptLength: normalizedTranscript.length
  };
};
