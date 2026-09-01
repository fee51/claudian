import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import {
  readStoredBoolean,
  readStoredString,
} from '../../core/providers/settings/storedSettings';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';
import {
  type AntigravityDiscoveredModel,
  isAntigravityModelSelectionId,
  normalizeAntigravityDiscoveredModels,
} from './models';
import {
  type AntigravityEffort,
  normalizeAntigravityEffort,
} from './modelSelection';

export interface PersistedAntigravityProviderSettings {
  autoApprovePermissions: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  defaultEffort: AntigravityEffort | '';
  discoveredModels: AntigravityDiscoveredModel[];
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  project: string;
  visibleModels: string[];
}

export type AntigravityProviderSettings = PersistedAntigravityProviderSettings;

export const DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS: Readonly<PersistedAntigravityProviderSettings> =
  Object.freeze({
    autoApprovePermissions: false,
    cliPath: '',
    cliPathsByHost: {},
    defaultEffort: 'medium',
    discoveredModels: [],
    enabled: false,
    environmentHash: '',
    environmentVariables: '',
    project: '',
    visibleModels: [],
  });

export function normalizeAntigravityVisibleModels(
  value: unknown,
  discoveredModels: AntigravityDiscoveredModel[] = [],
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const knownIds = new Set(discoveredModels.map(model => model.id));
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    const runtimeId = trimmed.startsWith('antigravity:')
      ? trimmed.slice('antigravity:'.length)
      : trimmed;
    if (!runtimeId || !isAntigravityModelSelectionId(`antigravity:${runtimeId}`)) {
      continue;
    }
    if (knownIds.size > 0 && !knownIds.has(runtimeId)) {
      continue;
    }
    if (seen.has(runtimeId)) {
      continue;
    }
    seen.add(runtimeId);
    normalized.push(`antigravity:${runtimeId}`);
  }
  return normalized;
}

export function getAntigravityProviderSettings(
  settings: Record<string, unknown>,
): AntigravityProviderSettings {
  const config = getProviderConfig(settings, 'antigravity');
  const cliPathsByHost = normalizeHostnameStringMap(config.cliPathsByHost);
  const discoveredModels = normalizeAntigravityDiscoveredModels(config.discoveredModels);
  const visibleModels = normalizeAntigravityVisibleModels(config.visibleModels, discoveredModels);

  return {
    autoApprovePermissions: readStoredBoolean(
      config.autoApprovePermissions,
      DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.autoApprovePermissions,
    ),
    cliPath: readStoredString(config.cliPath, DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath),
    cliPathsByHost,
    defaultEffort: normalizeAntigravityEffort(config.defaultEffort) ?? 'medium',
    discoveredModels,
    enabled: readStoredBoolean(config.enabled, DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.enabled),
    environmentHash: readStoredString(
      config.environmentHash,
      DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.environmentHash,
    ),
    environmentVariables: readStoredString(
      config.environmentVariables,
      getProviderEnvironmentVariables(settings, 'antigravity')
        ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.environmentVariables,
    ),
    project: readStoredString(config.project, DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.project),
    visibleModels,
  };
}

export function updateAntigravityProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<AntigravityProviderSettings>,
): AntigravityProviderSettings {
  const current = getAntigravityProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  const nextDiscoveredModels = normalizeAntigravityDiscoveredModels(
    updates.discoveredModels ?? current.discoveredModels,
  );
  const nextVisibleModels = normalizeAntigravityVisibleModels(
    updates.visibleModels ?? current.visibleModels,
    nextDiscoveredModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameStringMap(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath;
  }

  const next: AntigravityProviderSettings = {
    ...current,
    ...updates,
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    discoveredModels: nextDiscoveredModels,
    visibleModels: nextVisibleModels,
  };

  if (updates.visibleModels !== undefined) {
    retargetRemovedAntigravitySelections(settings, next);
  }
  if (updates.discoveredModels !== undefined && nextVisibleModels.length === 0) {
    retargetRemovedAntigravitySelections(settings, next);
  }

  setProviderConfig(settings, 'antigravity', {
    autoApprovePermissions: next.autoApprovePermissions,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    defaultEffort: next.defaultEffort,
    discoveredModels: next.discoveredModels,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    project: next.project,
    visibleModels: next.visibleModels,
  });

  return next;
}

function retargetRemovedAntigravitySelections(
  settings: Record<string, unknown>,
  next: AntigravityProviderSettings,
): void {
  const maybeRetarget = (value: unknown): string | null => {
    if (typeof value !== 'string' || !isAntigravityModelSelectionId(value)) {
      return null;
    }
    return next.visibleModels.includes(value)
      ? null
      : next.visibleModels[0] ?? '';
  };

  if (typeof settings.model === 'string') {
    const retargeted = maybeRetarget(settings.model);
    if (retargeted !== null) {
      settings.model = retargeted;
    }
  }
  if (typeof settings.titleGenerationModel === 'string') {
    const retargeted = maybeRetarget(settings.titleGenerationModel);
    if (retargeted !== null) {
      settings.titleGenerationModel = retargeted;
    }
  }

  const savedProviderModel = settings.savedProviderModel;
  if (
    savedProviderModel
    && typeof savedProviderModel === 'object'
    && !Array.isArray(savedProviderModel)
  ) {
    const record = savedProviderModel as Record<string, unknown>;
    const retargeted = maybeRetarget(record.antigravity);
    if (retargeted !== null) {
      if (retargeted) {
        record.antigravity = retargeted;
      } else {
        delete record.antigravity;
      }
    }
  }
}