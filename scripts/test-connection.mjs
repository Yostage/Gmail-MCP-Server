#!/usr/bin/env node
// Quick smoke test: spawns the MCP server and calls search_emails to verify credentials work.
// SDK 0.4.0 uses newline-delimited JSON (not Content-Length framing).

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Check for credentials before spawning the server
const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH || join(homedir(), '.gmail-mcp', 'credentials.json');
const oauthPath = process.env.GMAIL_OAUTH_PATH || join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');

if (!existsSync(oauthPath)) {
  console.error('OAuth keys not found at:', oauthPath);
  console.error('Place your gcp-oauth.keys.json in ~/.gmail-mcp/ first.');
  process.exit(1);
}

if (!existsSync(credentialsPath)) {
  console.error('Credentials not found at:', credentialsPath);
  console.error('You need to auth first. Run:');
  console.error('  node dist/index.js auth');
  process.exit(1);
}

const server = spawn('node', [join(import.meta.dirname, '..', 'dist', 'index.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let requestId = 0;

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

server.stderr.on('data', (d) => process.stderr.write(d));

const rl = createInterface({ input: server.stdout });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let resp;
  try {
    resp = JSON.parse(line);
  } catch {
    return;
  }

  if (resp.id === 1) {
    console.log('Server initialized OK');
    notify('notifications/initialized');
    send('tools/call', {
      name: 'search_emails',
      arguments: { query: 'newer_than:7d', maxResults: 3 },
    });
  } else if (resp.id === 2) {
    if (resp.error) {
      console.error('ERROR:', resp.error);
    } else {
      console.log('Credentials working! Recent emails:');
      console.log(resp.result?.content?.[0]?.text || '(no results)');
    }
    server.kill();
    process.exit(resp.error ? 1 : 0);
  }
});

// Start with initialize
send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'test-client', version: '1.0.0' },
});

setTimeout(() => {
  console.error('Timed out after 15s');
  server.kill();
  process.exit(1);
}, 15000);
