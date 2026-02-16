#!/usr/bin/env node
// Fetches raw HTML body from Gmail messages and saves to tmp/ directory.
// Usage: node scripts/dump-html.mjs <messageId1> <messageId2> ...

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH || join(homedir(), '.gmail-mcp', 'credentials.json');
const oauthPath = process.env.GMAIL_OAUTH_PATH || join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');

if (!existsSync(credentialsPath)) {
  console.error('You need to auth first. Run: node dist/index.js auth');
  process.exit(1);
}

const messageIds = process.argv.slice(2);
if (messageIds.length === 0) {
  console.error('Usage: node scripts/dump-html.mjs <messageId1> <messageId2> ...');
  process.exit(1);
}

const server = spawn('node', [join(import.meta.dirname, '..', 'dist', 'index.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, GMAIL_CREDENTIALS_PATH: credentialsPath, GMAIL_OAUTH_PATH: oauthPath },
});

let requestId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++requestId;
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  server.stdin.write(msg + '\n');
  return id;
}

function notify(method, params = {}) {
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
  server.stdin.write(msg + '\n');
}

server.stderr.on('data', () => {});

const rl = createInterface({ input: server.stdout });
let initialized = false;

rl.on('line', (line) => {
  if (!line.trim()) return;
  let resp;
  try { resp = JSON.parse(line); } catch { return; }

  if (resp.id === 1) {
    // Initialized — send all read_email requests
    notify('notifications/initialized');
    initialized = true;
    for (const msgId of messageIds) {
      const id = send('tools/call', { name: 'read_email', arguments: { messageId: msgId } });
      pending.set(id, msgId);
    }
  } else if (pending.has(resp.id)) {
    const msgId = pending.get(resp.id);
    pending.delete(resp.id);

    const text = resp.result?.content?.[0]?.text || '';

    // Extract subject from the response for the filename
    const subjectMatch = text.match(/^Subject: (.+)$/m);
    const subject = subjectMatch ? subjectMatch[1].replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50) : msgId;

    const tmpDir = join(import.meta.dirname, '..', 'tmp');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    const filename = `${msgId}_${subject}.html`;
    const filepath = join(tmpDir, filename);

    // The HTML content is everything after the headers block
    // Look for the HTML content - it starts after the blank line following headers
    const htmlMatch = text.match(/<!DOCTYPE[^]*$/i) || text.match(/<html[^]*$/i);
    if (htmlMatch) {
      writeFileSync(filepath, htmlMatch[0]);
      console.log(`Saved HTML: ${filename}`);
    } else {
      // No HTML found, save the whole body as .txt
      const txtFilename = `${msgId}_${subject}.txt`;
      writeFileSync(join(tmpDir, txtFilename), text);
      console.log(`No HTML found, saved text: ${txtFilename}`);
    }

    if (pending.size === 0) {
      server.kill();
      process.exit(0);
    }
  }
});

send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'dump-html', version: '1.0.0' },
});

setTimeout(() => {
  console.error('Timed out');
  server.kill();
  process.exit(1);
}, 30000);
