'use strict';

// Optional browser regression suite. Install Playwright for development, or set
// PLAYWRIGHT_MODULE to an existing Playwright package. No live Threads requests run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const source = fs.readFileSync(new URL('../threads-safe-batch-manager.user.js', `file://${__dirname}/`), 'utf8');
const initOffset = source.indexOf('\n  function init() {');
assert.ok(initOffset > 0, 'fixture must remove the normal page initializer');
const fixtureSource = source.slice(0, initOffset) +
  '\n  globalThis.__postToolsTest = { currentPostUrl, postTextFromArticle, setupPostTools, mountPanel, showPreview, runtime };\n})();';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
  });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('https://www.threads.com/@owner');
    await page.addScriptTag({ content: fixtureSource });
    await page.evaluate(() => {
      window.copiedPostValues = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (value) => window.copiedPostValues.push(value) }
      });
    });

    await page.setContent(`
      <input id="toggle" type="checkbox">
      <article id="post">
        <a href="/@alice"><span dir="auto">Alice</span></a>
        <a href="/@alice/post/ABC?utm_source=test#reply">Time</a>
        <div dir="auto">Hello <span dir="auto">world</span> again <a href="/@bob"><span dir="auto">@bob</span></a>.<br>Second line
          <span style="display:none">HIDDEN</span><span aria-hidden="true">ARIA HIDDEN</span>
          <button dir="auto">LIKE</button><span role="button">REPLY</span>
          <article><div dir="auto">QUOTED POST</div></article>
        </div>
        <div style="opacity:0"><span dir="auto">INVISIBLE ANCESTOR</span></div>
      </article>`);
    assert.equal(await page.evaluate(() => __postToolsTest.postTextFromArticle(document.querySelector('#post'))),
      'Hello world again @bob.\nSecond line', 'nested text and mentions survive; controls, hidden content and quoted posts do not');

    await page.evaluate(() => __postToolsTest.setupPostTools(document.querySelector('#toggle')));
    await page.check('#toggle');
    await page.getByRole('button', { name: '複製貼文文字', exact: true }).click();
    await page.waitForFunction(() => window.copiedPostValues.length === 1);
    assert.deepEqual(await page.evaluate(() => window.copiedPostValues), ['Hello world again @bob.\nSecond line']);

    await page.getByRole('button', { name: '複製乾淨連結', exact: true }).click();
    await page.waitForFunction(() => window.copiedPostValues.length === 2);
    assert.equal(await page.evaluate(() => window.copiedPostValues[1]), 'https://www.threads.com/@alice/post/ABC');

    const ambiguousStatuses = await page.evaluate(() => {
      const extra = document.createElement('a');
      extra.href = '/@alice/post/DIFFERENT';
      extra.textContent = 'Another post';
      document.querySelector('#post').append(extra);
      return [...document.querySelectorAll('[data-tsbm-post-tools] button')].map((button) => {
        button.click();
        return document.querySelector('[data-tsbm-post-tools] [role="status"]').textContent;
      });
    });
    assert.deepEqual(ambiguousStatuses, ['無法唯一確認貼文連結。', '無法唯一確認貼文連結。']);
    assert.equal(await page.evaluate(() => window.copiedPostValues.length), 2, 'ambiguous post identity blocks both clipboard actions');
    await page.waitForFunction(() => !document.querySelector('[data-tsbm-post-tools]'));

    await page.uncheck('#toggle');
    assert.equal(await page.locator('[data-tsbm-post-tools]').count(), 0);
    await page.setContent(`
      <input id="toggle" type="checkbox">
      <article id="outer"><div dir="auto">Outer post</div>
        <article id="inner"><a href="/@bob/post/INNER">Time</a><div dir="auto">Inner post</div></article>
      </article>`);
    await page.evaluate(() => __postToolsTest.setupPostTools(document.querySelector('#toggle')));
    await page.check('#toggle');
    assert.equal(await page.locator('#inner > [data-tsbm-post-tools]').count(), 1);
    assert.equal(await page.locator('#outer > [data-tsbm-post-tools]').count(), 0);
    await page.evaluate(() => {
      const permalink = document.createElement('a');
      permalink.href = '/@alice/post/OUTER';
      permalink.textContent = 'Outer time';
      document.querySelector('#outer').prepend(permalink);
    });
    await page.waitForFunction(() => document.querySelector('#outer > [data-tsbm-post-tools]'));
    assert.equal(await page.locator('#outer > [data-tsbm-post-tools]').count(), 1,
      'a nested article toolbar must not suppress its parent toolbar');
    assert.equal(await page.locator('#inner > [data-tsbm-post-tools]').count(), 1);
    await page.uncheck('#toggle');
    assert.equal(await page.locator('[data-tsbm-post-tools]').count(), 0);
    await page.setContent(`
      <input id="toggle" type="checkbox">
      <main id="feed">
        <div id="pressable" data-pressable-container="true" data-interactive-id="">
          <a href="/@alice/post/CURRENT">Time</a><div dir="auto">Current <span dir="auto">Threads</span> post</div>
        </div>
        <div id="other" data-pressable-container="true" data-interactive-id="">
          <a href="/@bob/post/OTHER">Time</a><div dir="auto">Other post</div>
        </div>
      </main>`);
    await page.evaluate(() => __postToolsTest.setupPostTools(document.querySelector('#toggle')));
    await page.check('#toggle');
    assert.equal(await page.locator('#pressable > [data-tsbm-post-tools]').count(), 1);
    assert.equal(await page.locator('#other > [data-tsbm-post-tools]').count(), 1);
    assert.equal(await page.locator('#feed > [data-tsbm-post-tools]').count(), 0, 'the feed must not receive a post toolbar');
    assert.equal(await page.evaluate(() => __postToolsTest.postTextFromArticle(document.querySelector('#pressable'))),
      'Current Threads post');
    await page.evaluate(() => history.pushState({}, '', '/settings'));
    await page.locator('#pressable').getByRole('button', { name: '複製貼文文字', exact: true }).click();
    assert.equal(await page.locator('#pressable [role="status"]').textContent(), '目前頁面無法使用貼文工具。');
    assert.equal(await page.evaluate(() => window.copiedPostValues.length), 2, 'a route change is checked before copying');
    await page.evaluate(() => history.pushState({}, '', '/@owner'));
    await page.uncheck('#toggle');

    await page.setContent(`
      <style>.hidden-post { display: none; }</style>
      <input id="toggle" type="checkbox"><aside id="unrelated"></aside>
      <section id="visibility"><article id="hydrating">
        <a id="permalink" href="/@alice">Time</a><div id="post-text" dir="auto">Hydrated post</div>
      </article></section>
      <div id="role-card"><a href="/@alice/post/ROLE">Time</a><div dir="auto">Role post</div></div>
      <div id="pressable-card"><a href="/@alice/post/PRESSABLE">Time</a><div dir="auto">Pressable post</div></div>`);
    await page.evaluate(() => {
      window.postRefreshSchedules = 0;
      window.originalPostTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 300) window.postRefreshSchedules += 1;
        return window.originalPostTimeout(callback, delay, ...args);
      };
      __postToolsTest.setupPostTools(document.querySelector('#toggle'));
    });
    await page.check('#toggle');
    assert.equal(await page.locator('[data-tsbm-post-tools]').count(), 0);
    await page.evaluate(() => document.querySelector('#permalink').setAttribute('href', '/@alice/post/HYDRATED'));
    await page.waitForFunction(() => document.querySelector('#hydrating > [data-tsbm-post-tools]'));
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => window.postRefreshSchedules), 1, 'toolbar insertion must not schedule its own refresh loop');
    await page.evaluate(() => {
      document.querySelector('#unrelated').style.color = 'red';
      document.querySelector('#post-text').className = 'ordinary-text';
      document.querySelector('#post-text').firstChild.data = 'Updated ordinary post text';
      document.querySelector('[data-tsbm-post-tools] [role="status"]').textContent = 'Own status update';
      document.querySelector('[data-tsbm-post-tools] [role="status"]').firstChild.data = 'Own character update';
    });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.postRefreshSchedules), 1, 'unrelated attributes, ordinary text styles and toolbar changes are ignored');

    for (const [attribute, hiddenValue] of [['hidden', ''], ['aria-hidden', 'true'], ['class', 'hidden-post'], ['style', 'display:none']]) {
      await page.evaluate(({ attribute, hiddenValue }) => document.querySelector('#visibility').setAttribute(attribute, hiddenValue), { attribute, hiddenValue });
      await page.waitForFunction(() => !document.querySelector('#hydrating > [data-tsbm-post-tools]'));
      await page.evaluate((attribute) => document.querySelector('#visibility').removeAttribute(attribute), attribute);
      await page.waitForFunction(() => document.querySelector('#hydrating > [data-tsbm-post-tools]'));
    }
    for (const [id, attribute, value] of [['role-card', 'role', 'article'], ['pressable-card', 'data-pressable-container', 'true']]) {
      await page.evaluate(({ id, attribute, value }) => document.getElementById(id).setAttribute(attribute, value), { id, attribute, value });
      await page.waitForFunction((id) => document.getElementById(id).querySelector('[data-tsbm-post-tools]'), id);
      await page.evaluate(({ id, attribute }) => document.getElementById(id).removeAttribute(attribute), { id, attribute });
      await page.waitForFunction((id) => !document.getElementById(id).querySelector('[data-tsbm-post-tools]'), id);
    }
    await page.evaluate(() => document.querySelector('#visibility').setAttribute('role', 'dialog'));
    await page.waitForFunction(() => !document.querySelector('#hydrating > [data-tsbm-post-tools]'));
    await page.evaluate(() => document.querySelector('#visibility').removeAttribute('role'));
    await page.waitForFunction(() => document.querySelector('#hydrating > [data-tsbm-post-tools]'));
    await page.evaluate(() => document.querySelector('#permalink').removeAttribute('href'));
    await page.waitForFunction(() => !document.querySelector('#hydrating > [data-tsbm-post-tools]'));
    const schedulesBeforeDisable = await page.evaluate(() => window.postRefreshSchedules);
    await page.evaluate(() => document.querySelector('#permalink').setAttribute('href', '/@alice/post/HYDRATED'));
    await page.waitForFunction((previous) => window.postRefreshSchedules > previous, schedulesBeforeDisable);
    await page.uncheck('#toggle');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('[data-tsbm-post-tools]').count(), 0, 'disabling cancels a pending attribute-triggered refresh');
    const schedulesAfterDisable = await page.evaluate(() => window.postRefreshSchedules);
    await page.evaluate(() => document.querySelector('#role-card').setAttribute('role', 'article'));
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.postRefreshSchedules), schedulesAfterDisable, 'the disabled observer is disconnected');
    await page.evaluate(() => { window.setTimeout = window.originalPostTimeout; });

    await page.setContent(`
      <input id="toggle" type="checkbox">
      <article id="text-card"><a id="text-link" href="/@alice/post/TEXT"></a><div dir="auto">Text post</div></article>
      <article id="character-card"><a id="character-link" href="/@alice/post/CHARACTER"></a><div dir="auto">Character post</div></article>
      <article id="icon-card"><a id="icon-link" href="/@alice/post/ICON"></a><div dir="auto">Icon post</div></article>
      <article id="child-card"><a href="/@alice/post/CHILD"><span id="link-child" style="display:none">Time</span></a><div dir="auto">Child post</div></article>`);
    await page.evaluate(() => {
      document.querySelector('#character-link').append(document.createTextNode(''));
      __postToolsTest.setupPostTools(document.querySelector('#toggle'));
    });
    await page.check('#toggle');
    assert.equal(await page.locator('[data-tsbm-post-tools]').count(), 0, 'empty permalinks do not identify a visible post');
    await page.evaluate(() => {
      document.querySelector('#text-link').textContent = 'Time';
      document.querySelector('#character-link').firstChild.data = 'Time';
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('width', '18');
      icon.setAttribute('height', '18');
      document.querySelector('#icon-link').append(icon);
      document.querySelector('#link-child').style.display = 'inline';
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-tsbm-post-tools]').length === 4, null, { timeout: 2000 });
    for (const id of ['text-card', 'character-card', 'icon-card', 'child-card']) {
      assert.equal(await page.locator(`#${id} > [data-tsbm-post-tools]`).count(), 1,
        'text, character data, icon insertion and descendant visibility can hydrate a permalink');
    }
    await page.evaluate(() => {
      document.querySelector('#text-link').textContent = '';
      document.querySelector('#character-link').firstChild.data = '';
      document.querySelector('#icon-link svg').remove();
      document.querySelector('#link-child').style.display = 'none';
    });
    await page.waitForFunction(() => !document.querySelector('[data-tsbm-post-tools]'));
    await page.uncheck('#toggle');

    await page.setContent(`
      <style>[hidden] { display: block !important; }</style>
      <input id="toggle" type="checkbox">
      <section id="post-visibility"><article id="visibility-card">
        <div id="link-visibility"><a href="/@alice/post/VISIBILITY">Time</a></div>
        <div dir="auto">Visible post text</div>
      </article></section>`);
    await page.evaluate(() => __postToolsTest.setupPostTools(document.querySelector('#toggle')));
    await page.check('#toggle');
    assert.equal(await page.locator('[data-tsbm-post-tools]').count(), 1);
    for (const id of ['link-visibility', 'post-visibility']) {
      for (const [attribute, value] of [['style', 'opacity:0'], ['hidden', ''], ['style', 'visibility:collapse']]) {
        const statuses = await page.evaluate(({ id, attribute, value }) => {
          document.getElementById(id).setAttribute(attribute, value);
          return [...document.querySelectorAll('[data-tsbm-post-tools] button')].map((button) => {
            button.click();
            return document.querySelector('[data-tsbm-post-tools] [role="status"]').textContent;
          });
        }, { id, attribute, value });
        assert.deepEqual(statuses, Array(2).fill(id === 'link-visibility' ? '無法唯一確認貼文連結。' : '目前頁面無法使用貼文工具。'),
          'both copy actions recheck hidden ancestors before the observer refreshes');
        assert.equal(await page.evaluate(() => window.copiedPostValues.length), 2, 'hidden permalinks and posts never reach the clipboard');
        assert.equal(await page.evaluate(() => __postToolsTest.currentPostUrl(document.querySelector('#visibility-card'))), null);
        await page.waitForFunction(() => !document.querySelector('[data-tsbm-post-tools]'));
        await page.evaluate(({ id, attribute }) => document.getElementById(id).removeAttribute(attribute), { id, attribute });
        await page.waitForFunction(() => document.querySelector('[data-tsbm-post-tools]'));
      }
    }
    await page.uncheck('#toggle');

    await page.setContent('<main></main>');
    await page.setViewportSize({ width: 390, height: 480 });
    const panelLayout = await page.evaluate(() => {
      __postToolsTest.mountPanel();
      const handles = Array.from({ length: 50 }, (_, index) => `user${index}`);
      __postToolsTest.runtime.preview = handles;
      __postToolsTest.showPreview(handles);
      const { shadow, body } = __postToolsTest.runtime.ui;
      const panel = shadow.querySelector('.panel').getBoundingClientRect();
      return { top: panel.top, bottom: panel.bottom, left: panel.left, right: panel.right,
        scrollable: body.scrollHeight > body.clientHeight,
        overflowY: getComputedStyle(body).overflowY };
    });
    assert.ok(panelLayout.top >= 0 && panelLayout.bottom <= 480 && panelLayout.left >= 0 && panelLayout.right <= 390,
      'the full 50-account panel stays within a short mobile viewport');
    assert.equal(panelLayout.scrollable, true);
    assert.equal(panelLayout.overflowY, 'auto');
    console.log('browser tests passed (nested text, clean links, permalink and route revalidation, nested/card ownership, text/icon/attribute hydration, hidden ancestors, filtered refreshes, toggle cleanup, mobile panel)');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
