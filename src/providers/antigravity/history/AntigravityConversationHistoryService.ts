import type {
  ProviderConversationHistoryService,
  ProviderHistoryPathContext,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';

/**
 * Antigravity has no per-conversation native transcript files; Claudian owns
 * conversation history and persists the native conversation id in
 * `providerState.conversationId` for resume (`agy --conversation <id>`).
 */
export class AntigravityConversationHistoryService
  implements ProviderConversationHistoryService {
  async hydrateConversationHistory(
    _conversation: Conversation,
    _vaultPath: string | null,
    _pathContext?: ProviderHistoryPathContext,
  ): Promise<void> {
    // No native transcript to hydrate; Claudian stores conversation messages.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    if (!conversation) {
      return null;
    }
    const providerState = isRecord(conversation.providerState)
      ? conversation.providerState
      : {};
    return getString(providerState.conversationId);
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
    _vaultPath?: string | null,
    _pathContext?: ProviderHistoryPathContext,
  ): Record<string, unknown> {
    // Forking is not supported for Antigravity.
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}