'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(new URL('../threads-safe-batch-manager.user.js', `file://${__dirname}/`), 'utf8');
let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
});
test.after(async () => { await browser?.close(); });

// Run the shipped script through its panel. Every website request, including
// navigation to a selected account, is answered with this local fixture.
async function setup(t, mode = 'removeFollowers') {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `
    <nav><a href="/@owner" aria-label="Profile">Owner</a></nav>
    <section role="region"><h1>Owner</h1><a href="/@owner/replies">Replies</a>
    <button>Edit profile</button><button id="open">10 followers</button></section>
    <template id="list"><section role="dialog">
      <button role="tab" aria-selected="true">Followers</button><button role="tab" aria-selected="false">Following</button>
      <div id="rows" style="height:128px;overflow-y:auto"><div class="row" style="height:45px">
        <a href="/@alice">alice</a><button>Following</button></div><div style="height:370px"></div></div>
    </section></template>` }));
  await page.goto('https://www.threads.com/@owner');
  await page.evaluate(() => {
    document.querySelector('#open').onclick = () => {
      document.body.append(document.querySelector('#list').content.cloneNode(true));
      const [followers, following] = document.querySelectorAll('[role=tab]');
      following.onclick = () => {
        followers.setAttribute('aria-selected', 'false');
        following.setAttribute('aria-selected', 'true');
      };
    };
    window.replaceList = () => {
      const old = document.querySelector('[role=dialog]');
      const other = old.cloneNode(true);
      const link = other.querySelector('.row a');
      link.href = '/@bob';
      link.textContent = 'bob';
      old.replaceWith(other);
      other.querySelector('#rows').scrollTop = 55;
    };
    window.promptCount = 0;
    window.prompt = () => { window.promptCount += 1; return null; };
  });
  await page.addScriptTag({ content: source });
  await page.locator('.mode-select').selectOption(mode);
  return page;
}

async function scan(page, limit) {
  await page.locator('.limit-input').fill(String(limit));
  await page.locator('.scan').click();
}

async function scanned(page) {
  await page.getByRole('button', { name: '掃描並預覽', exact: true }).waitFor();
}

test('rejects a replacement while waiting for the first account', async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    document.querySelector('#open').addEventListener('click', () => document.querySelector('.row a').removeAttribute('href'));
  });
  await scan(page, 1);
  await page.evaluate(() => window.replaceList());
  await scanned(page);
  assert.equal(await page.locator('.start').isEnabled(), false);
  assert.match(await page.locator('.status').innerText(), /重新掃描/);
});

test('rejects a replacement during the switch to the following tab', async t => {
  const page = await setup(t, 'unfollow');
  await page.evaluate(() => {
    document.addEventListener('click', event => {
      if (event.target.matches('[role=tab]')) window.replaceList();
    });
  });
  await scan(page, 1);
  await scanned(page);
  assert.equal(await page.locator('.start').isEnabled(), false);
  assert.match(await page.locator('.status').innerText(), /重新掃描/);
});

test('changing the dialog during scrolling discards partial results and preserves the replacement scroll position', async t => {
  const page = await setup(t);
  await scan(page, 2);
  await page.waitForFunction(() => document.querySelector('#rows')?.scrollTop > 0);
  await page.evaluate(() => window.replaceList());
  await scanned(page);
  assert.equal(await page.locator('.start').isEnabled(), false);
  assert.equal(await page.locator('.preview input').count(), 0);
  assert.equal(await page.locator('#rows').evaluate(el => el.scrollTop), 55);
});

for (const mode of ['removeFollowers', 'unfollow']) {
  test(`${mode} rejects a reopened list before confirmation`, async t => {
    const page = await setup(t, mode);
    await scan(page, 1);
    await scanned(page);
    assert.equal(await page.locator('.start').isEnabled(), true);
    await page.evaluate(() => window.replaceList());
    await page.locator('.start').click();
    assert.equal(await page.evaluate(() => window.promptCount), 0);
    assert.equal(await page.locator('.start').isEnabled(), false);
  });
}

test('checks the list again after the final confirmation', async t => {
  const page = await setup(t);
  await scan(page, 1);
  await scanned(page);
  await page.evaluate(() => {
    window.prompt = () => '移除粉絲';
    window.confirm = () => { window.replaceList(); return true; };
  });
  await page.locator('.start').click();
  assert.equal(new URL(page.url()).pathname, '/@owner');
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  assert.equal(await page.locator('.start').isEnabled(), false);
});

test('rejects an account switch during confirmation with the original dialog still open', async t => {
  const page = await setup(t);
  await scan(page, 1);
  await scanned(page);
  await page.evaluate(() => {
    window.prompt = () => '移除粉絲';
    window.confirm = () => { document.querySelector('nav a').href = '/@other'; return true; };
  });
  await page.locator('.start').click();
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  assert.equal(await page.locator('.start').isEnabled(), false);
  assert.match(await page.locator('.status').innerText(), /重新掃描/);
});

test('rows can load inside the same dialog and the confirmed selection starts a batch', async t => {
  const page = await setup(t);
  await scan(page, 2);
  await page.waitForFunction(() => document.querySelector('#rows')?.scrollTop > 0);
  await page.evaluate(() => {
    const row = document.querySelector('.row').cloneNode(true);
    row.querySelector('a').href = '/@bob';
    row.querySelector('a').textContent = 'bob';
    document.querySelector('#rows').prepend(row);
  });
  await scanned(page);
  assert.equal(await page.locator('.preview input').count(), 2);
  await page.getByLabel('@alice', { exact: true }).uncheck();
  await page.evaluate(() => { window.prompt = () => '移除粉絲'; window.confirm = () => true; });
  await Promise.all([page.waitForURL('**/@bob'), page.locator('.start').click()]);
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('threads-safe-batch-manager.state.v1')));
  assert.deepEqual(state.queue, ['bob']);
  assert.equal(state.status, 'handoff');
});
