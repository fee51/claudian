import { NOOP_TASK_RESULT_INTERPRETER } from '../../core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '../../core/providers/providerConfig';
import { hasStoredConfigNormalization } from '../../core/providers/settings/storedSettings';
import type { ProviderModule } from '../../core/providers/types';
import {
  antigravityWorkspaceRegistration,
} from './app/AntigravityWorkspaceServices';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from './capabilities';
import { antigravitySettingsReconciler } from './env/AntigravitySettingsReconciler';
import { AntigravityExecutionBackend } from './execution/AntigravityExecutionBackend';
import { AntigravityConversationHistoryService } from './history/AntigravityConversationHistoryService';
import {
  getAntigravityProviderSettings,
  updateAntigravityProviderSettings,
} from './settings';
import { antigravityChatUIConfig } from './ui/AntigravityChatUIConfig';

export const antigravityProviderRegistration: ProviderModule = {
  id: 'antigravity',
  blankTabOrder: 16,
  capabilities: ANTIGRAVITY_PROVIDER_CAPABILITIES,
  chatUIConfig: antigravityChatUIConfig,
  createExecutionBackend: plugin => new AntigravityExecutionBackend(plugin),
  resolveTitleGenerationModel: plugin => {
    const model = typeof plugin.settings.titleGenerationModel === 'string'
      ? plugin.settings.titleGenerationModel
      : '';
    return model && antigravityChatUIConfig.ownsModel(model, plugin.settings)
      ? model
      : undefined;
  },
  displayName: 'Antigravity',
  environmentKeyPatterns: [
    /^GEMINI_/i,
    /^GOOGLE_/i,
    /^ANTIGRAVITY_/i,
    /^AGY_/i,
  ],
  historyService: new AntigravityConversationHistoryService(),
  isEnabled: settings => getAntigravityProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) =>
    updateAntigravityProviderSettings(settings, { enabled }),
  settingsReconciler: antigravitySettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    normalizeStored(target, stored) {
      const storedConfig = getProviderConfig(stored, 'antigravity');
      updateAntigravityProviderSettings(
        target,
        getAntigravityProviderSettings(stored),
      );
      return hasStoredConfigNormalization(
        storedConfig,
        getProviderConfig(target, 'antigravity'),
      );
    },
  },
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER,
  workspace: antigravityWorkspaceRegistration,
};