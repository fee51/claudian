/**
 * Antigravity model catalog helpers.
 *
 * Antigravity CLI (`agy`) exposes a flat list of runtime model ids
 * (`gemini-3.7-flash-high`, ...) with display labels. Claudian selection ids
 * are namespaced as `antigravity:<runtime-model-id>` so they never collide
 * with other providers' model ids.
 */

export const ANTIGRAVITY_MODEL_PREFIX = 'antigravity:';

export interface AntigravityDiscoveredModel {
  /** Runtime model id accepted by `agy --model <id>`. */
  id: string;
  /** Human-readable label from `agy models` output. */
  label: string;
}

export function isAntigravityModelSelectionId(model: string): boolean {
  return decodeAntigravitySelectionId(model) !== null;
}

export function encodeAntigravitySelectionId(id: string): string {
  const normalized = id.trim();
  return normalized ? `${ANTIGRAVITY_MODEL_PREFIX}${normalized}` : '';
}

export function decodeAntigravitySelectionId(
  selectionId: string,
): string | null {
  if (!selectionId.startsWith(ANTIGRAVITY_MODEL_PREFIX)) {
    return null;
  }
  const id = selectionId.slice(ANTIGRAVITY_MODEL_PREFIX.length).trim();
  return id || null;
}

export function normalizeAntigravityDiscoveredModels(
  value: unknown,
): AntigravityDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: AntigravityDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = firstString(record.id, record.modelId, record.model)?.trim();
    const label = firstString(record.label, record.displayName, record.name)?.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({ id, label: label || id });
  }
  return normalized;
}

/**
 * Parses the tab-separated `agy models` output:
 *   gemini-3.7-flash-high\tGemini 3.7 Flash (High)
 */
export function parseAntigravityModelsOutput(
  text: string,
): AntigravityDiscoveredModel[] {
  const models: AntigravityDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Fetching') || trimmed.startsWith('Available')) {
      continue;
    }
    const separator = trimmed.indexOf('\t');
    const id = separator >= 0 ? trimmed.slice(0, separator).trim() : '';
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const label = separator >= 0 ? trimmed.slice(separator + 1).trim() : id;
    models.push({ id, label: label || id });
  }
  return models;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}