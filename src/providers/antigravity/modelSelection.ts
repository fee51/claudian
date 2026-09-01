import { decodeAntigravitySelectionId } from './models';

/** Maps a Claudian selection id back to the runtime `agy --model` id. */
export function toAntigravityRuntimeModelId(
  selectionId: string,
): string | null {
  return decodeAntigravitySelectionId(selectionId);
}

export const DEFAULT_ANTIGRAVITY_EFFORT = 'medium';

export type AntigravityEffort = 'low' | 'medium' | 'high';

const VALID_EFFORT_LEVELS: ReadonlySet<string> = new Set([
  'low',
  'medium',
  'high',
]);

export function normalizeAntigravityEffort(value: unknown): AntigravityEffort | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return VALID_EFFORT_LEVELS.has(normalized)
    ? normalized as AntigravityEffort
    : null;
}