import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { CachedProviderCliResolver } from '../../../core/providers/cli/CachedProviderCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getAntigravityProviderSettings } from '../settings';

const AGY_BINARY_NAME = 'agy';

/**
 * Windows installs of the Antigravity CLI land in %LOCALAPPDATA%\agy\bin
 * without touching PATH. Probe those locations as a fallback so model
 * discovery and execution work out of the box.
 */
export function findAntigravityCliInCommonLocations(): string | null {
  const localAppData = process.env.LOCALAPPDATA
    || join(process.env.USERPROFILE ?? '', 'AppData', 'Local');
  const candidates = [
    join(localAppData, 'agy', 'bin', `${AGY_BINARY_NAME}.exe`),
    join(localAppData, 'agy', 'bin', AGY_BINARY_NAME),
    join(localAppData, 'ag', 'bin', `${AGY_BINARY_NAME}.exe`),
    join(localAppData, 'Programs', 'Antigravity', 'bin', `${AGY_BINARY_NAME}.exe`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export class AntigravityCliResolver {
  private readonly resolver = new CachedProviderCliResolver({
    binaryName: AGY_BINARY_NAME,
    getSettingsProjection: (settings) => {
      const providerSettings = getAntigravityProviderSettings(settings);
      return {
        cliPathsByHost: providerSettings.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'antigravity'),
        legacyCliPath: providerSettings.cliPath,
      };
    },
    providerId: 'antigravity',
    resolve: (context, resolveDefault) => resolveDefault()
      ?? findAntigravityCliInCommonLocations(),
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