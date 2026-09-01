/**
 * Command-line construction for the Antigravity CLI (`agy`).
 *
 * One subprocess per turn: `agy --print=<prompt> --output-format stream-json
 * --input-format text [--conversation <id>] [--model <id>] [--effort <lvl>]
 * [--mode plan] [--dangerously-skip-permissions] [--project <id>]
 * [--print-timeout <dur>]`.
 *
 * Keep the command-line shape in this file instead of scattering flags across
 * runtime code.
 */

export interface AntigravityLaunchSpecOptions {
  /** Directories added to the agy workspace via repeatable --add-dir. */
  addDirs?: readonly string[];
  autoApprovePermissions: boolean;
  conversationId?: string | null;
  cwd: string;
  effort?: string | null;
  env: NodeJS.ProcessEnv;
  executablePath: string;
  model?: string | null;
  planMode: boolean;
  printTimeoutSeconds?: number;
  project?: string;
  prompt: string;
}

export interface AntigravityLaunchSpec {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  executablePath: string;
  /** Stable identity of the launched configuration for kernel reuse checks. */
  processKey: string;
  prompt: string;
}

export const DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT_SECONDS = 30 * 60;

/** agy parses --print-timeout as a Go duration (e.g. "30m", "90s"). */
export function formatAntigravityPrintTimeout(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 300;
  if (safeSeconds % 60 === 0) {
    return `${safeSeconds / 60}m`;
  }
  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}m${remainder}s`;
}

export function buildAntigravityLaunchSpec(
  options: AntigravityLaunchSpecOptions,
): AntigravityLaunchSpec {
  const args: string[] = [
    `--print=${options.prompt}`,
    '--output-format',
    'stream-json',
    '--input-format',
    'text',
  ];
  for (const dir of options.addDirs ?? []) {
    if (dir.trim()) {
      args.push('--add-dir', dir);
    }
  }
  if (options.conversationId) {
    args.push('--conversation', options.conversationId);
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  // agy rejects an explicit --effort when the model id already encodes the
  // reasoning tier (e.g. gemini-3.7-flash-high).
  const modelEncodesEffort = options.model
    ? /-(?:low|medium|high)$/i.test(options.model)
    : false;
  if (options.effort && !modelEncodesEffort) {
    args.push('--effort', options.effort);
  }
  if (options.planMode) {
    args.push('--mode', 'plan');
  }
  if (options.autoApprovePermissions) {
    args.push('--dangerously-skip-permissions');
  }
  if (options.project) {
    args.push('--project', options.project);
  }
  args.push(
    '--print-timeout',
    formatAntigravityPrintTimeout(
      options.printTimeoutSeconds ?? DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT_SECONDS,
    ),
  );

  return {
    args,
    cwd: options.cwd,
    env: options.env,
    executablePath: options.executablePath,
    processKey: `${options.executablePath}|${options.conversationId ?? ''}`,
    prompt: options.prompt,
  };
}