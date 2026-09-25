# AI Agents Documentation - Click To Call SDK

## Project Overview

The **Click To Call SDK** (`@cognigy/click-to-call-sdk`) is a standalone, framework-agnostic
TypeScript library for browser-based voice calling over WebRTC using SIP signaling. It wraps
JsSIP and abstracts SIP registration, WebRTC peer connections, and audio management behind a
simple event-driven API.

## Project Structure

### Core Architecture

- **Language**: TypeScript (strict mode, ES2020 target)
- **Package Type**: npm library published publicly under `@cognigy` scope
- **Build System**: Vite (library mode) producing UMD, CJS, and ES bundles
- **Testing**: Vitest with jsdom environment
- **Linting**: Biome (tabs, double quotes, recommended rules)
- **CI/CD**: GitHub Actions with semantic-release

### Key Directories

```text
click-to-call-sdk/
├── src/                      # TypeScript source code
│   ├── index.ts              # Entry point, factory function, exports
│   ├── WebRTCClient.ts       # Orchestrator, public API surface
│   ├── ConfigManager.ts      # Endpoint config fetching & caching
│   ├── SipManager.ts         # JsSIP User Agent wrapper
│   ├── SessionManager.ts     # Call session lifecycle
│   ├── AudioManager.ts       # Remote audio playback
│   ├── types/
│   │   ├── index.ts          # Public type definitions
│   │   └── internal.ts       # Internal type definitions
│   ├── utils/
│   │   ├── events.ts         # SDKEventEmitter, COGNIGY_WEBRTC_EVENTS
│   │   └── helpers.ts        # Utility functions
│   └── __tests__/
│       ├── setup.ts          # Test environment setup
│       ├── mocks/            # JsSIP mocks & fixtures
│       ├── unit/             # Unit tests per module
│       └── integration/      # Integration tests
├── dist/                     # Build output (UMD, CJS, ES + .d.ts)
├── docs/
│   └── architecture.md       # Architecture documentation
├── .github/
│   ├── workflows/
│   │   ├── ci.yml            # PR checks: lint, typecheck, test, build
│   │   ├── release.yml       # semantic-release + npm publish on push to main
│   │   └── pr-title-checker.yml
│   └── pr-title-checker-config.json
├── vite.config.ts            # Build configuration
├── vitest.config.ts          # Test configuration
├── biome.json                # Linter/formatter configuration
├── release.config.js         # semantic-release configuration
├── commitlint.config.js      # Commit lint configuration
├── tsconfig.json             # TypeScript configuration
└── package.json
```

## Module Architecture

```text
Consumer App (React, Vue, Vanilla JS)
        │
        ▼
  createWebRTCClient(config)  ← src/index.ts
        │
        ▼
    WebRTCClient              ← src/WebRTCClient.ts (orchestrator)
        │
        ├── ConfigManager     ← src/ConfigManager.ts
        ├── SipManager        ← src/SipManager.ts
        ├── SessionManager    ← src/SessionManager.ts
        └── AudioManager      ← src/AudioManager.ts
```

### Module Responsibilities

| Module | File | Purpose |
|--------|------|---------|
| **WebRTCClient** | `src/WebRTCClient.ts` | Orchestrates managers, exposes public API (`connect`, `startCall`, `endCall`, `mute`, etc.) |
| **ConfigManager** | `src/ConfigManager.ts` | Fetches endpoint config via HTTP, derives SIP credentials and userId |
| **SipManager** | `src/SipManager.ts` | JsSIP UA wrapper, WebSocket transport, SIP registration |
| **SessionManager** | `src/SessionManager.ts` | Call session lifecycle, events, info/transcription parsing |
| **AudioManager** | `src/AudioManager.ts` | Remote audio playback, `captureAudio` event for raw stream access |

## Development Commands

```bash
# Build
npm run build          # Clean and build (UMD + CJS + ES + .d.ts)
npm run dev            # Dev server with watch mode

# Testing
npm run test           # Vitest in watch mode
npm run test:run       # Single run (CI)
npm run test:coverage  # With coverage report
npm run test:ui        # Vitest UI

# Code Quality
npm run typecheck      # tsc --noEmit
npm run lint           # Biome lint with auto-fix
npm run clean          # Remove dist/ and coverage/
```

## CI/CD Pipeline

### Workflows

1. **CI** (`ci.yml`): Runs on PR and push to `main`. Jobs: lint, typecheck, test, build (build depends on the other three).
2. **Release** (`release.yml`): Runs on push to `main`. Uses semantic-release to analyze conventional commits, bump version, update CHANGELOG.md, publish to npm via trusted publishing (OIDC), create git tag and GitHub Release.
3. **PR Title Checker** (`pr-title-checker.yml`): Enforces conventional commit format on PR titles.

### npm Publishing

- Registry: `https://registry.npmjs.org/`
- Authentication: npm trusted publishing (OIDC)
- Access: `--access public` (scoped under `@cognigy`)

## Testing

### Framework

- **Vitest** with `jsdom` environment
- Global test APIs enabled (`describe`, `it`, `expect`)
- Path alias: `@` maps to `src/`
- Coverage thresholds: 80% (branches, functions, lines, statements)

### Test Organization

- **Unit tests**: `src/__tests__/unit/` — one test file per module (e.g., `SipManager.test.ts`)
- **Integration tests**: `src/__tests__/integration/`
- **Mocks**: `src/__tests__/mocks/jssip.ts` (JsSIP mock), `src/__tests__/mocks/fixtures.ts` (test data)
- **Setup**: `src/__tests__/setup.ts` (jsdom environment prep)

## Coding Standards

### TypeScript

- Strict mode enabled
- Public types in `src/types/index.ts`, internal types in `src/types/internal.ts`
- ES2020 target, ESNext module system
- All exports go through `src/index.ts`

### Biome

- Indent: tabs
- Quotes: double
- Rules: recommended set, `noExplicitAny` off
- Organize imports enabled

### Conventional Commits

All commits must follow the conventional commit format:
- `feat(scope): description` — new feature
- `fix(scope): description` — bug fix
- `chore`, `ci`, `docs`, `perf`, `refactor`, `revert`, `style`, `test`

Enforced by commitlint (local) and PR title checker (CI).

## Instructions for AI Agents

### Adding New Features

1. **New manager**: Create in `src/`, extend `SDKEventEmitter` from `src/utils/events.ts`
2. **New events**: Add to `COGNIGY_WEBRTC_EVENTS` in `src/utils/events.ts`, add callback type in `src/types/index.ts`
3. **New public types**: Export from `src/types/index.ts`, re-export in `src/index.ts`
4. **New public methods**: Add to `WebRTCClient`, update README.md API table

### Adding Tests

1. Create test file in `src/__tests__/unit/` matching the source file name
2. Use existing mocks from `src/__tests__/mocks/`
3. Run `npm run test:run` to verify all tests pass
4. Check coverage with `npm run test:coverage`

### Modifying CI/CD

1. Workflow files are in `.github/workflows/`
2. Use Node 20, `npm ci`, `actions/checkout@v4`, `actions/setup-node@v4`
3. CI lint uses `npx @biomejs/biome lint .` (no `--write` flag)
4. Release publishes via npm trusted publishing (bound to `release.yml`); no npm token

### Build Output

| Format | File | Usage |
|--------|------|-------|
| UMD | `dist/webRTCSDK.js` | Browser `<script>` tag |
| CJS | `dist/webRTCSDK.cjs.js` | CommonJS `require()` |
| ES | `dist/webRTCSDK.es.js` | ES module `import` |
| Types | `dist/index.d.ts` | TypeScript declarations |

### Event System

Events are defined in `src/utils/events.ts` as `COGNIGY_WEBRTC_EVENTS`:

| Category | Events |
|----------|--------|
| Connection | `connecting`, `connected`, `disconnected`, `registered`, `unregistered` |
| Call | `ringing`, `answered`, `ended`, `failed` |
| Audio | `muted`, `unmuted`, `audioEnded`, `captureAudio` |
| Communication | `infoSent`, `infoReceived`, `transcription` |
| Internal | `sessionCreated`, `sessionUpdated`, `sessionDestroyed` |
| Error | `error` |

---

**Project**: Click To Call SDK (`@cognigy/click-to-call-sdk`)
**Repository**: `https://github.com/Cognigy/click-to-call-sdk`
**License**: MIT
