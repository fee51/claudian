import type {
  ProviderChatUIConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import {
  decodeAntigravitySelectionId,
  isAntigravityModelSelectionId,
} from '../models';
import {
  getAntigravityProviderSettings,
  updateAntigravityProviderSettings,
} from '../settings';

const EFFORT_OPTIONS: ProviderReasoningOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const antigravityChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    const providerSettings = getAntigravityProviderSettings(settings);
    return providerSettings.visibleModels.map(selectionId => {
      const runtimeId = decodeAntigravitySelectionId(selectionId) ?? selectionId;
      const discovered = providerSettings.discoveredModels.find(model => model.id === runtimeId);
      return {
        value: selectionId,
        label: discovered?.label ?? runtimeId,
        group: 'Antigravity',
      };
    });
  },

  getDefaultModel(settings: Record<string, unknown>): string | null {
    const providerSettings = getAntigravityProviderSettings(settings);
    return providerSettings.visibleModels[0] ?? null;
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (!isAntigravityModelSelectionId(model)) {
      return false;
    }
    const providerSettings = getAntigravityProviderSettings(settings);
    const runtimeId = decodeAntigravitySelectionId(model);
    return runtimeId !== null && (
      providerSettings.visibleModels.includes(model)
      || providerSettings.discoveredModels.some(entry => entry.id === runtimeId)
    );
  },

  isAdaptiveReasoningModel(_model: string, _settings: Record<string, unknown>): boolean {
    return true;
  },

  getReasoningOptions(
    _model: string,
    _settings: Record<string, unknown>,
  ): ProviderReasoningOption[] {
    return EFFORT_OPTIONS;
  },

  getDefaultReasoningValue(_model: string, _settings: Record<string, unknown>): string {
    return 'medium';
  },

  getContextWindowSize(
    model: string,
    customLimits?: Record<string, number>,
    _settings?: Record<string, unknown>,
  ): number {
    const override = customLimits?.[model];
    return override ?? 1_000_000;
  },

  isDefaultModel(_model: string): boolean {
    return false;
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!isAntigravityModelSelectionId(model) || !isRecord(settings)) {
      return;
    }
    const savedProviderModel = ensureProviderProjectionMap(settings, 'savedProviderModel');
    savedProviderModel.antigravity = model;
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    if (!isAntigravityModelSelectionId(model) || !isRecord(settings)) {
      return;
    }
    if (value !== 'low' && value !== 'medium' && value !== 'high') {
      return;
    }
    updateAntigravityProviderSettings(settings, { defaultEffort: value });
  },

  normalizeModelVariant(model: string, _settings: Record<string, unknown>): string {
    return model;
  },

  normalizeAvailableModelSelection(
    model: string,
    settings: Record<string, unknown>,
  ): string {
    if (!isAntigravityModelSelectionId(model)) {
      return model;
    }
    const providerSettings = getAntigravityProviderSettings(settings);
    if (providerSettings.visibleModels.includes(model)) {
      return model;
    }
    return providerSettings.visibleModels[0] ?? '';
  },

  getCustomModelIds(_envVars: Record<string, string>): Set<string> {
    return new Set();
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ensureProviderProjectionMap(
  settings: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const existing = settings[key];
  if (isRecord(existing)) {
    return existing;
  }
  const projection: Record<string, unknown> = {};
  settings[key] = projection;
  return projection;
}