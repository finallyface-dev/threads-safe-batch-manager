'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sourcePath = new URL('../threads-safe-batch-manager.user.js', `file://${__dirname}/`);
const source = fs.readFileSync(sourcePath, 'utf8');
const instrumented = source.replace(
  /\n\}\)\(\);\s*$/,
  `\n  globalThis.__userscriptTest = {\n` +
  `    CONFIG, MODE, LABELS, runtime, sanitizeState, readState, saveState,\n` +
  `    normalizeText, profileTabBoundary, findUniqueProfileMore, relationRowForLink\n` +
  `  };\n})();`
);

assert.notEqual(instrumented, source, 'test instrumentation must attach before the IIFE closes');

class FakeElement {}

const storage = new Map();
const sessionStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  }
};

const context = {
  console,
  URL,
  Element: FakeElement,
  window: {
    location: {
      origin: 'https://www.threads.com',
      pathname: '/@owner',
      href: 'https://www.threads.com/@owner?hl=zh-tw'
    },
    sessionStorage,
    addEventListener() {},
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflowY: 'auto'
    })
  },
  document: {
    readyState: 'loading',
    addEventListener() {}
  },
  setTimeout,
  clearTimeout
};

vm.createContext(context);
vm.runInContext(instrumented, context, { filename: 'threads-safe-batch-manager.user.js' });

const api = context.__userscriptTest;
assert.ok(api, 'instrumented userscript must expose test API');

const validState = {
  version: 1,
  token: '12345678-abcd',
  mode: 'removeFollowers',
  status: 'paused',
  phase: 'beforeAction',
  queue: ['Alice', 'bob.test'],
  total: 2,
  index: 0,
  completedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  delayMs: 10000,
  originHandle: 'Owner',
  originUrl: 'https://www.threads.com/@owner?hl=zh-tw',
  expectedHandle: 'Alice',
  handoffUntil: 0,
  confirmedAt: Date.now(),
  nextActionNotBefore: 0,
  pauseRequested: false,
  lastMessage: ''
};

const clean = api.sanitizeState(validState);
assert.deepEqual(Array.from(clean.queue), ['alice', 'bob.test']);
assert.equal(clean.originHandle, 'owner');
assert.equal(clean.expectedHandle, 'alice');
assert.equal(api.sanitizeState({ ...validState, queue: ['alice', 'bad handle'] }), null);
assert.equal(api.sanitizeState({ ...validState, queue: ['Alice', 'alice'] }), null);
assert.equal(api.sanitizeState({ ...validState, status: 'mystery' }), null);
assert.equal(api.sanitizeState({ ...validState, phase: 'mystery' }), null);
assert.equal(api.sanitizeState({ ...validState, token: 'short' }), null);
assert.equal(api.normalizeText('  ＦＯＬＬＯＷＩＮＧ\u200b  '), 'following');
assert.ok(api.LABELS.followingAction.some((pattern) => pattern.test('已追蹤')));
assert.ok(api.LABELS.followingAction.some((pattern) => pattern.test('Following @alice')));
assert.ok(api.LABELS.unfollow.some((pattern) => pattern.test('取消追蹤 @alice')));

function fakeElement({ attrs = {}, top = 0, width = 100, height = 40, text = '', closestMap = {}, queries = {} } = {}) {
  const element = new FakeElement();
  element.isConnected = true;
  element.innerText = text;
  element.textContent = text;
  element.parentElement = null;
  element.getAttribute = (name) => attrs[name] ?? null;
  element.closest = (selector) => closestMap[selector] || null;
  element.querySelectorAll = (selector) => queries[selector] || [];
  element.getBoundingClientRect = () => ({ top, left: 0, width, height });
  return element;
}

const profileLink = fakeElement({ attrs: { href: '/@owner/replies' }, top: 300 });
const mediaLink = fakeElement({ attrs: { href: '/@owner/media' }, top: 300 });
const moreButton = fakeElement({ attrs: { 'aria-haspopup': 'dialog', 'aria-label': '更多' }, top: 190 });
const postMore = fakeElement({
  attrs: { 'aria-haspopup': 'dialog', 'aria-label': '更多' },
  top: 450,
  closestMap: { 'article, [role="listitem"]': {} }
});
const profileRegion = fakeElement({
  queries: {
    'a[href^="/@"]': [profileLink, mediaLink],
    'button, [role="button"]': [moreButton, postMore]
  }
});
assert.equal(api.profileTabBoundary(profileRegion), 300);
assert.equal(api.findUniqueProfileMore(profileRegion), moreButton);

const secondHeaderMore = fakeElement({ attrs: { 'aria-haspopup': 'dialog', 'aria-label': '更多' }, top: 200 });
const ambiguousRegion = fakeElement({
  queries: {
    'a[href^="/@"]': [profileLink, mediaLink],
    'button, [role="button"]': [moreButton, secondHeaderMore]
  }
});
assert.equal(api.findUniqueProfileMore(ambiguousRegion), null, 'ambiguous profile menus must fail closed');

const relationLink = fakeElement({ attrs: { href: '/@alice' }, top: 10 });
const arbitraryButton = fakeElement({ attrs: { 'aria-label': '其他' }, top: 10 });
const followingButton = fakeElement({ attrs: { 'aria-label': '追蹤中' }, top: 10 });
const followButton = fakeElement({ attrs: { 'aria-label': '追蹤對方' }, top: 10 });
const dialog = fakeElement();
const makeRow = (button) => fakeElement({
  height: 60,
  queries: {
    'a[href^="/@"]': [relationLink],
    'button, [role="button"]': [button]
  }
});
let row = makeRow(arbitraryButton);
relationLink.parentElement = row;
row.parentElement = dialog;
assert.equal(api.relationRowForLink(relationLink, dialog, api.MODE.UNFOLLOW), null);
row = makeRow(followingButton);
relationLink.parentElement = row;
row.parentElement = dialog;
assert.equal(api.relationRowForLink(relationLink, dialog, api.MODE.UNFOLLOW), row);
row = makeRow(followButton);
relationLink.parentElement = row;
row.parentElement = dialog;
assert.equal(api.relationRowForLink(relationLink, dialog, api.MODE.REMOVE_FOLLOWERS), row);

storage.set(api.CONFIG.storageKey, JSON.stringify(validState));
assert.equal(api.readState().queue[0], 'alice');

const originalGetItem = sessionStorage.getItem;
const originalRemoveItem = sessionStorage.removeItem;
sessionStorage.getItem = () => {
  throw new Error('storage blocked');
};
sessionStorage.removeItem = () => {
  throw new Error('storage blocked');
};
assert.equal(api.readState(), null, 'readState must fail closed when storage access throws');
sessionStorage.getItem = originalGetItem;
sessionStorage.removeItem = originalRemoveItem;

const originalSetItem = sessionStorage.setItem;
sessionStorage.setItem = () => {
  throw new Error('storage blocked');
};
assert.throws(() => api.saveState(validState), /無法寫入分頁暫存/);
assert.equal(api.runtime.stopped, true);
assert.equal(storage.has(api.CONFIG.storageKey), false, 'failed writes must remove an older active snapshot when possible');
sessionStorage.setItem = originalSetItem;

const eventCallbacks = [...source.matchAll(/addEventListener\(\s*['"][^'"]+['"]\s*,\s*([A-Za-z_$][\w$]*)/g)]
  .map((match) => match[1]);
for (const callback of eventCallbacks) {
  assert.match(source, new RegExp(`(?:function|const|let|var)\\s+${callback}\\b`), `missing callback: ${callback}`);
}

console.log(`userscript tests passed (${eventCallbacks.length} named event callbacks checked)`);
