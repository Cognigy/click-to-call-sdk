# Click To Call SDK - Architecture

## Overview

The Click to Call SDK is a standalone, framework-agnostic TypeScript library that enables browser-based voice calling over WebRTC using SIP signaling. It abstracts the complexity of SIP registration, WebRTC peer connections, and audio management behind a simple event-driven API.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Consumer App                     │
│              (React, Vue, Vanilla JS)               │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               createWebRTCClient()                  │
│                  (src/index.ts)                     │
│         Factory function & SDK entry point          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                  WebRTCClient                       │
│              (src/WebRTCClient.ts)                  │
│                                                     │
│  Public API surface — orchestrates all managers     │
│  and exposes a unified event system to consumers    │
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ Config   │ │ SIP      │ │ Session  │ │ Audio  │  │
│  │ Manager  │ │ Manager  │ │ Manager  │ │ Manager│  │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘  │
│  ┌────────────────┐                                 │
│  │ CallStateStore │  immutable state + stateChanged │
│  └────────────────┘                                 │
└─────────────────────────────────────────────────────┘
```

## Module Breakdown

### Entry Point (`src/index.ts`)

The public surface of the SDK. Exports:

- `createWebRTCClient(config)` — async factory that validates config, checks WebRTC support, and returns a `WebRTCClient` instance.
- `WebRTCClient` — the class itself for advanced usage.
- `isWebRTCSupported()` / `checkWebRTCSupport()` — environment capability checks.
- All public TypeScript types and interfaces.

### WebRTCClient (`src/WebRTCClient.ts`)

The **orchestrator**. It owns the managers and the `CallStateStore` and wires their internal events to a single public event bus.

**Responsibilities:**

- Lifecycle management (`connect`, `disconnect`, `destroy`).
- Config access (`loadConfig`, `getConfig`, `setUserId`).
- Call state (`getState`, `subscribe`) and the advanced `getRawSession()`.
- The call setup timer (`callSetupTimeoutMs`) and `disconnectAfterCall`.
- Call control (`startCall`, `endCall`, `mute`, `unmute`, `sendInfo`, `sendDTMF`).
- Forwarding events from internal managers to the consumer.
- Ensuring correct call sequence (e.g., must connect before calling).

**Key flow — `connect()`:**

0. Resets the state to `connecting` and arms the setup timer (only if `callSetupTimeoutMs` is set).
1. `ConfigManager.fetchConfig()` — fetches endpoint settings from the server (cached; shared with `loadConfig()`).
2. `ConfigManager.getSipCredentials()` — extracts SIP credentials + derives `fullUsername`.
3. `SipManager.initialize(credentials, settings)` — creates the JsSIP User Agent.
4. `SipManager.start()` — opens the WebSocket and registers with the SIP server.
5. Waits for `connected` and, when the endpoint needs registration, `registered` (with 15s timeout).

Failures reject with `Failed to connect: …` and set the state to `failed` with an `SDK_END_CAUSES` cause (or `Connection Error`). `endCall()` / `disconnect()` before a session exists abort the pending `connect()` and end the state with cause `Canceled`.

**Key flow — `startCall()`:**

1. Retrieves `applicationSid` from config.
2. Calls `SipManager.call('app-{applicationSid}')`.
3. JsSIP creates an RTCSession → `SessionManager.createSession()` handles it.
4. Session events (ringing, answered, ended, etc.) bubble up through `WebRTCClient`.

### Call lifecycle

```
idle → connecting → ringing → answered → ended / failed
          │            │
          │            └─→ ended / failed (session events, Connection Error)
          │
          └─→ before a session exists:
              ended (Canceled) / failed (SETUP_TIMEOUT, config, registration, Connection Error)
```

- `connecting`: from `connect()` (or `startCall()` on a client that already completed a call) until ringing.
- `SETUP_TIMEOUT` and the SDK's own `Canceled` only occur before a session exists; once a session exists, the
  state follows its events (`endCall()` sends 480 and JsSIP reports the cause).
- `callSetupTimeoutMs` (opt-in, no default): the timer starts on `connect()`; `startCall()` re-arms it only on a client that already completed a call. It is cleared when the SIP session is created (`sessionCreated`, INVITE sent), not on answer. On expiry the attempt is torn down, a pending `connect()` rejects and the state becomes `failed` with `SETUP_TIMEOUT`.
- Only events of the current session drive the state; events from any other session are ignored.
- A lost transport while a session exists ends the call with cause `Connection Error` and disconnects. Before a session exists the setup timer covers it.
- `disconnectAfterCall`: when the state turns terminal (`ended` / `failed`) the SIP UA is stopped before `stateChanged` is forwarded; the next `connect()` starts a new UA. Listeners stay registered across `disconnect()`.
- `getCurrentSession()` returns only an answered session; `getRawSession()` returns the current session including while ringing. `endCall()` works while ringing; `mute()`, `sendInfo()` and `sendDTMF()` need an answered call.
- The `error` event is emitted only when a listener exists (an unhandled `error` would throw inside JsSIP callbacks). Failures also land in `getState().endInfo`.

### ConfigManager (`src/ConfigManager.ts`)

Fetches and caches the endpoint configuration from the server.

**Responsibilities:**

- HTTP fetch with 10s timeout to retrieve `EndpointConfig`.
- Validates the response against required fields (org ID, project ID, SIP credentials).
- Derives `userId` from `endpointName` when none is provided (sanitizes to `[a-zA-Z0-9-]`, lowercases, appends random suffix).
- Builds the `fullUsername` for SIP registration: `{userId}@{realm}`.
- Provides accessors for SIP credentials, application SID, widget active state, and privacy settings.

### SipManager (`src/SipManager.ts`)

Wraps [JsSIP](https://jssip.net/) to manage the SIP User Agent lifecycle.

**Responsibilities:**

- Creates a JsSIP `UA` with WebSocket transport.
- Handles connection/registration state transitions.
- Initiates outbound calls via `ua.call()` with audio-only media constraints.
- Intercepts `newRTCSession` events and patches the session's `sendInfo` method to use JSON payloads.
- Tracks connection state (`connected`, `registered`, `connecting`).

**JsSIP integration:**

```
Browser ←→ WebSocket ←→ SIP Proxy ←→ VoiceGateway
         (wss://)       (realm)
```

### SessionManager (`src/SessionManager.ts`)

Manages the lifecycle of individual call sessions (RTCSessions from JsSIP).

**Responsibilities:**

- Creates `SessionState` objects for each new RTC session.
- Attaches event handlers: `connecting`, `progress` (ringing), `accepted` (answered), `failed`, `ended`, `muted/unmuted`, `hold/unhold`, `sdp`, `newInfo`.
- Manages active session tracking (only one session active at a time).
- Provides call control: `mute()`, `unmute()`, `terminate()`, `sendInfo()`, `sendDTMF()`.
- Parses incoming info messages and separates transcription events (`_transcription` payload) from regular info messages.
- Converts internal `SessionState` to public `CallSession` objects.
- Wires peer connection handlers for remote audio stream delivery to `AudioManager`.

**Session state machine:**

```
init → ringing → answered → ended
                          → failed
```

### CallStateStore (`src/CallStateStore.ts`)

Holds the immutable `ClientState` snapshot (`status`, `muted`, `session`, `endInfo`, `transcript`, `remoteStream`, `localStream`). Each snapshot, its transcript and messages are frozen.

**Responsibilities:**

- `update(patch)` replaces the state object and emits `stateChanged` only when a field actually changed.
- `startCall()` resets the state to `connecting`.
- `addTranscription()` appends transcript messages, dropping duplicates (same text and originator within 1s), and tolerates malformed payloads.
- `WebRTCClient` feeds it from session events of the current session only (lifecycle, `sessionUpdated` for mute/hold, and the session-tagged internal `transcription` / `streamsChanged` events) and forwards `stateChanged` to consumers (`getState()` / `subscribe()`). Streams are cleared when the current session ends or fails.

### AudioManager (`src/AudioManager.ts`)

Handles remote audio stream playback.

**Responsibilities:**

- Creates and manages an `HTMLAudioElement` for default audio playback.
- Receives remote `MediaStream` from peer connections via `handleRemoteStream()`.
- Provides volume and mute control.
- Emits `captureAudio` events when capture mode is enabled (for custom audio processing).
- Cleans up audio resources on stop/destroy.

### Event System (`src/utils/events.ts`)

A custom `SDKEventEmitter` extending Node.js `EventEmitter` (polyfilled for browser via the `events` package).

**Event constants (`COGNIGY_WEBRTC_EVENTS`):**

| Category      | Events                                                                  |
|---------------|-------------------------------------------------------------------------|
| Connection    | `connecting`, `connected`, `disconnected`, `registered`, `unregistered`, `registrationFailed` |
| Call          | `sessionCreated`, `ringing`, `answered`, `ended`, `failed`              |
| Audio         | `muted`, `unmuted`, `audioEnded`, `captureAudio`                        |
| Communication | `infoSent`, `dtmfSent`, `infoReceived`, `transcription`                 |
| State         | `stateChanged`                                                          |
| Internal      | `sessionUpdated`, `sessionDestroyed`, `streamsChanged`                  |
| Error         | `error`                                                                 |

### Types

**Public types** (`src/types/index.ts`):

- `WebRTCClientConfig` — constructor config (endpointUrl, userId, pcConfig, captureAudio, callSetupTimeoutMs, disconnectAfterCall).
- `ClientState`, `CallStatus`, `TranscriptMessage` — call state snapshot.
- `SDK_END_CAUSES` / `SdkEndCause` — `endInfo.cause` values the SDK sets itself.
- `EndpointConfig` — server response shape (org/project IDs, SIP info, widget config).
- `CallSession` — public session state (id, status, direction, timing, mute/hold).
- `CallEndInfo` — call termination details (originator, cause, description).
- `WebRTCClientEvents` — event name → callback signature map.

**Internal types** (`src/types/internal.ts`):

- `ExtendedRTCSession` — JsSIP RTCSession with patched `sendInfo`.
- `SessionState` — full internal session state including the RTCSession reference.
- `InternalClientConfig` / `InternalClientSettings` — SIP initialization params.
- `AudioState`, `SipManagerState` — internal manager states.

## Data Flow

### Configuration Flow

```
Consumer provides endpointUrl
        │
        ▼
ConfigManager.fetchConfig()
        │
        ▼
GET endpointUrl → EndpointConfig JSON
        │
        ├── endpointSettings.sipConnectivityInfo  →  SIP credentials
        ├── endpointSettings.endpointName          →  userId derivation
        ├── endpointSettings.webrtcWidgetConfig    →  widget active check
        └── settings.privacyNotice                 →  privacy settings
```

### Call Flow

```
client.startCall()
        │
        ▼
SipManager.call('app-{applicationSid}')
        │
        ▼
JsSIP UA.call() → WebSocket → SIP INVITE
        │
        ▼
SIP Proxy responds → newRTCSession event
        │
        ▼
SessionManager.createSession(rtcSession)
        │
        ├── progress  → emit 'ringing'
        ├── accepted  → emit 'answered', attach audio
        ├── ended     → emit 'ended', cleanup
        └── failed    → emit 'failed', cleanup
```

### Audio Flow

```
RTCSession peer connection
        │
        ▼
'addstream' / 'track' event
        │
        ▼
AudioManager.handleRemoteStream(stream)
        │
        ▼
HTMLAudioElement.srcObject = stream
        │
        ▼
Audio plays through browser
```

## Build & Bundle

- **Build tool**: Vite (library mode)
- **Output formats**: UMD (`webRTCSDK.js`), CJS (`webRTCSDK.cjs.js`), ES (`webRTCSDK.es.js`)
- **Type declarations**: Generated via `vite-plugin-dts`
- **Minification**: Terser
- **Target**: ES2020
- **Dependencies**: ES and CJS bundles import `jssip` and `events` (installed as dependencies); the UMD bundle is self-contained (`SDK_FORMAT=umd` pass)

## Directory Structure

```txt
webrtc-sdk/
├── src/
│   ├── index.ts              # Entry point, factory, exports
│   ├── WebRTCClient.ts       # Orchestrator / public API
│   ├── ConfigManager.ts      # Endpoint config fetching & caching
│   ├── SipManager.ts         # JsSIP User Agent wrapper
│   ├── SessionManager.ts     # Call session lifecycle
│   ├── CallStateStore.ts     # Immutable call state snapshots
│   ├── AudioManager.ts       # Remote audio playback
│   ├── types/
│   │   ├── index.ts          # Public type definitions
│   │   └── internal.ts       # Internal type definitions
│   ├── utils/
│   │   ├── events.ts         # Event emitter & event constants
│   │   └── helpers.ts        # Utility functions
│   └── __tests__/
│       ├── setup.ts          # Test environment setup
│       ├── mocks/            # JsSIP mocks & fixtures
│       ├── unit/             # Unit tests per module
│       └── integration/      # Integration tests
├── docs/
│   └── architecture.md       # This file
├── dist/                     # Build output
├── vite.config.ts            # Build configuration
├── tsconfig.json             # TypeScript configuration
├── vitest.config.ts          # Test configuration
├── biome.json                # Linter configuration
├── package.json
└── README.md
```
