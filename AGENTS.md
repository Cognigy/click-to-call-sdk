# AI Agents Documentation - Click To Call SDK

`@cognigy/click-to-call-sdk` is a standalone, framework-agnostic TypeScript library for
browser-based voice calling over WebRTC with SIP signaling. It wraps JsSIP behind an
event-driven API. Public API reference: `README.md`. Architecture: `docs/architecture.md`.

## Architecture

`createWebRTCClient(config)` (`src/index.ts`) returns a `WebRTCClient`
(`src/WebRTCClient.ts`), which orchestrates the managers in `src/`:

- `ConfigManager`: fetches endpoint config over HTTP, derives SIP credentials and userId
- `SipManager`: JsSIP UA wrapper, WebSocket transport, registration
- `SessionManager`: call session lifecycle, info/transcription parsing
- `CallStateStore`: immutable `ClientState` snapshots, emits `stateChanged`
- `AudioManager`: remote audio playback, `captureAudio` for raw stream access

`WebRTCClient` also owns the setup timer and `disconnectAfterCall`.

## Commands

```bash
npm run test:run       # single test run (CI); `npm test` is watch mode
npm run test:coverage  # thresholds: 80% branches/functions/lines/statements
npm run typecheck      # tsc --noEmit
npm run lint           # Biome with --write (auto-fixes); CI runs it without --write
npm run build          # UMD + CJS + ES + .d.ts into dist/
```

Before committing, run `npm run typecheck && npm run lint && npm run test:run`.

## Conventions

- Public types live in `src/types/index.ts`, internal ones in `src/types/internal.ts`.
- All exports go through `src/index.ts`.
- Commits and PR titles follow conventional commits (commitlint locally, PR title
  checker in CI). semantic-release derives versions from them.
- Tests: one file per module in `src/__tests__/unit/`, integration tests in
  `src/__tests__/integration/`. Reuse the mocks in `src/__tests__/mocks/`
  (`jssip.ts`, `fixtures.ts`).

## Security invariants

Don't relax these without an explicit decision; each has a regression test.

- `SipManager` rejects any WebSocket URI that is not `wss://` (SIP credentials travel
  over it).
- `SessionManager` rejects inbound SIP REFER and Replaces: there is no transfer UI, and
  accepting Replaces would auto-answer with the microphone.

## Adding to the SDK

1. **New manager**: create in `src/`, extend `SDKEventEmitter` from `src/utils/events.ts`
2. **New events**: add to `COGNIGY_WEBRTC_EVENTS` in `src/utils/events.ts`, add the
   callback type in `src/types/index.ts`
3. **New public types**: export from `src/types/index.ts`, re-export in `src/index.ts`
4. **New public methods**: add to `WebRTCClient`, update the README API table
5. **New `ClientState` fields or `endInfo.cause` values**: update `CallStateStore`,
   `SDK_END_CAUSES` and the README "Call state" section

The `error` event is only emitted when a listener is registered.

## CI/CD

- Workflows are in `.github/workflows/`. Use Node 20, `npm ci`, `actions/checkout@v4`,
  `actions/setup-node@v4`.
- CI lint is `npx @biomejs/biome lint .` (no `--write`).
- Release runs on push to `main` via semantic-release and publishes to npm through
  trusted publishing (OIDC) bound to `release.yml`. There is no npm token.
