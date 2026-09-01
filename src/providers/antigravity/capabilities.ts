import type { ProviderCapabilities } from '../../core/providers/types';

export const ANTIGRAVITY_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> =
  Object.freeze({
    providerId: 'antigravity',
    supportsNativeHistory: false,
    supportsPlanMode: true,
    supportsRewind: false,
    supportsFork: false,
    supportsProviderCommands: false,
    supportsImageAttachments: false,
    supportsInstructionMode: false,
    supportsTurnSteer: false,
    reasoningControl: 'effort',
  });