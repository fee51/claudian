import {
  type AntigravityEvent,
  parseAntigravityNdjsonLine,
} from '../normalization/antigravityEventNormalization';
import type { AntigravityLaunchSpec } from '../runtime/AntigravityLaunchSpec';
import { AntigravitySubprocess } from '../runtime/AntigravitySubprocess';

export interface AntigravityExecutionKernelCallbacks {
  /** Called with every parsed Antigravity NDJSON event. */
  onEvent(event: AntigravityEvent): void;
  /**
   * Called once when the subprocess terminates. `error` is set when the
   * process failed without producing a terminal `result` event.
   */
  onClose(error?: Error): void;
}

/**
 * One `agy` subprocess per turn. Parses stdout NDJSON and reports normalized
 * events; interprets no provider policy.
 */
export class AntigravityExecutionKernel {
  private subprocess: AntigravitySubprocess | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private closed = false;

  constructor(
    readonly launchSpec: AntigravityLaunchSpec,
    private readonly callbacks: AntigravityExecutionKernelCallbacks,
  ) {}

  getStderrSnapshot(): string {
    return this.subprocess?.getStderrSnapshot() ?? '';
  }

  start(): void {
    if (this.subprocess) {
      return;
    }
    const subprocess = new AntigravitySubprocess(
      this.launchSpec,
      line => this.handleLine(line),
      error => this.handleClose(error),
    );
    this.subprocess = subprocess;
    subprocess.start();
    void subprocess.stdoutExit.then(handle => {
      if (this.closed) {
        return;
      }
      const terminalEventSeen = this.terminalEventSeen;
      if (terminalEventSeen) {
        this.callbacks.onClose();
      } else {
        const stderr = handle.stderr.trim();
        this.callbacks.onClose(new Error(
          stderr || `Antigravity CLI exited without producing a result (code ${handle.exitCode ?? 'unknown'}).`,
        ));
      }
    }).catch(error => {
      if (!this.closed) {
        this.handleClose(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    this.shutdownPromise = (async () => {
      this.closed = true;
      this.subprocess?.kill();
      this.subprocess = null;
    })();
    return this.shutdownPromise;
  }

  private terminalEventSeen = false;

  private handleLine(line: string): void {
    const event = parseAntigravityNdjsonLine(line);
    if (!event) {
      return;
    }
    if (event.event === 'result') {
      this.terminalEventSeen = true;
      this.subprocess?.markResultSeen();
    }
    this.callbacks.onEvent(event);
  }

  private handleClose(error: Error): void {
    if (this.closed) {
      return;
    }
    this.callbacks.onClose(error);
  }
}