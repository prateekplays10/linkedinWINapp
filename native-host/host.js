// host.js — Link Lead Native Messaging Host
// Communicates with Chrome via stdin/stdout and Electron via local WebSocket

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Log files for debugging (since console.log is stdout and will crash Chrome parser)
const LOG_FILE = path.join(__dirname, 'native-host.log');
function log(msg) {
  fs.appendFileSync(LOG_FILE, `[${new Date().toLocaleTimeString()}] ${msg}\n`);
}

log('Native Host started.');

// Connect to Electron's local WebSocket server
const ws = new WebSocket('ws://localhost:9292');

ws.on('open', () => {
  log('Connected to Electron App WebSocket.');
  ws.send(JSON.stringify({ action: 'REGISTER_EXTENSION', version: '2.1.0' }));
});

ws.on('message', (data) => {
  try {
    const payload = JSON.parse(data.toString());
    log(`Received from Electron: ${payload.action}`);
    sendToChrome(payload);
  } catch (err) {
    log(`Error parsing message from Electron: ${err.message}`);
  }
});

ws.on('error', (err) => {
  log(`WebSocket error: ${err.message}`);
});

ws.on('close', () => {
  log('Electron App WebSocket connection closed.');
  process.exit(0);
});

// ─── CHROME PROTOCOL: READ STDIN ─────────────────────────────────────────────
let inputBuffer = Buffer.alloc(0);

process.stdin.on('readable', () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
  }
  processBuffer();
});

function processBuffer() {
  while (inputBuffer.length >= 4) {
    // Read 32-bit little-endian message length prefix
    const msgLen = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + msgLen) {
      break; // Full message not arrived yet
    }
    const msgBuf = inputBuffer.subarray(4, 4 + msgLen);
    inputBuffer = inputBuffer.subarray(4 + msgLen);

    try {
      const msg = JSON.parse(msgBuf.toString('utf8'));
      log(`Received from Chrome: ${msg.action}`);
      
      // Relay immediately to Electron WebSocket
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else {
        log('Failed to relay: WebSocket not connected.');
      }
    } catch (err) {
      log(`Error parsing message from Chrome: ${err.message}`);
    }
  }
}

// ─── CHROME PROTOCOL: WRITE STDOUT ────────────────────────────────────────────
function sendToChrome(msg) {
  try {
    const jsonStr = JSON.stringify(msg);
    const msgBuf = Buffer.from(jsonStr, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(msgBuf.length, 0);

    process.stdout.write(lenBuf);
    process.stdout.write(msgBuf);
  } catch (err) {
    log(`Error sending message to Chrome: ${err.message}`);
  }
}

// Handle termination cleanly
process.on('SIGTERM', () => {
  log('Received SIGTERM. Exiting.');
  process.exit(0);
});
