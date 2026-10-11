'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

// Isolated UI fixture: no Threads login, network, or relationship clicks.
class FixtureElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.value = '';
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  dispatch(type) {
    this.listeners[type]?.({ target: this });
    this[`on${type}`]?.({ target: this });
  }
}

function createFixture() {
  const source = fs.readFileSync(new URL('../threads-safe-batch-manager.user.js', `file://${__dirname}/`), 'utf8');
  const instrumented = source.replace(/\n\}\)\(\);\s*$/, `
    globalThis.api = { runtime, showPreview, syncUiFromState,
      waitForScan, sleepDuringScan, ensureRelationDialog, StopRequestedError };
  })();`);
  let clock = 0;
  const storage = new Map();
  const scheduled = [];
  const context = {
    console, URL, Element: FixtureElement,
    Date: { now: () => clock },
    window: {
      location: { origin: 'https://www.threads.com', pathname: '/@owner' },
      addEventListener() {},
      setTimeout(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
      sessionStorage: {
        getItem: (key) => storage.get(key) || null,
        removeItem: (key) => storage.delete(key)
      }
    },
    document: {
      readyState: 'loading', addEventListener() {},
      createElement: (tag) => new FixtureElement(tag),
      createTextNode: (text) => ({ textContent: text })
    }
  };
  vm.runInNewContext(instrumented, context);
  const { api } = context;
  api.runtime.ui = Object.fromEntries([
    'preview', 'delay', 'status', 'mode', 'limit', 'scanButton', 'startButton',
    'pauseButton', 'resumeButton', 'skipButton', 'stopButton'
  ].map((key) => [key, new FixtureElement()]));
  api.runtime.ui.delay.value = '10';
  return {
    api,
    advance() {
      const job = scheduled.shift();
      assert.ok(job, 'expected a pending timer');
      clock += job.delay;
      job.callback();
    },
    scheduled
  };
}

test('cancelling an unopened scan does not inspect or click page controls', async () => {
  const { api } = createFixture();
  api.runtime.scanCancelled = true;
  await assert.rejects(api.ensureRelationDialog('unfollow'), api.StopRequestedError);
});

test('cancel interrupts a pending dialog poll before another lookup', async () => {
  const { api, advance } = createFixture();
  let lookups = 0;
  const waiting = api.waitForScan(() => { lookups += 1; return null; });
  const rejection = assert.rejects(waiting, api.StopRequestedError);
  api.runtime.scanCancelled = true;
  advance();
  await rejection;
  assert.equal(lookups, 1);
});

test('cancel is still honored when the final polling interval reaches timeout', async () => {
  const { api, advance } = createFixture();
  const waiting = api.waitForScan(() => null, 50, 200);
  const rejection = assert.rejects(waiting, api.StopRequestedError);
  api.runtime.scanCancelled = true;
  advance();
  await rejection;
});

test('cancel interrupts scroll settling within a 100ms timer slice', async () => {
  const { api, advance, scheduled } = createFixture();
  const waiting = api.sleepDuringScan(700);
  assert.equal(scheduled[0].delay, 100);
  const rejection = assert.rejects(waiting, api.StopRequestedError);
  api.runtime.scanCancelled = true;
  advance();
  await rejection;
  assert.equal(scheduled.length, 0);
});

test('preview selection keeps original order, permits reselecting, and updates estimates on input', () => {
  const { api } = createFixture();
  const handles = ['alice', 'bob', 'carol', 'dave'];
  api.showPreview(handles);
  const ui = api.runtime.ui;
  const [summary, controls, list] = ui.preview.children;
  const boxes = list.children.map((label) => label.children[0]);
  boxes[1].checked = false;
  boxes[1].dispatch('change');
  assert.deepEqual(Array.from(api.runtime.preview), ['alice', 'carol', 'dave']);
  controls.children[1].dispatch('click');
  assert.equal(api.runtime.preview.length, 0);
  assert.equal(ui.startButton.disabled, true);
  controls.children[0].dispatch('click');
  assert.deepEqual(Array.from(api.runtime.preview), handles);
  assert.match(summary.textContent, /已選 4\/4 筆.*約 1 分鐘/);
  ui.delay.value = '30';
  ui.delay.dispatch('input');
  assert.match(summary.textContent, /已選 4\/4 筆.*約 2 分鐘/);
  assert.equal(ui.startButton.disabled, false);
  api.showPreview([]);
  assert.equal(ui.delay.oninput, null, 'old preview must not be revived by input');
  assert.equal(ui.delay.onchange, null);
});

test('UI refresh keeps stop-scan button usable while preventing batch start', () => {
  const { api } = createFixture();
  api.runtime.scanning = true;
  api.syncUiFromState();
  assert.equal(api.runtime.ui.scanButton.disabled, false);
  assert.equal(api.runtime.ui.startButton.disabled, true);
});
