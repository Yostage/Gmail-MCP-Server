#!/usr/bin/env node
// Tests HTML-to-markdown converters against sample emails in tmp/.
// Outputs results to tmp/converted/ for comparison.
//
// Usage: node scripts/test-converters.mjs

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';

const tmpDir = join(import.meta.dirname, '..', 'tmp');
const outDir = join(tmpDir, 'converted');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const htmlFiles = readdirSync(tmpDir).filter(f => f.endsWith('.html'));

if (htmlFiles.length === 0) {
  console.error('No HTML files found in tmp/');
  process.exit(1);
}

console.log(`Found ${htmlFiles.length} HTML files\n`);

// --- Email-optimized HTML to markdown pipeline ---

function cleanEmailHtml(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Remove style, script, head elements
  for (const tag of ['style', 'script', 'head']) {
    doc.querySelectorAll(tag).forEach(el => el.remove());
  }

  // Remove tracking pixels and spacer images
  doc.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    const width = img.getAttribute('width');
    const height = img.getAttribute('height');
    if ((width === '1' && height === '1') || width === '0' || height === '0') {
      img.remove();
    }
    if (/pixel\.gif|spacer\.gif|transp\.gif/i.test(src)) {
      img.remove();
    }
    // Remove cid: embedded images (can't be displayed anyway)
    if (src.startsWith('cid:')) {
      img.remove();
    }
  });

  // Remove elements with display:none
  doc.querySelectorAll('[style]').forEach(el => {
    const style = el.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(style)) {
      el.remove();
    }
  });

  return doc.body ? doc.body.innerHTML : doc.documentElement.innerHTML;
}

function createEmailTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });

  // Strip images entirely — LLMs can't render them, and alt text is usually
  // just product names which are already in link text nearby
  td.addRule('removeImages', {
    filter: 'img',
    replacement: () => '',
  });

  // For links with images inside, just use the link text or URL
  td.addRule('imageLinks', {
    filter: (node) => {
      return node.nodeName === 'A' && node.querySelector('img') && !node.textContent.trim();
    },
    replacement: () => '',
  });

  return td;
}

function cleanMarkdown(md) {
  return md
    // Collapse 3+ newlines to 2
    .replace(/\n{3,}/g, '\n\n')
    // Remove lines that are just whitespace
    .replace(/^\s+$/gm, '')
    // Remove zero-width chars and invisible Unicode
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, '')
    // Remove soft hyphens
    .replace(/\u00AD/g, '')
    .trim();
}

const emailTurndown = createEmailTurndown();
const rawTurndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

for (const file of htmlFiles) {
  const html = readFileSync(join(tmpDir, file), 'utf-8');
  const name = basename(file, '.html');

  console.log(`=== ${file} (${(html.length / 1024).toFixed(0)}K) ===`);

  // 1) Turndown only (raw, for comparison)
  try {
    const md = rawTurndown.turndown(html);
    const outPath = join(outDir, `${name}.turndown-raw.md`);
    writeFileSync(outPath, md);
    console.log(`  turndown(raw):     ${md.length} chars`);
  } catch (e) {
    console.error(`  turndown(raw) ERROR: ${e.message}`);
  }

  // 2) Clean HTML + email-tuned turndown + markdown cleanup
  try {
    const cleaned = cleanEmailHtml(html);
    const md = cleanMarkdown(emailTurndown.turndown(cleaned));
    const outPath = join(outDir, `${name}.clean+turndown.md`);
    writeFileSync(outPath, md);
    console.log(`  clean+turndown:    ${md.length} chars → ${basename(outPath)}`);
  } catch (e) {
    console.error(`  clean+turndown ERROR: ${e.message}`);
  }

  console.log();
}

console.log('Done. Compare results in tmp/converted/');
