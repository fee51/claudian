import { spawnSync } from 'node:child_process';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderModelCatalogRefreshResult,
  ProviderSettingsTabRenderer,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { AntigravityCliResolver } from '../cli/AntigravityCliResolver';
import { parseAntigravityModelsOutput } from '../models';
import { getAntigravityProviderSettings, updateAntigravityProviderSettings } from '../settings';
import { antigravitySettingsTabRenderer } from '../ui/AntigravitySettingsTab';

export interface AntigravityWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: AntigravityCliResolver;
  settingsTabRenderer: ProviderSettingsTabRenderer;
  refreshModelCatalog(
    context?: { providerTransitionOwner?: boolean },
  ): Promise<ProviderModelCatalogRefreshResult>;
  dispose(): Promise<void>;
}

export async function createAntigravityWorkspaceServices(
  plugin: ProviderHost,
): Promise<AntigravityWorkspaceServices> {
  const cliResolver = new AntigravityCliResolver();

  const refreshModelCatalog =
    async (): Promise<ProviderModelCatalogRefreshResult> => {
      const executablePath = cliResolver.resolveFromSettings(plugin.settings) ?? 'agy';
      const env = {
        ...process.env,
        ...parseEnvironmentVariables(getRuntimeEnvironmentText(plugin.settings, 'antigravity')),
      };
      try {
        const result = spawnSync(executablePath, ['models'], {
          encoding: 'utf8',
          env,
          timeout: 30_000,
          windowsHide: true,
        });
        if (result.status !== 0 || !result.stdout) {
          return { changed: false };
        }
        const discoveredModels = parseAntigravityModelsOutput(result.stdout);
        if (discoveredModels.length === 0) {
          return { changed: false };
        }
        const current = getAntigravityProviderSettings(plugin.settings);
        const changed = !sameDiscoveredModels(current.discoveredModels, discoveredModels)
          || (
            current.visibleModels.length === 0
            && discoveredModels.length > 0
          );
        if (!changed) {
          return { changed: false };
        }
        const nextVisibleModels = current.visibleModels.length > 0
          ? current.visibleModels
          : discoveredModels.map(model => `antigravity:${model.id}`);
        await plugin.mutateSettings(settings => {
          updateAntigravityProviderSettings(settings, {
            discoveredModels,
            visibleModels: nextVisibleModels,
          });
        });
        return { changed: true, persistedSettingsChanged: true };
      } catch {
        return { changed: false };
      }
    };

  // Populate the catalog once so model selection is immediately usable.
  await refreshModelCatalog();

  return {
    cliResolver,
    settingsTabRenderer: antigravitySettingsTabRenderer,
    async prepareSettings() {
      await refreshModelCatalog();
    },
    refreshModelCatalog,
    async dispose() {
      cliResolver.reset();
    },
  };
}

export const antigravityWorkspaceRegistration: ProviderWorkspaceRegistration<AntigravityWorkspaceServices> = {
  initialize: async ({ plugin }) => createAntigravityWorkspaceServices(plugin),
};

export function maybeGetAntigravityWorkspaceServices(): AntigravityWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('antigravity') as AntigravityWorkspaceServices | null;
}

export function getAntigravityWorkspaceServices(): AntigravityWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('antigravity') as AntigravityWorkspaceServices;
}

function sameDiscoveredModels(
  left: { id: string }[],
  right: { id: string }[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry.id === right[index]?.id);
}