# Click to Call SDK

A standalone, framework-agnostic Click to Call SDK for SIP-based voice calling with custom audio support.

## Features

- 🚀 **Framework Agnostic**: Works with any JavaScript framework or vanilla JS
- 🔒 **Type Safe**: Full TypeScript support with comprehensive type definitions
- 🎵 **Custom Audio**: Support for custom audio handling and events
- 📞 **SIP Protocol**: Built on JsSIP for reliable SIP communication
- 🎛️ **Full Control**: Complete call control (start, end, mute, unmute, info messages)
- 🔄 **Event Driven**: Rich event system for real-time updates
- 📦 **Self Contained**: All dependencies bundled, easy to integrate

## Installation

```bash
npm install @cognigy/click-to-call-sdk
```

## Quick Start

```typescript
import { createWebRTCClient } from '@cognigy/click-to-call-sdk';

// Create client
const client = await createWebRTCClient({
  endpointUrl: 'https://your-api.com/webrtc-config',
  userId: 'user-123'
});

// Set up event listeners
client.on('ringing', (session) => {
  console.log('Call is ringing');
});

client.on('answered', (session) => {
  console.log('Call answered');
});

client.on('ended', (session, endInfo) => {
  console.log('Call ended:', endInfo);
});

// Connect and make a call (option 1: separate calls)
await client.connect();
await client.startCall();

// Or use connectAndCall for convenience (option 2: combined)
await client.connectAndCall();
```

## Configuration

### WebRTCClientConfig

```typescript
interface WebRTCClientConfig {
  endpointUrl: string;        // URL to fetch SIP configuration
  userId?: string;            // Optional user identifier
  pcConfig?: RTCConfiguration; // WebRTC peer connection config
}
```


## API Reference

### Core Methods

#### `connect(): Promise<void>`
Connect to the SIP server and register the client.

```typescript
await client.connect();
```

#### `disconnect(): Promise<void>`
Disconnect from the SIP server.

```typescript
await client.disconnect();
```

#### `connectAndCall(): Promise<void>`
Connect to the SIP server and start a call in one operation. This is a convenience method that combines `connect()` and `startCall()`.

```typescript
await client.connectAndCall();
```

#### `startCall(): Promise<void>`
Start a new call. Requires the client to be connected first (call `connect()` or `connectAndCall()`).

```typescript
await client.connect();
await client.startCall();
```

#### `endCall(): Promise<void>`
End the current call.

```typescript
await client.endCall();
```

#### `mute(): Promise<void>`
Mute the current call.

```typescript
await client.mute();
```

#### `unmute(): Promise<void>`
Unmute the current call.

```typescript
await client.unmute();
```

#### `sendInfo(text: string, data?: Record<string, any>): Promise<void>`
Send info message during a call.

```typescript
await client.sendInfo('Hello', { key: 'value' });
```

### State Methods

#### `isConnected(): boolean`
Check if the client is connected and registered.

```typescript
if (client.isConnected()) {
  console.log('Ready to make calls');
}
```

#### `getCurrentSession(): CallSession | null`
Get the current active call session.

```typescript
const session = client.getCurrentSession();
if (session) {
  console.log('Active call:', session.id);
}
```

### Event Handling

#### `on<T extends EventName>(event: T, callback: EventCallback<T>): void`
Add an event listener.

#### `off<T extends EventName>(event: T, callback: EventCallback<T>): void`
Remove an event listener.

### Events

| Event | Description | Callback Parameters |
|-------|-------------|-------------------|
| `connecting` | SIP connection starting | `()` |
| `connected` | SIP connected | `()` |
| `disconnected` | SIP disconnected | `()` |
| `registered` | SIP registered | `()` |
| `unregistered` | SIP unregistered | `()` |
| `answered` | Call was answered | `(session: CallSession)` |
| `ended` | Call ended normally | `(session: CallSession, endInfo: CallEndInfo)` |
| `failed` | Call failed | `(session: CallSession, endInfo: CallEndInfo)` |
| `muted` | Call was muted | `(session: CallSession)` |
| `unmuted` | Call was unmuted | `(session: CallSession)` |
| `audioRequired` | Remote audio stream available | `(stream: MediaStream)` |
| `audioEnded` | Audio stream ended | `()` |
| `infoSent` | Info message sent | `(text: string, data: Record<string, any>)` |
| `infoReceived` | Info message received | `(info: { text: string; data: Record<string, any> })` |
| `transcription` | Transcription data received | `(transcription: IChatMessage)` |
| `error` | Error occurred | `(error: Error)` |

## Custom Audio Handling

The SDK supports custom audio handling for advanced use cases:

```typescript
const client = await createWebRTCClient({
  endpointUrl: 'https://your-api.com/webrtc-config',
  userId: 'mockId'
});

// Handle audio end
client.on('audioEnded', () => {
  const audioElement = document.getElementById('remote-audio') as HTMLAudioElement;
  audioElement.srcObject = null;
});
```

## Receiving Transcription Events

The SDK automatically separates transcription data from regular info messages. Transcription events are emitted separately via the `transcription` event:

```typescript
const client = await createWebRTCClient({
  endpointUrl: 'https://your-api.com/webrtc-config',
  userId: 'user-123'
});

// Listen for transcription events
client.on('transcription', (transcription) => {
  console.log('Transcription originator:', transcription.originator);
  console.log('Transcription messages:', transcription.messages);
  
  // transcription.messages is an array of message objects
  transcription.messages.forEach((message) => {
    console.log('Text:', message.text);
  });
});
```

**Note:** Transcription events are automatically filtered from `infoReceived` events. If an info message contains a `_transcription` property, it will only be emitted as a `transcription` event, not as `infoReceived`.

### Transcription Data Type

The transcription event provides data in the following format:

```typescript
interface IChatMessage {
  originator: 'user' | 'bot';
  messages: { text: string }[];
}
```

## Error Handling

```typescript
try {
  await client.connect();
  await client.startCall();
} catch (error) {
  console.error('Call failed:', error.message);
}

// Or using events
client.on('error', (error) => {
  console.error('SDK Error:', error.message);
});
```

## Complete Example

```typescript
import { createWebRTCClient, checkWebRTCSupport } from '@cognigy/click-to-call-sdk';

async function initializeWebRTC() {
  // Check WebRTC support
  const support = checkWebRTCSupport();
  if (!support.supported) {
    console.error('WebRTC not supported:', support.missing);
    return;
  }

  // Create client
  const client = await createWebRTCClient({
    endpointUrl: 'https://your-api.com/webrtc-config',
    userId: 'user-123',
  });

  // Set up event listeners
  client.on('connecting', () => {
    console.log('Connecting to SIP server...');
  });

  client.on('connected', () => {
    console.log('Connected to SIP server');
  });

  client.on('registered', () => {
    console.log('SIP client registered');
  });

  client.on('answered', (session) => {
    console.log('Call answered:', session.id);
    updateUI('answered');
  });

  client.on('ended', (session, endInfo) => {
    console.log('Call ended:', endInfo);
    updateUI('ended');
  });

  client.on('audioRequired', (stream) => {
    // Handle custom audio
    const audioElement = document.getElementById('remote-audio') as HTMLAudioElement;
    audioElement.srcObject = stream;
    audioElement.play();
  });

  client.on('transcription', (transcription) => {
    console.log('Transcription received:', transcription.originator);
    transcription.messages.forEach((message) => {
      console.log('Transcription text:', message.text);
      // Update UI with transcription text
      updateTranscriptionUI(transcription.originator, message.text);
    });
  });

  client.on('error', (error) => {
    console.error('WebRTC Error:', error.message);
    updateUI('error', error.message);
  });

  // Connect
  try {
    await client.connect();
    console.log('WebRTC client ready');
  } catch (error) {
    console.error('Failed to connect:', error);
  }

  return client;
}

function updateUI(state: string, message?: string) {
  // Update your UI based on call state
  const statusElement = document.getElementById('call-status');
  if (statusElement) {
    statusElement.textContent = message || state;
  }
}

function updateTranscriptionUI(originator: 'user' | 'bot', text: string) {
  // Update your UI with transcription text
  const transcriptionElement = document.getElementById('transcription');
  if (transcriptionElement) {
    const prefix = originator === 'user' ? 'User: ' : 'Bot: ';
    transcriptionElement.textContent += prefix + text + '\n';
  }
}

// Usage
const client = await initializeWebRTC();

// Start a call (if already connected)
document.getElementById('call-button')?.addEventListener('click', async () => {
  try {
    await client.startCall();
  } catch (error) {
    console.error('Failed to start call:', error);
  }
});

// Or connect and call in one step
document.getElementById('connect-and-call-button')?.addEventListener('click', async () => {
  try {
    await client.connectAndCall();
  } catch (error) {
    console.error('Failed to connect and call:', error);
  }
});

// End call
document.getElementById('end-button')?.addEventListener('click', async () => {
  try {
    await client.endCall();
  } catch (error) {
    console.error('Failed to end call:', error);
  }
});

// Mute/unmute
document.getElementById('mute-button')?.addEventListener('click', async () => {
  const session = client.getCurrentSession();
  if (session) {
    try {
      if (session.muted) {
        await client.unmute();
      } else {
        await client.mute();
      }
    } catch (error) {
      console.error('Failed to toggle mute:', error);
    }
  }
});


// Cleanup on page unload
window.addEventListener('beforeunload', async () => {
  await client.destroy();
});
```

## TypeScript Support

The SDK is written in TypeScript and provides comprehensive type definitions:

```typescript
import type { 
  WebRTCClient,
  CallSession,
  CallEndInfo,
  WebRTCClientEvents 
} from '@cognigy/click-to-call-sdk';

// Type-safe event handling
const handleAnswered: WebRTCClientEvents['answered'] = (session) => {
  console.log('Call answered:', session.id);
};

client.on('answered', handleAnswered);
```

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## License

MIT

## Support

For issues and questions, please visit our [GitHub repository](https://github.com/cognigy/webrtc-sdk).
