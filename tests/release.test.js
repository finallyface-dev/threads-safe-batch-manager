'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { createHash } = require('node:crypto');

const root = new URL('../', `file://${__dirname}/`);
const filename = 'threads-safe-batch-manager.user.js';
const script = fs.readFileSync(new URL(filename, root));
const source = script.toString('utf8');

function metadata() {
  const block = source.match(/^\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==\r?$/m);
  assert.ok(block && block.index === 0, 'the published file must begin with a complete userscript header');
  return [...block[1].matchAll(/^\/\/\s+@(\S+)\s+(.+)$/gm)]
    .map((match) => [match[1], match[2].trim()]);
}

test('release metadata preserves script identity, language labels and minimal permissions', () => {
  const entries = metadata();
  const values = Object.fromEntries(entries);
  assert.equal(entries.length, Object.keys(values).length, 'metadata keys must not be duplicated');
  assert.equal(values.namespace, 'urn:userscript:threads-safe-batch-manager');
  assert.equal(values.match, 'https://www.threads.com/*');
  assert.equal(values.grant, 'none');
  assert.equal(values.license, 'MIT');
  assert.equal(values['run-at'], 'document-idle');
  assert.ok(values.name && values.description);
  assert.equal(values.name, values['name:zh-TW']);
  assert.equal(values.description, values['description:zh-TW']);
  assert.ok(values['name:en'] && values['description:en']);
  assert.match(values.version, /^\d+\.\d+\.\d+$/);
  assert.match(source, /^\/\/\s+@noframes\s*$/m);
  for (const key of ['require', 'resource', 'connect', 'include', 'updateURL', 'downloadURL']) {
    assert.equal(values[key], undefined, `unexpected remote dependency, scope or update override: ${key}`);
  }
  assert.ok(script.length < 2_000_000, 'source must stay below the Greasy Fork size limit');
});

test('published checksum matches the complete userscript bytes', () => {
  const expected = createHash('sha256').update(script).digest('hex');
  const checksumFile = fs.readFileSync(new URL('SHA256SUMS', root), 'utf8').trim();
  assert.equal(checksumFile, `${expected}  ${filename}`);
});

test('Greasy Fork version and latest change notes match userscript metadata', () => {
  const version = Object.fromEntries(metadata()).version;
  const description = fs.readFileSync(new URL('GreasyFork-發布說明.md', root), 'utf8');
  assert.equal(description.match(/^- 版本：(\S+)$/m)?.[1], version);
  assert.equal(description.match(/^### (\d+\.\d+\.\d+)$/m)?.[1], version);
});

test('all bilingual release descriptions match the current version and batch defaults', () => {
  const version = Object.fromEntries(metadata()).version;
  const cap = Number(source.match(/maxBatchSize:\s*(\d+)/)?.[1]);
  const defaultSize = Number(source.match(/defaultBatchSize:\s*(\d+)/)?.[1]);
  assert.ok(Number.isInteger(cap) && Number.isInteger(defaultSize));
  for (const filename of ['README.md', 'README.en.md', 'GreasyFork-發布說明.md', 'GreasyFork-description.en.md']) {
    const description = fs.readFileSync(new URL(filename, root), 'utf8');
    assert.equal(description.match(/^#{2,3} (\d+\.\d+\.\d+)(?:\s|$)/m)?.[1], version,
      `${filename}: latest release notes must match the userscript`);
    const batch = filename.includes('.en.')
      ? description.match(/Up to (\d+) accounts per batch, with a default of (\d+)/)
      : description.match(/每批最多 (\d+) 筆，預設 (\d+) 筆/);
    assert.ok(batch, `${filename}: document the cap and default batch size together`);
    assert.equal(Number(batch[1]), cap, `${filename}: batch cap must match the script`);
    assert.equal(Number(batch[2]), defaultSize, `${filename}: default batch size must match the script`);
  }
});
