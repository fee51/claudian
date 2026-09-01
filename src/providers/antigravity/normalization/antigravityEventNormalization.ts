/**
 * Parsing and normalization of the Antigravity CLI `stream-json` NDJSON
 * protocol (probed against `agy` 1.1.23).
 *
 * Wire shape (one JSON object per stdout line):
 *  - {"event":"init","conversation_id":"...","init":{"cwd","tools","permission_mode"}}
 *  - {"event":"step_update","step_update":{
 *      "conversation_id","step_index","state":"ACTIVE|DONE|ERROR","step_type",
 *      "text_delta"?,"duration_seconds"?,"usage"?,"tool_name"?,"tool_info"?}}
 *  - {"event":"result","result":{
 *      "conversation_id","status":"SUCCESS|CANCELED|ERROR","response"?,"error"?,
 *      "num_turns","usage"?}}
 *
 * Unknown events are ignored so the adapter tolerates forward-compatible
 * protocol additions.
 */

export interface AntigravityUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
}

export interface AntigravityInitEvent {
  event: 'init';
  conversationId: string;
  init: {
    cwd: string;
    tools: string[];
    permissionMode: string;
  };
}

export type AntigravityStepState = 'ACTIVE' | 'DONE' | 'ERROR';

export interface AntigravityToolInfo {
  name: string;
  parameters: Record<string, unknown>;
  output?: string;
  error?: { type: string; message: string };
}

export interface AntigravityStepUpdateEvent {
  event: 'step_update';
  conversationId: string;
  stepIndex: number;
  state: AntigravityStepState;
  stepType: string;
  textDelta?: string;
  durationSeconds?: number;
  usage?: AntigravityUsage;
  toolName?: string;
  toolInfo?: AntigravityToolInfo;
}

export interface AntigravityResultEvent {
  event: 'result';
  conversationId: string;
  status: string;
  response?: string;
  error?: string;
  numTurns: number;
  usage?: AntigravityUsage;
}

export type AntigravityEvent =
  | AntigravityInitEvent
  | AntigravityStepUpdateEvent
  | AntigravityResultEvent;

export function parseAntigravityNdjsonLine(line: string): AntigravityEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const event = getString(parsed.event);
  if (!event) {
    return null;
  }
  const payload = getRecord(parsed[event]);
  switch (event) {
    case 'init':
      return normalizeInitEvent(payload);
    case 'step_update':
      return normalizeStepUpdateEvent(payload);
    case 'result':
      return normalizeResultEvent(payload);
    default:
      return null;
  }
}

function normalizeInitEvent(payload: Record<string, unknown>): AntigravityInitEvent | null {
  const conversationId = getString(payload.conversation_id) ?? '';
  const init = getRecord(payload.init);
  return {
    event: 'init',
    conversationId,
    init: {
      cwd: getString(init.cwd) ?? '',
      tools: getStringArray(init.tools),
      permissionMode: getString(init.permission_mode) ?? 'request-review',
    },
  };
}

function normalizeStepUpdateEvent(
  payload: Record<string, unknown>,
): AntigravityStepUpdateEvent | null {
  const state = getString(payload.state) as AntigravityStepState | null;
  if (
    !state
    || (state !== 'ACTIVE' && state !== 'DONE' && state !== 'ERROR')
  ) {
    return null;
  }
  const stepType = getString(payload.step_type) ?? '';
  const conversationId = getString(payload.conversation_id) ?? '';
  const toolInfo = getRecord(payload.tool_info);
  return {
    event: 'step_update',
    conversationId,
    stepIndex: getNumber(payload.step_index) ?? 0,
    state,
    stepType,
    ...(typeof payload.text_delta === 'string'
      ? { textDelta: payload.text_delta }
      : {}),
    ...(typeof payload.duration_seconds === 'number'
      ? { durationSeconds: payload.duration_seconds }
      : {}),
    ...(isRecord(payload.usage)
      ? { usage: normalizeUsage(payload.usage) }
      : {}),
    ...(typeof payload.tool_name === 'string'
      ? { toolName: payload.tool_name }
      : {}),
    ...(Object.keys(toolInfo).length > 0
      ? {
          toolInfo: {
            name: getString(toolInfo.name) ?? '',
            parameters: getRecord(toolInfo.parameters),
            ...(typeof toolInfo.output === 'string'
              ? { output: toolInfo.output }
              : {}),
            ...(isRecord(toolInfo.error)
              ? {
                  error: {
                    type: getString(toolInfo.error.type) ?? '',
                    message: getString(toolInfo.error.message) ?? '',
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

function normalizeResultEvent(
  payload: Record<string, unknown>,
): AntigravityResultEvent | null {
  const status = getString(payload.status) ?? '';
  if (!status) {
    return null;
  }
  return {
    event: 'result',
    conversationId: getString(payload.conversation_id) ?? '',
    status,
    ...(typeof payload.response === 'string' ? { response: payload.response } : {}),
    ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
    numTurns: getNumber(payload.num_turns) ?? 1,
    ...(isRecord(payload.usage) ? { usage: normalizeUsage(payload.usage) } : {}),
  };
}

function normalizeUsage(payload: Record<string, unknown>): AntigravityUsage {
  return {
    inputTokens: getNumber(payload.input_tokens) ?? 0,
    outputTokens: getNumber(payload.output_tokens) ?? 0,
    ...(typeof payload.thinking_tokens === 'number'
      ? { thinkingTokens: payload.thinking_tokens }
      : {}),
    ...(typeof payload.cache_read_tokens === 'number'
      ? { cacheReadTokens: payload.cache_read_tokens }
      : {}),
    ...(typeof payload.total_tokens === 'number'
      ? { totalTokens: payload.total_tokens }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}