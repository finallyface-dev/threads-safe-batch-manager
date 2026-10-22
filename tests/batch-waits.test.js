'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

// All account names and controls are local fixtures. No network or live clicks.
function createFixture() {
  const source = fs.readFileSync(new URL('../threads-safe-batch-manager.user.js', `file://${__dirname}/`), 'utf8');
  const storage = new Map();
  let clock = 1000;
  const fixture = {
    owner: 'owner', safetyMessage: null, clicks: [], navigation: [],
    getRegion: () => ({}),
    getRelation: () => ({ element: {}, state: 'following' }),
    elements: () => [], confirmElement: {},
    onSleep: () => {}, onClick: () => {}
  };
  fixture.findAction = () => fixture.confirmElement;
  const context = {
    console, URL, Element: class {}, fixture,
    Date: { now: () => clock },
    window: {
      location: {
        origin: 'https://www.threads.com', pathname: '/@alice',
        href: 'https://www.threads.com/@alice',
        assign: (url) => fixture.navigation.push(url)
      },
      addEventListener() {}, setTimeout() {},
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      sessionStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key)
      }
    },
    document: { readyState: 'loading', addEventListener() {} }
  };
  fixture.sleep = async (milliseconds) => {
    clock += milliseconds;
    fixture.onSleep(milliseconds);
  };
  const instrumented = source.replace(/\n\}\)\(\);\s*$/, `
    getOwnHandle = () => fixture.owner;
    detectedSafetyStopMessage = () => {
      const message = fixture.safetyMessage;
      if (fixture.transientSafety) fixture.safetyMessage = null;
      return message;
    };
    getProfileRegion = () => fixture.getRegion();
    findPrimaryProfileRelation = () => fixture.getRelation();
    visibleElements = (root, selector) => fixture.elements(root, selector);
    findUniqueProfileMore = () => ({});
    findActionInSurface = (surface, patterns) => fixture.findAction(surface, patterns);
    clickVisibleElement = (element) => {
      fixture.clicks.push(element);
      fixture.onClick(element);
    };
    sleep = (milliseconds) => fixture.sleep(milliseconds);
    globalThis.api = {
      runtime, waitFor, waitForRun, saveState, readState, unfollowCurrentProfile, openProfileMenu,
      removeFollowerOnCurrentProfile,
      resumeHandoff, StopRequestedError, PauseRequestedError, SafetyPauseError,
      replaceProcessor(processor) { processCurrentTarget = processor; }
    };
  })();`);
  assert.notEqual(instrumented, source);
  vm.runInNewContext(instrumented, context);
  const { api } = context;
  const state = api.saveState({
    version: 1, token: '12345678-abcd', mode: 'unfollow', status: 'running',
    phase: 'beforeAction', queue: ['alice', 'carol'], total: 2, index: 0,
    delayMs: 10000, originHandle: 'owner', originUrl: 'https://www.threads.com/@owner',
    expectedHandle: 'alice', confirmedAt: clock, handoffUntil: clock + 60000
  });
  return { api, fixture, state, location: context.window.location, Element: context.Element };
}

function createRemovalFixture() {
  const result = createFixture();
  const { api, fixture, Element } = result;
  result.state = api.saveState({ ...result.state, mode: 'removeFollowers' });
  const element = (text) => Object.assign(new Element(), {
    innerText: text, textContent: text, isConnected: true,
    getAttribute: () => null, closest: () => null, contains: () => false,
    getBoundingClientRect: () => ({ width: 100, height: 40 })
  });
  const removeItem = element('Remove follower');
  const confirmButton = element('Remove');
  const confirmation = element('Remove follower');
  const blockItem = element('Block');
  let menu = null;
  let confirmationOpen = false;
  let confirmed = false;
  fixture.elements = (root, selector) => {
    if (selector === '[role="menu"]') return menu ? [menu] : [];
    if (selector === '[role="menuitem"]') return [confirmed ? blockItem : removeItem];
    if (selector === '[role="dialog"]') return confirmationOpen ? [confirmation] : [];
    return [];
  };
  fixture.findAction = (surface) => surface === confirmation
    ? confirmButton
    : (confirmed ? null : removeItem);
  fixture.onClick = (clicked) => {
    if (clicked === removeItem) {
      menu = null;
      confirmationOpen = true;
      fixture.onRemovalSent?.();
    } else if (clicked === confirmButton) {
      confirmed = true;
    } else {
      menu = element('Profile menu');
    }
  };
  fixture.onSleep = (milliseconds) => {
    if (milliseconds === 200 && confirmed && confirmationOpen) {
      confirmation.isConnected = false;
      confirmationOpen = false;
      fixture.onConfirmationClosed?.();
    }
  };
  return result;
}

for (const name of ['StopRequestedError', 'PauseRequestedError', 'SafetyPauseError']) {
  test(`polling propagates ${name} without retrying`, async () => {
    const { api } = createFixture();
    let lookups = 0;
    await assert.rejects(api.waitFor(() => {
      lookups += 1;
      throw new api[name]('fixture stop');
    }, 400), api[name]);
    assert.equal(lookups, 1);
  });
}

test('polling still tolerates a temporary ordinary lookup error', async () => {
  const { api } = createFixture();
  let lookups = 0;
  const result = await api.waitFor(() => {
    lookups += 1;
    if (lookups === 1) throw new Error('temporary render error');
    return 'ready';
  }, 400);
  assert.equal(result, 'ready');
  assert.equal(lookups, 2);
});

test('a transient safety warning during a batch wait stops it permanently', async () => {
  const { api, fixture, state } = createFixture();
  let lookups = 0;
  fixture.transientSafety = true;
  fixture.onSleep = () => { fixture.safetyMessage = 'Threads restriction'; };
  await assert.rejects(api.waitForRun(() => {
    lookups += 1;
    return lookups > 1;
  }, state.token, 1000, true), api.SafetyPauseError);
  assert.equal(fixture.safetyMessage, null, 'warning disappeared after being read');
  assert.equal(lookups, 1, 'the wait must not accept a later successful result');
});

test('batch wait rejects a result when the profile changes inside its lookup', async () => {
  const { api, state, location } = createFixture();
  await assert.rejects(api.waitForRun(() => {
    location.pathname = '/@bob';
    return 'ready';
  }, state.token, 1000, true), api.SafetyPauseError);
});

test('batch wait checks cancellation at the final timeout boundary', async () => {
  const { api, fixture, state } = createFixture();
  fixture.onSleep = () => { api.runtime.stopped = true; };
  await assert.rejects(api.waitForRun(() => null, state.token, 50, true), api.StopRequestedError);
});

test('pause blocks a new action but permits verification of an action already sent', async () => {
  const { api, state } = createFixture();
  api.saveState({ ...state, pauseRequested: true });
  await assert.rejects(api.waitForRun(() => true, state.token), api.PauseRequestedError);
  assert.equal(await api.waitForRun(() => 'verified', state.token, 1000, true), 'verified');
});

test('unfollow cannot count another profile as successful verification', async () => {
  const { api, fixture, state, location } = createFixture();
  let regionReads = 0;
  fixture.getRegion = () => {
    regionReads += 1;
    if (regionReads === 2) location.pathname = '/@bob';
    return {};
  };
  fixture.getRelation = () => ({
    element: {}, state: regionReads > 1 ? 'notFollowing' : 'following'
  });
  await assert.rejects(api.unfollowCurrentProfile(state), api.SafetyPauseError);
  assert.equal(fixture.clicks.length, 1);
  assert.equal(api.readState().phase, 'actionClicked');
});

test('a restriction appearing alongside a success indicator does not count as success', async () => {
  const { api, fixture, state } = createFixture();
  let relationReads = 0;
  fixture.getRelation = () => {
    relationReads += 1;
    if (relationReads > 1) fixture.safetyMessage = 'Threads restriction';
    return { element: {}, state: relationReads > 1 ? 'notFollowing' : 'following' };
  };
  await assert.rejects(api.unfollowCurrentProfile(state), api.SafetyPauseError);
  assert.equal(fixture.clicks.length, 1);
});

test('menu loading stops when a transient restriction appears', async () => {
  const { api, fixture, state } = createFixture();
  fixture.transientSafety = true;
  fixture.onSleep = () => { fixture.safetyMessage = 'Threads restriction'; };
  await assert.rejects(api.openProfileMenu({}, state.token), api.SafetyPauseError);
  assert.equal(fixture.clicks.length, 1, 'only the non-destructive More button was clicked');
});

test('verification after a confirmation click rejects an account switch', async () => {
  const { api, fixture, state } = createFixture();
  fixture.elements = () => fixture.clicks.length ? [{}] : [];
  fixture.getRelation = () => {
    if (fixture.clicks.length === 2) fixture.owner = 'another.owner';
    return { element: {}, state: fixture.clicks.length === 2 ? 'notFollowing' : 'following' };
  };
  await assert.rejects(api.unfollowCurrentProfile(state), api.SafetyPauseError);
  assert.equal(fixture.clicks.length, 2);
  assert.equal(api.readState().phase, 'actionClicked');
});

test('removal confirmation closure cannot count as success after an account switch', async () => {
  const { api, fixture, state } = createRemovalFixture();
  fixture.onConfirmationClosed = () => { fixture.owner = 'another.owner'; };
  await assert.rejects(api.removeFollowerOnCurrentProfile(state), api.SafetyPauseError);
  assert.equal(fixture.clicks.length, 3, 'More, Remove follower, and confirmation only');
  assert.equal(api.readState().phase, 'actionClicked');
  assert.equal(api.readState().completedCount, 0);
});

test('removal verifies the sent action while preserving a requested pause', async () => {
  const { api, fixture, state } = createRemovalFixture();
  fixture.onRemovalSent = () => api.saveState({ ...api.readState(), pauseRequested: true });
  const result = await api.removeFollowerOnCurrentProfile(state);
  assert.equal(result.status, 'completed');
  assert.equal(fixture.clicks.length, 4, 'verification may reopen the profile menu');
  assert.equal(api.readState().pauseRequested, true, 'the runner still must pause before the next item');
});

test('the runner preserves an unknown result if context changes before counters update', async () => {
  const { api, state, location } = createFixture();
  api.saveState({ ...state, status: 'handoff' });
  api.replaceProcessor(async () => {
    api.saveState({ ...api.readState(), phase: 'actionClicked' });
    location.pathname = '/@bob';
    return { status: 'completed', message: 'fixture result' };
  });
  await api.resumeHandoff();
  const result = api.readState();
  assert.equal(result.status, 'paused');
  assert.equal(result.phase, 'verificationUnknown');
  assert.equal(result.index, 0);
  assert.equal(result.completedCount, 0);
  assert.equal(result.nextActionNotBefore, 11000);
});

test('an obsolete runner cannot overwrite another run after an awaited result', async () => {
  const { api, state } = createFixture();
  api.saveState({ ...state, status: 'handoff' });
  api.replaceProcessor(async () => {
    api.saveState({ ...state, token: 'newbatch-5678', status: 'paused' });
    return { status: 'completed', message: 'old result' };
  });
  await api.resumeHandoff();
  const result = api.readState();
  assert.equal(result.token, 'newbatch-5678');
  assert.equal(result.status, 'paused');
  assert.equal(result.index, 0);
  assert.equal(result.completedCount, 0);
});
