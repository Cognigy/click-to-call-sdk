# Click To Call SDK

A standalone, framework-agnostic SDK for SIP-based voice calling with WebRTC. Built on JsSIP.

## Features

- 🚀 **Framework Agnostic** — works with React, Angular, Vue, or vanilla JS.
- 🔒 **Type Safe** — full TypeScript support.
- 📞 **SIP/WebRTC** — built on JsSIP for reliable communication.
- 🎛️ **Full Control** — start, end, mute, unmute, send info messages.
- 🔄 **Event Driven** — 17 events for real-time state updates.
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
}
```

## API

| Method                  | Description                                  |
|-------------------------|----------------------------------------------|
| `connect()`             | Connect to SIP server and register           |
| `disconnect()`          | Disconnect from SIP server                   |
| `connectAndCall()`      | Connect + start call in one step             |
| `startCall()`           | Start a call (must be connected first)       |
| `endCall()`             | End the current call                         |
| `mute()` / `unmute()`   | Toggle microphone                            |
| `sendInfo(text, data?)` | Send info message during a call              |
| `sendDTMF(tones, options?)` | Send DTMF tones (`0-9 A-D # * ,`) during a call |
| `isConnected()`         | Check connection state                       |
| `getCurrentSession()`   | Get active `CallSession` or `null`           |
| `on(event, callback)`   | Add event listener (returns `this`)          |
| `off(event, callback)`  | Remove event listener (returns `this`)       |
| `destroy()`             | Disconnect, end calls, release all resources |

## Events

| Event           | Callback                                                                |
|-----------------|-------------------------------------------------------------------------|
| `connecting`    | `()`                                                                    |
| `connected`     | `()`                                                                    |
| `disconnected`  | `()`                                                                    |
| `registered`    | `()`                                                                    |
| `unregistered`  | `()`                                                                    |
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
| `error`         | `(error: Error)`                                                        |

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