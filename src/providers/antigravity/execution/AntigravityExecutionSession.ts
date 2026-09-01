import { randomUUID } from 'node:crypto';

import type {
  ProviderExecutionErrorCategory,
  ProviderExecutionEvent,
  ProviderExecutionRequest,
  ProviderExecutionRun,
  ProviderExecutionSession,
  ProviderRequestedEventScope,
  ProviderRequestedExecutionEvent,
  ProviderSessionConfig,
  ProviderSessionEvent,
  ProviderSessionInvalidation,
  ProviderSessionSnapshot,
  ProviderSessionStatus,
} from '../../../core/execution';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { parseEnvironmentVariables } from '../../../utils/env';
import { toAntigravityRuntimeModelId } from '../modelSelection';
import type {
  AntigravityEvent,
  AntigravityResultEvent,
  AntigravityStepUpdateEvent,
  AntigravityUsage,
} from '../normalization/antigravityEventNormalization';
import {
  type AntigravityLaunchSpec,
  buildAntigravityLaunchSpec,
} from '../runtime/AntigravityLaunchSpec';
import { getAntigravityProviderSettings } from '../settings';
import { AntigravityExecutionKernel } from './AntigravityExecutionKernel';
import { buildAntigravityUsageInfo } from './buildAntigravityUsageInfo';

const ANTIGRAVITY_FALLBACK_CONTEXT_WINDOW = 1_000_000;

export class AntigravityExecutionSession implements ProviderExecutionSession {
  readonly providerId = 'antigravity' as const;
  readonly sessionInstanceId = randomUUID();

  private readonly sessionListeners = new Set<
    (event: ProviderSessionEvent) => void
  >();
  private readonly runFlights = new Set<Promise<void>>();
  private activeRun: ActiveRun | null = null;
  private disposed = false;
  private disposalPromise: Promise<void> | null = null;
  private kernel: AntigravityExecutionKernel | null = null;
  private lifecycleError: Error | null = null;
  private providerState: Record<string, unknown> = {};
  private providerSessionId: string | null = null;
  private revision = 0;
  private sessionSequence = 0;
  private shutdownPromise: Promise<void> | null = null;
  private snapshotInvalidation: ProviderSessionInvalidation | null = null;
  private status: ProviderSessionStatus = 'idle';

  constructor(
    private readonly host: ProviderHost,
    private readonly config: ProviderSessionConfig,
  ) {
    const rawState = isRecord(config.resumeSeed?.providerState)
      ? cloneRecord(config.resumeSeed.providerState)
      : {};
    this.providerState = rawState;
    const conversationId = getString(rawState.conversationId);
    this.providerSessionId = conversationId
      ?? config.resumeSeed?.providerSessionId
      ?? null;
    if (this.shouldDisableNativePersistence()) {
      this.providerSessionId = null;
      delete this.providerState.conversationId;
    }
  }

  execute(request: ProviderExecutionRequest): ProviderExecutionRun {
    if (this.disposed) {
      throw new Error('Antigravity execution session is disposed');
    }
    if (this.lifecycleError) {
      throw new Error('Antigravity execution session cleanup failed and requires disposal.');
    }
    if (this.activeRun) {
      throw new Error('Antigravity execution session already has an active run');
    }

    const active = this.createActiveRun(request);
    this.activeRun = active;
    this.setStatus('executing');
    this.emitRequestedState(active);
    if (request.signal.aborted) {
      this.cancel();
    } else {
      const runFlight = this.run(active, request);
      this.runFlights.add(runFlight);
      runFlight.then(
        () => this.runFlights.delete(runFlight),
        () => this.runFlights.delete(runFlight),
      );
    }
    return {
      executionId: active.executionId,
      turnId: active.turnId,
      events: active.events,
      cancel: () => {
        if (this.activeRun === active) this.cancel();
      },
    };
  }

  cancel(): void {
    const active = this.activeRun;
    if (!active || active.terminal) return;
    this.setStatus('cancelling');
    this.kernel?.shutdown().catch(() => undefined);
    this.kernel = null;
    active.terminalSignal.reject(new Error('Antigravity turn cancelled'));
    this.setStatus('idle');
    this.finishRequested(active, {
      reason: 'Cancelled',
      type: 'cancelled',
    });
  }

  getSnapshot(): ProviderSessionSnapshot {
    const base = {
      providerId: this.providerId,
      revision: this.revision,
      ...(this.providerSessionId
        ? { providerSessionId: this.providerSessionId }
        : {}),
      ...(Object.keys(this.providerState).length > 0
        ? { providerState: Object.freeze(cloneRecord(this.providerState)) }
        : {}),
    };
    return Object.freeze(this.status === 'invalidated'
      ? {
          ...base,
          invalidation: Object.freeze(this.snapshotInvalidation ?? {
            reason: 'provider-error' as const,
            recoverable: true,
          }),
          status: 'invalidated' as const,
        }
      : {
          ...base,
          status: this.status,
        });
  }

  getStatus(): ProviderSessionStatus {
    return this.status;
  }

  onEvent(listener: (event: ProviderSessionEvent) => void): () => void {
    if (this.disposed) return () => undefined;
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  dispose(): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;
    this.disposed = true;
    if (this.activeRun) this.cancel();
    this.disposalPromise = (async () => {
      const runResults = await Promise.allSettled([...this.runFlights]);
      const lifecycleError = getFirstRejectedError(runResults);
      try {
        await this.shutdownKernel();
      } catch (error) {
        this.lifecycleError ??= toError(error);
      }
      this.setStatus('disposed');
      this.emitSession({
        snapshot: this.getSnapshot(),
        type: 'session_state_changed',
      });
      this.sessionListeners.clear();
      const pendingError = this.lifecycleError ?? lifecycleError;
      if (pendingError) {
        throw pendingError;
      }
    })();
    return this.disposalPromise;
  }

  private createActiveRun(request: ProviderExecutionRequest): ActiveRun {
    const abortController = new AbortController();
    const onRequestAbort = (): void => this.cancel();
    const events = new AsyncEventQueue<ProviderExecutionEvent>(() => {
      this.cancel();
    });
    request.signal.addEventListener('abort', onRequestAbort, { once: true });
    return {
      abortController,
      events,
      executionId: randomUUID(),
      inputText: getInputText(request),
      onRequestAbort,
      requestSignal: request.signal,
      sequence: 0,
      turnId: randomUUID(),
      accepted: false,
      assistantStarted: false,
      terminal: false,
      terminalSignal: createDeferred<void>(),
      toolStates: new Map(),
      usage: null,
    };
  }

  private async run(
    active: ActiveRun,
    request: ProviderExecutionRequest,
  ): Promise<void> {
    try {
      const encoded = await this.encodeRequest(active, request);
      if (!this.isActive(active)) return;
      const kernel = new AntigravityExecutionKernel(
        encoded.launchSpec,
        {
          onClose: closeError => this.handleKernelClose(active, kernel, closeError),
          onEvent: event => this.handleEvent(active, kernel, event),
        },
      );
      this.kernel = kernel;
      kernel.start();
      if (!this.isActive(active)) {
        await kernel.shutdown().catch(() => undefined);
        return;
      }
      await active.terminalSignal.promise;
      if (!this.isActive(active)) return;

      const conversationId = getString(this.providerState.conversationId)
        ?? this.providerSessionId;
      if (conversationId) {
        this.addNativeConversationCheckpoint(conversationId);
      }
      if (active.usage) {
        const usage = buildAntigravityUsageInfo(
          active.usage,
          encoded.model,
          ANTIGRAVITY_FALLBACK_CONTEXT_WINDOW,
        );
        this.emitRequested(active, { type: 'usage_updated', usage });
      }
      this.setStatus('idle');
      this.emitRequestedState(active);
      this.finishRequested(active, {
        nativeCheckpointId: conversationId ?? undefined,
        reason: 'completed',
        type: 'turn_completed',
      });
    } catch (caught) {
      if (!active.terminal) {
        this.finishError(active, caught);
      }
    }
  }

  private async encodeRequest(
    active: ActiveRun,
    request: ProviderExecutionRequest,
  ): Promise<{ launchSpec: AntigravityLaunchSpec; model: string }> {
    const settings = getAntigravityProviderSettings(this.host.settings);
    if (!settings.enabled) {
      throw new AntigravityConfigurationError('Antigravity is disabled.');
    }
    const model = resolveSelectedModel(request, settings, this.host.settings);
    const runtimeModel = toAntigravityRuntimeModelId(model);
    if (!runtimeModel) {
      throw new AntigravityConfigurationError('The selected Antigravity model is invalid.');
    }
    const effort = resolveEffort(request, settings, this.host.settings);
    const planMode = resolvePlanMode(request);
    const autoApprovePermissions = settings.autoApprovePermissions
      || /approve/i.test(request.configuration.permissionMode ?? '');
    const conversationId = this.shouldDisableNativePersistence()
      ? null
      : getString(this.providerState.conversationId) ?? this.providerSessionId;
    const env = {
      ...process.env,
      ...parseEnvironmentVariables(getRuntimeEnvironmentText(this.host.settings, 'antigravity')),
    };
    const executablePath = (await this.host.getResolvedProviderCliPath('antigravity')) ?? 'agy';
    const launchSpec = buildAntigravityLaunchSpec({
      addDirs: [this.config.vaultWorkingDirectory],
      autoApprovePermissions,
      conversationId,
      cwd: this.config.vaultWorkingDirectory,
      effort: effort || undefined,
      env,
      executablePath,
      model: runtimeModel,
      planMode,
      project: settings.project || undefined,
      prompt: encodePrompt(request),
    });
    return { launchSpec, model };
  }

  private handleEvent(
    active: ActiveRun,
    kernel: AntigravityExecutionKernel,
    event: AntigravityEvent,
  ): void {
    if (!this.isCurrentKernel(kernel) || !active || active.terminal) {
      return;
    }
    switch (event.event) {
      case 'init': {
        this.setProviderStateValue('conversationId', event.conversationId);
        this.providerSessionId = event.conversationId || this.providerSessionId;
        this.ensureAccepted(active);
        break;
      }
      case 'step_update':
        this.handleStepUpdate(active, event);
        break;
      case 'result':
        this.handleResult(active, event);
        break;
    }
  }

  private handleStepUpdate(
    active: ActiveRun,
    event: AntigravityStepUpdateEvent,
  ): void {
    if (event.usage) {
      active.usage = mergeUsage(active.usage, event.usage);
    }
    if (event.stepType === 'user_input') {
      return;
    }
    if (event.stepType === 'agent_response') {
      if (event.textDelta) {
        this.ensureAssistantStarted(active);
        this.emitRequested(active, { text: event.textDelta, type: 'text_delta' });
      }
      return;
    }
    if (event.stepType === 'tool' && event.toolName && event.toolInfo) {
      const toolState = event.state === 'ACTIVE'
        ? this.toolStarted(active, event)
        : this.toolCompleted(active, event);
      if (toolState) {
        active.toolStates.set(event.stepIndex, toolState);
      }
      return;
    }
  }

  private toolStarted(
    active: ActiveRun,
    event: AntigravityStepUpdateEvent,
  ): ToolState {
    const toolCallId = `antigravity-tool-${event.stepIndex}`;
    this.emitRequested(active, {
      input: event.toolInfo?.parameters ?? {},
      name: event.toolName ?? '',
      toolCallId,
      toolScope: { kind: 'main' },
      type: 'tool_started',
    });
    return { toolCallId };
  }

  private toolCompleted(
    active: ActiveRun,
    event: AntigravityStepUpdateEvent,
  ): ToolState | null {
    const existing = active.toolStates.get(event.stepIndex);
    const toolCallId = existing?.toolCallId ?? `antigravity-tool-${event.stepIndex}`;
    const toolInfo = event.toolInfo;
    const isError = event.state === 'ERROR' || Boolean(toolInfo?.error);
    const content = toolInfo?.error?.message
      ?? toolInfo?.output
      ?? (isError ? 'Tool failed.' : '');
    this.emitRequested(active, {
      content,
      isError,
      toolCallId,
      toolScope: { kind: 'main' },
      type: 'tool_completed',
    });
    return existing ?? { toolCallId };
  }

  private handleResult(
    active: ActiveRun,
    event: AntigravityResultEvent,
  ): void {
    if (event.usage) {
      active.usage = mergeUsage(active.usage, event.usage);
    }
    if (event.conversationId) {
      this.setProviderStateValue('conversationId', event.conversationId);
      this.providerSessionId = event.conversationId;
    }
    if (event.status !== 'SUCCESS') {
      const message = event.error
        || event.response
        || `Antigravity turn ended with status "${event.status}".`;
      active.terminalSignal.reject(new Error(message));
      return;
    }
    active.terminalSignal.resolve();
  }

  private handleKernelClose(
    active: ActiveRun,
    kernel: AntigravityExecutionKernel,
    error?: Error,
  ): void {
    if (!this.isCurrentKernel(kernel) || this.disposed) return;
    this.kernel = null;
    const currentActive = this.activeRun;
    if (currentActive && !currentActive.terminal) {
      const stderr = kernel.getStderrSnapshot().trim();
      const runError = error
        ?? (stderr ? new Error(stderr) : new Error('Antigravity CLI exited.'));
      currentActive.terminalSignal.reject(runError);
      this.finishError(currentActive, runError, 'process-exited');
    }
    const shutdown = kernel.shutdown()
      .catch(() => undefined)
      .finally(() => {
        if (this.shutdownPromise === shutdown) {
          this.shutdownPromise = null;
        }
      });
    this.shutdownPromise = shutdown;
  }

  private ensureAccepted(active: ActiveRun): void {
    if (!this.isActive(active) || active.accepted) return;
    active.accepted = true;
    this.emitRequested(active, {
      accepted: true,
      nativeCheckpointId: getString(this.providerState.conversationId) ?? undefined,
      type: 'turn_started',
    });
    this.emitRequested(active, {
      content: active.inputText,
      nativeUserMessageId: getString(this.providerState.conversationId) ?? undefined,
      type: 'user_message_started',
    });
  }

  private ensureAssistantStarted(active: ActiveRun): void {
    if (active.assistantStarted) return;
    active.assistantStarted = true;
    this.emitRequested(active, {
      nativeAssistantId: getString(this.providerState.conversationId) ?? undefined,
      type: 'assistant_message_started',
    });
  }

  private addNativeConversationCheckpoint(conversationId: string): void {
    this.bumpRevision();
  }

  private shouldDisableNativePersistence(): boolean {
    return this.config.lifecycle === 'ephemeral'
      || this.config.nativePersistence === 'disabled-if-supported';
  }

  private finishError(
    active: ActiveRun,
    error: unknown,
    category?: ProviderExecutionErrorCategory,
  ): void {
    if (active.terminal) return;
    active.terminalSignal.reject(
      error instanceof Error ? error : new Error('Antigravity execution failed.'),
    );
    const message = error instanceof Error ? error.message : 'Antigravity execution failed.';
    this.setStatus('idle');
    this.finishRequested(active, {
      category: category ?? (error instanceof AntigravityConfigurationError
        ? 'configuration'
        : 'provider'),
      message,
      recoverable: !(error instanceof AntigravityConfigurationError),
      type: 'execution_error',
    });
  }

  private finishRequested(
    active: ActiveRun,
    event: WithoutScope<ProviderRequestedExecutionEvent>,
  ): void {
    if (active.terminal) return;
    this.emitRequested(active, event);
    active.terminal = true;
    active.requestSignal.removeEventListener('abort', active.onRequestAbort);
    active.events.close();
    if (this.activeRun === active) this.activeRun = null;
  }

  private emitRequested(
    active: ActiveRun,
    event: WithoutScope<ProviderRequestedExecutionEvent>,
  ): void {
    if (active.terminal) return;
    active.events.push({
      ...event,
      scope: this.nextRequestedScope(active),
    });
  }

  private emitRequestedState(active: ActiveRun): void {
    this.emitRequested(active, {
      snapshot: this.getSnapshot(),
      type: 'session_state_changed',
    });
  }

  private emitSession(event: WithoutScope<ProviderSessionEvent>): void {
    const scoped = {
      ...event,
      scope: this.nextSessionScope(),
    } as ProviderSessionEvent;
    for (const listener of this.sessionListeners) {
      try {
        listener(scoped);
      } catch {
        // Session listeners cannot affect process ownership.
      }
    }
  }

  private nextRequestedScope(active: ActiveRun): ProviderRequestedEventScope {
    return Object.freeze({
      executionId: active.executionId,
      kind: 'requested',
      sequence: ++active.sequence,
      sessionInstanceId: this.sessionInstanceId,
      turnId: active.turnId,
    });
  }

  private nextSessionScope() {
    return Object.freeze({
      kind: 'session',
      sequence: ++this.sessionSequence,
      sessionInstanceId: this.sessionInstanceId,
    });
  }

  private isActive(active: ActiveRun): boolean {
    return !this.disposed && this.activeRun === active && !active.terminal;
  }

  private isCurrentKernel(kernel: AntigravityExecutionKernel): boolean {
    return this.kernel === kernel && !this.disposed;
  }

  private shutdownKernel(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    const kernel = this.kernel;
    this.kernel = null;
    if (!kernel) return Promise.resolve();
    const shutdown = kernel.shutdown().finally(() => {
      if (this.shutdownPromise === shutdown) {
        this.shutdownPromise = null;
      }
    });
    this.shutdownPromise = shutdown;
    return shutdown;
  }

  private setStatus(status: Exclude<ProviderSessionStatus, 'invalidated'>): void {
    this.status = status;
    this.snapshotInvalidation = null;
    this.bumpRevision();
  }

  private setProviderStateValue(key: string, value: unknown): void {
    this.providerState[key] = value;
    this.bumpRevision();
  }

  private bumpRevision(): void {
    this.revision += 1;
  }
}

interface ToolState {
  toolCallId: string;
}

interface ActiveRun {
  abortController: AbortController;
  accepted: boolean;
  assistantStarted: boolean;
  events: AsyncEventQueue<ProviderExecutionEvent>;
  executionId: string;
  inputText: string;
  onRequestAbort: () => void;
  requestSignal: AbortSignal;
  sequence: number;
  terminal: boolean;
  terminalSignal: Deferred<void>;
  toolStates: Map<number, ToolState>;
  turnId: string;
  usage: AntigravityUsage | null;
}

class AntigravityConfigurationError extends Error {}

function resolveSelectedModel(
  request: ProviderExecutionRequest,
  settings: ReturnType<typeof getAntigravityProviderSettings>,
  hostSettings: Record<string, unknown>,
): string {
  const model = request.configuration.model
    ?? getString(hostSettings.model);
  if (
    !model
    || !toAntigravityRuntimeModelId(model)
    || (settings.visibleModels.length > 0 && !settings.visibleModels.includes(model))
  ) {
    throw new AntigravityConfigurationError(
      'No Antigravity model is selected. Enable a discovered model in Claudian settings.',
    );
  }
  return model;
}

function resolveEffort(
  request: ProviderExecutionRequest,
  settings: ReturnType<typeof getAntigravityProviderSettings>,
  hostSettings: Record<string, unknown>,
): string | null {
  const value = request.configuration.reasoning
    ?? getString(hostSettings.effortLevel)
    ?? settings.defaultEffort;
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  return 'medium';
}

function resolvePlanMode(request: ProviderExecutionRequest): boolean {
  const mode = request.configuration.mode ?? '';
  return /plan/i.test(mode);
}

function encodePrompt(request: ProviderExecutionRequest): string {
  let text = getInputText(request);
  const context = request.context;
  if (context?.linkedContent?.path) {
    text = `${text}\n\n[Linked content path: ${context.linkedContent.path}]`;
  }
  if (context?.editorSelection?.selectedText) {
    text = `${text}\n\n[Editor selection]\n${context.editorSelection.selectedText}`;
  }
  if (context?.externalContextPaths?.length) {
    text = `${text}\n\n[Allowed external paths: ${context.externalContextPaths.join(', ')}]`;
  }
  return text;
}

function getInputText(request: ProviderExecutionRequest): string {
  return request.input
    .filter((block): block is { readonly type: 'text'; readonly text: string } =>
      block.type === 'text')
    .map(block => block.text)
    .join('\n\n');
}

function mergeUsage(
  current: AntigravityUsage | null,
  next: AntigravityUsage,
): AntigravityUsage {
  if (!current) return next;
  return {
    inputTokens: next.inputTokens || current.inputTokens,
    outputTokens: next.outputTokens || current.outputTokens,
    cacheReadTokens: next.cacheReadTokens ?? current.cacheReadTokens,
    thinkingTokens: next.thinkingTokens ?? current.thinkingTokens,
    totalTokens: next.totalTokens ?? current.totalTokens,
  };
}

type WithoutScope<T> = T extends unknown ? Omit<T, 'scope'> : never;

class AsyncEventQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private closed = false;
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];

  constructor(private readonly onEarlyReturn: () => void) {}

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) {
      return Promise.resolve({ done: false, value });
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise(resolve => this.waiters.push(resolve));
  }

  return(): Promise<IteratorResult<T>> {
    if (!this.closed) this.onEarlyReturn();
    return Promise.resolve({ done: true, value: undefined });
  }

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value });
    } else {
      this.values.push(value);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: Error): void;
  resolve(value?: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let settle = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => undefined);
  return {
    promise,
    reject(error) {
      if (settle) return;
      settle = true;
      rejectPromise(error);
    },
    resolve(value?: T) {
      if (settle) return;
      settle = true;
      resolvePromise(value as T);
    },
  };
}

function getFirstRejectedError(
  results: readonly PromiseSettledResult<void>[],
): Error | null {
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  return rejected ? toError(rejected.reason) : null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cloneRecord(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}