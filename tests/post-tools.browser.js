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

    await page.evaluate(() => {
      const extra = document.createElement('a');
      extra.href = '/@alice/post/DIFFERENT';
      extra.textContent = 'Another post';
      document.querySelector('#post').append(extra);
    });
    for (const label of ['複製貼文文字', '複製乾淨連結']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      assert.equal(await page.locator('[data-tsbm-post-tools] [role="status"]').textContent(), '無法唯一確認貼文連結。');
      assert.equal(await page.evaluate(() => window.copiedPostValues.length), 2, 'ambiguous post identity blocks both clipboard actions');
    }

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
    console.log('browser tests passed (nested text, clean links, permalink and route revalidation, nested/card ownership, toggle cleanup, mobile panel)');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
