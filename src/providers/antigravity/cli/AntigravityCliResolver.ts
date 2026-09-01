import { CachedProviderCliResolver } from '../../../core/providers/cli/CachedProviderCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getAntigravityProviderSettings } from '../settings';

export class AntigravityCliResolver {
  private readonly resolver = new CachedProviderCliResolver({
    binaryName: 'agy',
    getSettingsProjection: (settings) => {
      const providerSettings = getAntigravityProviderSettings(settings);
      return {
        cliPathsByHost: providerSettings.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'antigravity'),
        legacyCliPath: providerSettings.cliPath,
      };
    },
    providerId: 'antigravity',
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  resolve(
    hostnamePaths: Record<string, string> | undefined,
    legacyPath: string,
    envText = '',
  ): string | null {
    return this.resolver.resolve({
      cliPathsByHost: hostnamePaths,
      environmentText: envText,
      legacyCliPath: legacyPath,
    });
  }

  reset(): void {
    this.resolver.reset();
  }
}