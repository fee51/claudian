import type { UsageInfo } from '../../../core/types';
import type { AntigravityUsage } from '../normalization/antigravityEventNormalization';

export const ANTIGRAVITY_FALLBACK_CONTEXT_WINDOW = 1_000_000;

export function buildAntigravityUsageInfo(
  usage: AntigravityUsage,
  model: string,
  contextWindow: number = ANTIGRAVITY_FALLBACK_CONTEXT_WINDOW,
): UsageInfo {
  const contextTokens = usage.totalTokens
    ?? (usage.inputTokens + usage.outputTokens);
  const safeContextWindow = contextWindow > 0 ? contextWindow : ANTIGRAVITY_FALLBACK_CONTEXT_WINDOW;
  return {
    model,
    inputTokens: usage.inputTokens,
    ...(usage.cacheReadTokens ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    contextWindow: safeContextWindow,
    contextWindowIsAuthoritative: false,
    contextTokens,
    percentage: Math.min(100, Math.round((contextTokens / safeContextWindow) * 1000) / 10),
  };
}