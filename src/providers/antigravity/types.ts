import type { Conversation } from '../../core/types';

export interface AntigravityProviderState {
  conversationId?: string;
}

export function getAntigravityState(
  providerState: Record<string, unknown>,
): AntigravityProviderState {
  return {
    ...(typeof providerState.conversationId === 'string' && providerState.conversationId.trim()
      ? { conversationId: providerState.conversationId }
      : {}),
  };
}

/** Clears native resume state so environment/CLI changes cannot resume stale ts. */
export function clearAntigravityResumeState(
  conversation: Conversation,
): boolean {
  if (!conversation.providerState) {
    return false;
  }
  const state = getAntigravityState(conversation.providerState);
  if (!state.conversationId) {
    return false;
  }
  delete conversation.providerState.conversationId;
  return true;
}