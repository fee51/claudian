import {
  createCliPathFingerprintInputs,
  hasCliPathFingerprintInputs,
} from '../../../core/providers/cli/CliPathFingerprintInputs';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import {
  createRuntimeInputFingerprint,
  isVersionedRuntimeInputFingerprint,
} from '../../../core/providers/settings/RuntimeInputFingerprint';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getHostnameKey, parseEnvironmentVariables } from '../../../utils/env';
import {
  isAntigravityModelSelectionId,
  normalizeAntigravityDiscoveredModels,
} from '../models';
import {
  getAntigravityProviderSettings,
  normalizeAntigravityVisibleModels,
  updateAntigravityProviderSettings,
} from '../settings';
import { clearAntigravityResumeState } from '../types';

const ANTIGRAVITY_ENV_HASH_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_BASE_URL',
  'GOOGLE_GENAI_API_KEY',
  'PATH',
] as const;

function computeAntigravityRuntimeFingerprint(
  environmentText: string,
  cliPathInputs: ReturnType<typeof createCliPathFingerprintInputs>,
): string {
  return createRuntimeInputFingerprint({
    additionalInputs: cliPathInputs,
    environmentKeys: ANTIGRAVITY_ENV_HASH_KEYS,
    environmentText,
  });
}

function invalidateAntigravityConversationSessions(
  conversations: Conversation[],
): Conversation[] {
  return conversations.filter(conversation => (
    conversation.providerId === 'antigravity' && clearAntigravityResumeState(conversation)
  ));
}

export const antigravitySettingsReconciler: ProviderSettingsReconciler = {
  environmentSessionPolicy: 'invalidate',

  handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    const current = getAntigravityProviderSettings(settings);
    if (current.discoveredModels.length === 0) {
      return false;
    }
    updateAntigravityProviderSettings(settings, {
      discoveredModels: [],
    });
    return true;
  },

  invalidateConversationSessions: invalidateAntigravityConversationSessions,

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'antigravity');
    const antigravitySettings = getAntigravityProviderSettings(settings);
    const cliPathInputs = createCliPathFingerprintInputs(
      antigravitySettings.cliPathsByHost[getHostnameKey()],
      antigravitySettings.cliPath,
    );
    const currentHash = computeAntigravityRuntimeFingerprint(envText, cliPathInputs);
    const savedHash = antigravitySettings.environmentHash;

    const environment = parseEnvironmentVariables(envText);
    const hasFingerprintInputs = Boolean(
      hasCliPathFingerprintInputs(cliPathInputs)
      || ANTIGRAVITY_ENV_HASH_KEYS.some(key =>
        Object.prototype.hasOwnProperty.call(environment, key)),
    );
    if (!savedHash && !hasFingerprintInputs) {
      return { changed: false, invalidatedConversations: [] };
    }
    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations = invalidateAntigravityConversationSessions(conversations);
    updateAntigravityProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const antigravitySettings = getAntigravityProviderSettings(settings);
    let changed = false;

    const envText = getRuntimeEnvironmentText(settings, 'antigravity');
    const cliPathInputs = createCliPathFingerprintInputs(
      antigravitySettings.cliPathsByHost[getHostnameKey()],
      antigravitySettings.cliPath,
    );
    const savedHash = antigravitySettings.environmentHash;
    if (
      !isVersionedRuntimeInputFingerprint(savedHash)
      && savedHash
    ) {
      updateAntigravityProviderSettings(settings, {
        environmentHash: computeAntigravityRuntimeFingerprint(envText, cliPathInputs),
      });
      changed = true;
    }

    const retargetSelection = (value: unknown): string | null => {
      if (typeof value !== 'string' || !isAntigravityModelSelectionId(value)) {
        return null;
      }
      return antigravitySettings.visibleModels.includes(value)
        ? value
        : antigravitySettings.visibleModels[0] ?? '';
    };

    const modelSelection = retargetSelection(settings.model);
    if (
      typeof settings.model === 'string'
      && modelSelection !== null
      && settings.model !== modelSelection
    ) {
      settings.model = modelSelection;
      changed = true;
    }

    const titleModelSelection = retargetSelection(settings.titleGenerationModel);
    if (
      typeof settings.titleGenerationModel === 'string'
      && titleModelSelection !== null
      && settings.titleGenerationModel !== titleModelSelection
    ) {
      settings.titleGenerationModel = titleModelSelection;
      changed = true;
    }

    const savedProviderModelRaw = settings.savedProviderModel;
    if (
      savedProviderModelRaw
      && typeof savedProviderModelRaw === 'object'
      && !Array.isArray(savedProviderModelRaw)
    ) {
      const savedProviderModel = savedProviderModelRaw as Record<string, unknown>;
      const savedSelection = retargetSelection(savedProviderModel.antigravity);
      if (
        typeof savedProviderModel.antigravity === 'string'
        && savedSelection !== null
        && savedProviderModel.antigravity !== savedSelection
      ) {
        if (savedSelection) {
          savedProviderModel.antigravity = savedSelection;
        } else {
          delete savedProviderModel.antigravity;
        }
        changed = true;
      }
    }

    const normalizedModels = normalizeAntigravityDiscoveredModels(
      antigravitySettings.discoveredModels,
    );
    const normalizedVisibleModels = normalizeAntigravityVisibleModels(
      antigravitySettings.visibleModels,
      normalizedModels,
    );
    const visibleChanged = !sameStringList(
      normalizedVisibleModels,
      antigravitySettings.visibleModels,
    );
    if (visibleChanged) {
      updateAntigravityProviderSettings(settings, {
        visibleModels: normalizedVisibleModels,
      });
      changed = true;
    }

    return changed;
  },
};

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}