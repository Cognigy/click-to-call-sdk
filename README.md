# Click To Call SDK

A standalone, framework-agnostic SDK for SIP-based voice calling with WebRTC. Built on JsSIP.

## Features

- 🚀 **Framework Agnostic** — works with React, Angular, Vue, or vanilla JS.
- 🔒 **Type Safe** — full TypeScript support.
- 📞 **SIP/WebRTC** — built on JsSIP for reliable communication.
- 🎛️ **Full Control** — start, end, mute, unmute, send info messages.
- 🔄 **Event Driven** — 21 events plus an immutable call state (`getState()` / `subscribe()`) for real-time updates.
- 🎵 **Auto Audio** — remote audio plays automatically; raw stream available via `captureAudio` event.
- 💬 **Transcription** — real-time transcription events, auto-separated from info messages.

## Installation

```bash
npm install @cognigy/click-to-call-sdk
```

## Quick Start

```typescript
import { createWebRTCClient, checkWebRTCSupport } from '@cognigy/click-to-call-sdk';

// 1. Check browser support
const support = checkWebRTCSupport();
if (!support.supported) throw new Error('Missing: ' + support.missing);

// 2. Create client
const client = await createWebRTCClient({
  endpointUrl: 'https://your-cognigy-environment.com/token',
  userId: 'user-123',
});

// 3. Listen to events
client.on('answered', (session) => console.log('Call answered:', session.id));
client.on('ended', (session, endInfo) => console.log('Call ended:', endInfo.cause));
client.on('error', (error) => console.error('Error:', error.message));

// 4. Connect and call
await client.connectAndCall();

// 5. Cleanup on page unload
window.addEventListener('beforeunload', () => {
  void client.destroy().catch(() => {
    // Ignore errors during page unload
  });
});
```

> **Note:** The call must be initiated from a user gesture (e.g. button click) for browser autoplay policies to allow audio.

## Configuration

```typescript
interface WebRTCClientConfig {
  endpointUrl: string;        // URL to fetch SIP configuration
  userId?: string;            // Optional user identifier
  pcConfig?: RTCConfiguration; // WebRTC peer connection config
  captureAudio?: boolean;     // Enable captureAudio event to receive raw MediaStream
  callSetupTimeoutMs?: number; // Fail the call if no SIP session exists this long after the attempt started
  disconnectAfterCall?: boolean; // Stop the SIP UA once a call ends or fails (default: false)
}
```

- `callSetupTimeoutMs` has no default: unset or `0` means no timer. When set, the timer starts on
  `connect()`; `startCall()` re-arms it only on a client that already completed a call (a new call without a new
  `connect()`). It is cleared as soon as the SIP session is created (INVITE sent), not when the call is answered.
  On expiry the call fails with cause `SETUP_TIMEOUT` and a pending `connect()` rejects.
- `disconnectAfterCall` stops the SIP UA after the call ends or fails. The next `connect()` starts a new one.

## API

| Method                  | Description                                  |
|-------------------------|----------------------------------------------|
| `loadConfig()`          | Fetch the endpoint config once and cache it (concurrent calls share one request); resolves `EndpointConfig`. Does not validate SIP fields, so a widget can render configs `connect()` rejects |
| `getConfig()`           | Cached `EndpointConfig` or `null` (before `loadConfig()`/`connect()`) |
| `setUserId(id)`         | Override the SIP user id. Throws once the SIP UA exists (`connect()` started, until `disconnect()`) |
| `connect()`             | Connect to SIP server and register; starts a new call attempt (state `connecting`). Rejects on config, registration or connection failure, on setup timeout, and when cancelled via `endCall()` / `disconnect()` |
| `disconnect()`          | Disconnect from SIP server; cancels a pending `connect()` |
| `connectAndCall()`      | Connect + start call in one step; rejects like `connect()`, also with `Failed to connect: <cause>` when cancelled or timed out after connecting but before dialing |
| `startCall()`           | Start a call (must be connected first)       |
| `endCall()`             | End the current call; also works while ringing and cancels a pending `connect()` |
| `mute()` / `unmute()`   | Toggle microphone (requires an answered call) |
| `sendInfo(text, data?)` | Send info message during an answered call    |
| `sendDTMF(tones, options?)` | Send DTMF tones (`0-9 A-D # * ,`) during an answered call |
| `isConnected()`         | Check connection state                       |
| `getCurrentSession()`   | Get the answered `CallSession` or `null`. Returns `null` while ringing |
| `getState()`            | Current immutable `ClientState` snapshot     |
| `subscribe(listener)`   | Listen for state changes (does not fire immediately); returns an unsubscribe function |
| `getRawSession()`       | Advanced/unstable: underlying JsSIP session, also while ringing |
| `on(event, callback)`   | Add event listener (returns `this`)          |
| `off(event, callback)`  | Remove event listener (returns `this`)       |
| `destroy()`             | Disconnect, end calls, release all resources |

## Events

| Event           | Callback                                                                |
|-----------------|-------------------------------------------------------------------------|
| `connecting`    | `()`                                                                    |
| `connected`     | `()`                                                                    |
| `disconnected`  | `(info: { code?: number; reason?: string })`                            |
| `registered`    | `()`                                                                    |
| `unregistered`  | `()`                                                                    |
| `registrationFailed` | `(info: { cause: string; response?: { status_code: number; reason_phrase: string } })` |
| `sessionCreated`| SIP session created, INVITE sent `(session: CallSession)`               |
| `ringing`       | `(session: CallSession)`                                                |
| `answered`      | `(session: CallSession)`                                                |
| `ended`         | `(session: CallSession, endInfo: CallEndInfo)`                          |
| `failed`        | `(session: CallSession, endInfo: CallEndInfo)`                          |
| `muted`         | `(session: CallSession)`                                                |
| `unmuted`       | `(session: CallSession)`                                                |
| `captureAudio`  | Remote audio stream available (requires opt-in) `(stream: MediaStream)` |
| `audioEnded`    | `()`                                                                    |
| `infoSent`      | `(text: string, data: Record<string, any>)`                             |
| `dtmfSent`      | `(tones: string)`                                                       |
| `infoReceived`  | `(data: { originator: string; info: { body: string } })`                |
| `transcription` | `(transcription: { originator: string; messages: { text: string }[] })` |
| `stateChanged`  | `(state: ClientState)`                                                  |
| `error`         | `(error: Error)`                                                        |

> **Note:** `error` is only emitted while a listener is registered. Failures also land in `getState().endInfo`
> and reject `connect()`.

## Call state

`getState()` returns an immutable `ClientState` snapshot; every change produces a new object and emits
`stateChanged`. Snapshots, `transcript` and its messages are frozen, so copy before modifying. `subscribe()` wraps that event and returns an unsubscribe function. It does not fire
immediately, so read `getState()` for the initial value.

```typescript
interface ClientState {
  readonly status: 'idle' | 'connecting' | 'ringing' | 'answered' | 'ended' | 'failed';
  readonly muted: boolean;
  readonly session: CallSession | null;         // includes mute and hold flags
  readonly endInfo: CallEndInfo | null;         // set when status is 'ended' or 'failed'
  readonly transcript: readonly TranscriptMessage[]; // { id, text, originator: 'bot' | 'user', timestamp }
  readonly remoteStream: MediaStream | null;    // null once the call ends or fails
  readonly localStream: MediaStream | null;
}
```

```typescript
import { SDK_END_CAUSES } from '@cognigy/click-to-call-sdk';

render(client.getState());
const unsubscribe = client.subscribe((state) => {
  render(state);
  if (state.status === 'failed' && state.endInfo?.cause === SDK_END_CAUSES.SETUP_TIMEOUT) {
    showRetry();
  }
});

// Later
unsubscribe();
```

`connect()` resets the state to `connecting`; so does `startCall()` on a client that already completed a call. A
call that ends before a SIP session exists (via `endCall()` / `disconnect()`) ends with cause `Canceled`.

### `SDK_END_CAUSES`

`endInfo.cause` values the SDK sets itself, next to JsSIP's own causes (`Busy`, `Rejected`, `Canceled`, ...):

| Cause                   | Meaning                                                     |
|-------------------------|-------------------------------------------------------------|
| `CONFIG_FETCH_FAILED`   | The endpoint config could not be fetched                    |
| `CONFIG_INVALID`        | The config lacks required fields (org, project, SIP credentials) |
| `WIDGET_INACTIVE`       | The widget is not active in the endpoint config             |
| `REGISTRATION_FAILED`   | SIP registration failed                                     |
| `SETUP_TIMEOUT`         | No SIP session within `callSetupTimeoutMs`                  |

The SDK also sets two causes that are not in `SDK_END_CAUSES`:

| Cause                   | Meaning                                                     |
|-------------------------|-------------------------------------------------------------|
| `Connection Error`      | `connect()` failed at the transport, or the transport was lost while a session existed |
| `Internal Error`        | JsSIP rejected `startCall()` (e.g. invalid target); `endInfo.description` has the message |

## Bundling

The ES and CJS bundles import `jssip` and `events`, which are installed as dependencies. The UMD bundle
(`<script>` tag) is self-contained.

## Browser Compatibility

Chrome 93+ · Firefox 92+ · Safari 15.4+ · Edge 93+

## Documentation

For the full guide, API reference, event reference, and troubleshooting:

- [Getting Started](https://docs.cognigy.com/click-to-call/sdkgetting-started.mdx)
- [API Reference](https://docs.cognigy.com/click-to-call/sdkapi-reference/overview.mdx)
- [Event Reference](https://docs.cognigy.com/click-to-call/sdkevent-reference/overview.mdx)
- [Custom Audio](https://docs.cognigy.com/click-to-call/sdkcustom-audio.mdx)
- [Security](https://docs.cognigy.com/click-to-call/sdksecurity.mdx)
- [Troubleshooting](https://docs.cognigy.com/click-to-call/sdktroubleshooting.mdx)

## License

MIT