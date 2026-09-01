import { type ChildProcess,spawn } from 'node:child_process';

import type { AntigravityLaunchSpec } from './AntigravityLaunchSpec';

export interface AntigravitySubprocessHandle {
  readonly exitCode: number | null;
  readonly stderr: string;
}

/**
 * Owns one `agy` subprocess: spawns, feeds stdout line-by-line, snapshots
 * stderr, and reports termination. No protocol interpretation here.
 */
export class AntigravitySubprocess {
  private child: ChildProcess | null = null;
  private readonly stderrChunks: string[] = [];
  private sawResult = false;
  private exitSettled = false;
  private exitResolve!: (handle: AntigravitySubprocessHandle) => void;
  private exitReject!: (error: Error) => void;
  private readonly exitPromise = new Promise<AntigravitySubprocessHandle>(
    (resolve, reject) => {
      this.exitResolve = resolve;
      this.exitReject = reject;
    },
  );
  private outputBuffer = '';

  constructor(
    private readonly launchSpec: AntigravityLaunchSpec,
    private readonly onLine: (line: string) => void,
    private readonly onSpawnError: (error: Error) => void,
  ) {}

  get stdoutExit(): Promise<AntigravitySubprocessHandle> {
    return this.exitPromise;
  }

  getStderrSnapshot(): string {
    return this.stderrChunks.join('');
  }

  markResultSeen(): void {
    this.sawResult = true;
  }

  start(): void {
    let child: ChildProcess;
    try {
      child = spawn(this.launchSpec.executablePath, this.launchSpec.args, {
        cwd: this.launchSpec.cwd,
        env: this.launchSpec.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.exitReject(error instanceof Error ? error : new Error(String(error)));
      this.onSpawnError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.child = child;

    child.once('error', (error) => {
      this.onSpawnError(error);
      this.settleExit({ exitCode: null, stderr: this.getStderrSnapshot() });
    });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      this.outputBuffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = this.outputBuffer.indexOf('\n')) >= 0) {
        const line = this.outputBuffer.slice(0, newlineIndex).replace(/\r$/, '');
        this.outputBuffer = this.outputBuffer.slice(newlineIndex + 1);
        if (line.trim()) {
          this.onLine(line);
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      this.stderrChunks.push(chunk.toString());
    });

    child.once('close', (code) => {
      this.settleExit({ exitCode: code, stderr: this.getStderrSnapshot() });
    });
  }

  kill(): void {
    const child = this.child;
    if (!child || child.exitCode !== null || child.killed) {
      return;
    }
    try {
      child.kill();
    } catch {
      // Process may already be gone.
    }
  }

  private settleExit(handle: AntigravitySubprocessHandle): void {
    if (this.exitSettled) {
      return;
    }
    this.exitSettled = true;
    this.exitResolve(handle);
  }
}