# Antigravity Provider

`src/providers/antigravity/` adapts Google Antigravity through its `agy`
CLI in headless `stream-json` mode (probed against agy 1.1.23, command name
`agy`, installed at `%LOCALAPPDATA%\agy\bin\agy.exe`).

## Protocol

- One subprocess per turn: `agy --print=<prompt> --output-format stream-json
  --input-format text [--conversation <id>] [--model <id>] [--effort <lvl>]
  [--mode plan] [--dangerously-skip-permissions] [--print-timeout <dur>]`.
- stdout carries NDJSON events: `init`, `step_update` (ACTIVE/DONE/ERROR with
  `text_delta`/`usage`/`tool_info`), `result` (SUCCESS/CANCELED/ERROR).
  Unknown events are ignored for forward compatibility.
- A conversation resumes by passing its id with `--conversation`; the CLI
  keeps the same `conversation_id` across turns.
- Headless permission mode: without `--dangerously-skip-permissions`, tools
  that request permission are auto-denied (no interactive prompt channel);
  allow rules live in the CLI's settings.json. Claudian exposes an
  auto-approve toggle instead of an approval gate.

## Ownership

| Component | Owns |
| --- | --- |
| `execution/AntigravityExecutionSession.ts` | Provider execution binding, one turn per `--print` process, provider snapshots, cancellation |
| `execution/AntigravityExecutionKernel.ts` + `runtime/AntigravitySubprocess.ts` | Subprocess and NDJSON line parsing into normalized events |
| `runtime/AntigravityLaunchSpec.ts` | Command-line construction only |
| `normalization/antigravityEventNormalization.ts` | NDJSON wire shape → typed events |
| `app/AntigravityWorkspaceServices.ts` | CLI path resolution, `agy models` discovery, settings tab assembly |
| `settings.ts` | Persisted provider settings and runtime decoding |
| `models.ts` | `antigravity:<runtime-model-id>` selection ids and `agy models` output parsing |

## Design rules

- Keep executable-path resolution inside `AntigravityCliResolver`
  (CachedProviderCliResolver, binary name `agy`).
- Native persistence is conversation-id only; `providerState.conversationId`
  is the resume seed. No transcript files are read or written.
- `supportsNativeHistory`, `supportsRewind`, `supportsFork`,
  `supportsImageAttachments`, `supportsInstructionMode`, and
  `supportsTurnSteer` are false; `supportsPlanMode` is true (`--mode plan`)
  and `reasoningControl` is `'effort'`.
- Persisted settings changes must go through `ProviderHost.mutateSettings`;
  never call `saveSettings()` outside the composition root.
- Environment keys that invalidate sessions: GEMINI/GOOGLE auth vars and PATH
  (see `env/AntigravitySettingsReconciler.ts`).
- The `result` `CANCELED`/`ERROR` path terminates the run stream with an
  execution error carrying the CLI's own message.