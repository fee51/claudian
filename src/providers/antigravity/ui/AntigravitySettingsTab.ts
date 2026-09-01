import { Setting } from 'obsidian';

import type { ProviderSettingsTabRendererContext } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { renderProviderEnablementSetting } from '../../../shared/settings/ProviderEnablementSetting';
import {
  getAntigravityProviderSettings,
  updateAntigravityProviderSettings,
} from '../settings';

export const antigravitySettingsTabRenderer = {
  render(
    container: HTMLElement,
    context: ProviderSettingsTabRendererContext,
  ): void {
    const plugin = context.plugin;
    const getSettings = () => getAntigravityProviderSettings(plugin.settings);

    container.createEl('h2', { text: 'Antigravity' });
    container.createEl('p', {
      cls: 'setting-item-description',
      text: 'Embed Google antigravity (agy) as an agent in your vault. Requires the antigravity CLI (agy) on your machine.',
    });

    renderProviderEnablementSetting({
      container,
      getValue: () => getSettings().enabled,
      name: 'Enable Antigravity',
      description:
        'Allow Claudian to launch the agy CLI in your vault. Disabled by default because the agent can modify files.',
      onChange: async enabled => {
        await plugin.mutateSettings(settings => {
          updateAntigravityProviderSettings(settings, { enabled });
        });
      },
    });

    const cliPathSetting = new Setting(container)
      .setName('CLI path')
      .setDesc('Path to the agy executable. Leave empty to search path.')
      .addText(text => {
        text
          .setPlaceholder('e.g. C:\\Users\\you\\AppData\\Local\\agy\\bin\\agy.exe')
          .setValue(getSettings().cliPath)
          .onChange(async value => {
            const trimmed = value.trim();
            await plugin.mutateSettings(settings => {
              updateAntigravityProviderSettings(settings, { cliPath: trimmed });
            });
          });
      });

    container.createEl('h3', { text: 'Permissions' });
    new Setting(container)
      .setName('Auto-approve permissions')
      .setDesc(
        'Passes --dangerously-skip-permissions to agy. When off, headless agy auto-denies tools that request permission; use agy settings.json allow rules for fine-grained control.',
      )
      .addToggle(toggle => {
        toggle
          .setValue(getSettings().autoApprovePermissions)
          .onChange(async value => {
            await plugin.mutateSettings(settings => {
              updateAntigravityProviderSettings(settings, {
                autoApprovePermissions: value,
              });
            });
          });
      });

    container.createEl('h3', { text: 'Execution' });
    new Setting(container)
      .setName('Reasoning effort')
      .setDesc('Default --effort level for new turns (low | medium | high).')
      .addDropdown(dropdown => {
        const current = getSettings().defaultEffort || 'medium';
        dropdown
          .addOption('low', 'Low')
          .addOption('medium', 'Medium')
          .addOption('high', 'High')
          .setValue(current)
          .onChange(async value => {
            await plugin.mutateSettings(settings => {
              updateAntigravityProviderSettings(settings, {
                defaultEffort: value as 'low' | 'medium' | 'high',
              });
            });
          });
      });

    new Setting(container)
      .setName('Project')
      .setDesc('Optional antigravity project ID/name passed with --project.')
      .addText(text => {
        text
          .setPlaceholder('Project-id')
          .setValue(getSettings().project)
          .onChange(async value => {
            await plugin.mutateSettings(settings => {
              updateAntigravityProviderSettings(settings, { project: value.trim() });
            });
          });
      });

    renderModelVisibility(container, context);

    renderEnvironmentSettingsSection({
      container,
      plugin,
      scope: 'provider:antigravity',
      heading: 'Environment variables',
      name: 'Antigravity environment variables',
      desc: 'Variables passed to agy, e.g. GEMINI_API_KEY=...',
      placeholder: 'GEMINI_API_KEY=...',
    });

    void cliPathSetting;
  },
};

function renderModelVisibility(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
): void {
  const plugin = context.plugin;
  const getSettings = () => getAntigravityProviderSettings(plugin.settings);

  container.createEl('h3', { text: 'Models' });
  const discovered = getSettings().discoveredModels;
  if (discovered.length === 0) {
    container.createEl('p', {
      cls: 'setting-item-description',
      text: 'No models discovered yet. Run agy models from your terminal, or check that agy is installed and reachable.',
    });
  }
  for (const model of discovered) {
    const selectionId = `antigravity:${model.id}`;
    new Setting(container)
      .setName(model.label)
      .setDesc(model.id)
      .addToggle(toggle => {
        toggle
          .setValue(getSettings().visibleModels.includes(selectionId))
          .onChange(async visible => {
            const settings = getSettings();
            const nextVisible = new Set(settings.visibleModels);
            if (visible) {
              nextVisible.add(selectionId);
            } else {
              nextVisible.delete(selectionId);
            }
            await plugin.mutateSettings(mutable => {
              updateAntigravityProviderSettings(mutable, {
                visibleModels: [...nextVisible],
              });
            });
            context.notifyProviderModelOptionsChanged('antigravity');
          });
      });
  }
}