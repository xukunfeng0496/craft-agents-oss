/**
 * Session title generation utilities.
 *
 * Shared helpers for building title prompts and validating results.
 * Actual title generation is handled by agent classes using their respective SDKs:
 * - ClaudeAgent: Uses Claude SDK query()
 * - CodexAgent: Uses OpenAI SDK
 */

/**
 * Build a prompt for generating a session title from a user message.
 *
 * @param message - The user's message to generate a title from
 * @returns Formatted prompt string
 */
export function buildTitlePrompt(message: string, language?: string): string {
  const snippet = message.slice(0, 500);
  const langInstruction = language
    ? `Reply in the same language as the user's message (language code: ${language}).`
    : '';
  return [
    'What is the user trying to do? Reply with ONLY a short task description (2-5 words).',
    'Start with a verb. Use plain text only - no markdown.',
    ...(langInstruction ? [langInstruction] : []),
    'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Explain codebase structure"',
    '',
    'User: ' + snippet,
    '',
    'Task:',
  ].join('\n');
}

/**
 * Build a prompt for regenerating a session title from recent messages.
 *
 * @param recentUserMessages - The last few user messages
 * @param lastAssistantResponse - The most recent assistant response
 * @returns Formatted prompt string
 */
export function buildRegenerateTitlePrompt(
  recentUserMessages: string[],
  lastAssistantResponse: string,
  language?: string,
): string {
  const userContext = recentUserMessages
    .map((msg) => msg.slice(0, 300))
    .join('\n\n');
  const assistantSnippet = lastAssistantResponse.slice(0, 500);
  const langInstruction = language
    ? `Reply in the same language as the conversation (language code: ${language}).`
    : '';

  return [
    'Based on these recent messages, what is the current focus of this conversation?',
    'Reply with ONLY a short task description (2-5 words).',
    'Start with a verb. Use plain text only - no markdown.',
    ...(langInstruction ? [langInstruction] : []),
    'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Explain codebase structure"',
    '',
    'Recent user messages:',
    userContext,
    '',
    'Latest assistant response:',
    assistantSnippet,
    '',
    'Current focus:',
  ].join('\n');
}

/**
 * Validate and clean a generated title.
 *
 * @param title - The raw title from the model
 * @returns Cleaned title, or null if invalid
 */
export function validateTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim();
  if (trimmed && trimmed.length > 0 && trimmed.length < 100) {
    return trimmed;
  }
  return null;
}

const GENERIC_FOLLOW_UP_PATTERNS = [
  /^(ok|okay|thanks|thank you|continue|go on)$/i,
  /^(好的|好|行|继续|继续修复|直接修复|分析下|看下|看看|排查下)$/u,
  /^(没有生效|还没生效|好像也没有生效|似乎没有生效)$/u,
];

const ENGLISH_LEADING_PHRASES = [
  /^(please|kindly)\s+/i,
  /^(can|could|would)\s+you\s+/i,
  /^help\s+me\s+(?:to\s+)?/i,
  /^i\s+(?:want|need|would\s+like)\s+to\s+/i,
  /^(how\s+do\s+i|how\s+to)\s+/i,
  /^(is|are|does|do|did)\s+(?:this|that|it|the)\s+/i,
];

const CHINESE_LEADING_PHRASES = [
  /^(请问|请|麻烦你|麻烦|帮我|帮忙|看下|看看|分析下|排查下|修复下|直接|继续)\s*/u,
  /^(现在的|当前的|这个|这个会话的)\s*/u,
  /^(是不是|是否|为什么|怎么|如何|能不能|可不可以)\s*/u,
];

function normalizeTitleSource(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'“”‘’【】[\](){}<>:：,，.!！？?、\-]+/u, '')
    .replace(/[\s"'“”‘’【】[\](){}<>]+$/u, '');
}

function stripLeadingPhrases(text: string): string {
  let stripped = text;

  for (const pattern of ENGLISH_LEADING_PHRASES) {
    stripped = stripped.replace(pattern, '');
  }

  for (const pattern of CHINESE_LEADING_PHRASES) {
    stripped = stripped.replace(pattern, '');
  }

  return stripped.trim();
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text);
}

function shortenTitleCandidate(text: string): string {
  if (containsCjk(text)) {
    return text
      .replace(/[。！？!?]+$/u, '')
      .slice(0, 18)
      .trim();
  }

  const words = text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  return words.slice(0, 5).join(' ').trim();
}

function scoreTitleCandidate(text: string): number {
  if (!text) return Number.NEGATIVE_INFINITY;

  let score = Math.min(text.length, 80);

  if (GENERIC_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(text))) {
    score -= 100;
  }

  if (containsCjk(text) || /[a-z]/i.test(text)) {
    score += 10;
  }

  if (/(修复|排查|分析|解释|实现|优化|重构|新增|删除|检查|处理|解决|定位)/u.test(text)) {
    score += 10;
  }

  if (/\b(fix|debug|analyze|explain|implement|optimize|refactor|add|remove|investigate)\b/i.test(text)) {
    score += 10;
  }

  return score;
}

function firstUsefulClause(text: string): string {
  const clauses = text
    .split(/[\n\r]+|[，,]+|[。！？!?；;]+/u)
    .map((part) => normalizeTitleSource(part))
    .filter(Boolean);

  return clauses[0] ?? text;
}

function buildExtractiveTitle(text: string): string | null {
  const normalized = normalizeTitleSource(text);
  if (!normalized) return null;

  const clause = firstUsefulClause(normalized);
  const stripped = stripLeadingPhrases(clause);
  const shortened = shortenTitleCandidate(stripped || clause);

  if (!shortened || shortened.length < 2) {
    return null;
  }

  return validateTitle(shortened);
}

function selectBestTitleSource(candidates: string[]): string | null {
  let best: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const normalized = normalizeTitleSource(candidate);
    if (!normalized) continue;

    const score = scoreTitleCandidate(normalized);
    if (score > bestScore) {
      best = normalized;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Build a local fallback title when model-based generation fails.
 * Extracts a concise clause from the user's message so sessions still get
 * a usable title even when the provider is unavailable.
 */
export function buildFallbackTitle(message: string): string | null {
  return buildExtractiveTitle(message);
}

/**
 * Build a local fallback title from recent conversation context.
 * Prefers the most informative recent user message and falls back to the
 * latest assistant response if user messages are too generic.
 */
export function buildFallbackRegeneratedTitle(
  recentUserMessages: string[],
  lastAssistantResponse: string,
): string | null {
  const representativeUserMessage = selectBestTitleSource(recentUserMessages);
  const fromUserMessage = representativeUserMessage
    ? buildExtractiveTitle(representativeUserMessage)
    : null;

  if (fromUserMessage) {
    return fromUserMessage;
  }

  return buildExtractiveTitle(lastAssistantResponse);
}
