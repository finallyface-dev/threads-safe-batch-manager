// ==UserScript==
// @name         Threads 粉絲與追蹤批次管理（確認與停止版）
// @name:zh-TW   Threads 粉絲與追蹤批次管理（確認與停止版）
// @name:en      Threads Follower and Following Batch Manager (Confirm & Stop)
// @namespace    urn:userscript:threads-safe-batch-manager
// @version      1.2.1
// @description  在 Threads 網頁版加入批次管理面板。使用者預覽並確認後，可逐筆移除粉絲或取消追蹤；腳本不使用未公開 API，也不繞過驗證或操作限制。
// @description:zh-TW 在 Threads 網頁版加入批次管理面板。使用者預覽並確認後，可逐筆移除粉絲或取消追蹤；腳本不使用未公開 API，也不繞過驗證或操作限制。
// @description:en Preview and select up to 50 accounts to remove followers or unfollow on Threads. Includes batch confirmation, pause, stop, and a waiting-time estimate. Uses visible page controls without bypassing verification or action limits.
// @homepageURL  https://github.com/finallyface-dev/threads-safe-batch-manager
// @supportURL   https://github.com/finallyface-dev/threads-safe-batch-manager/issues
// @license      MIT
// @match        https://www.threads.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /*
   * Threads 粉絲與追蹤批次管理
   *
   * 設計原則：
   * - 只使用 Threads 頁面上可見的 DOM 控制項。
   * - 不呼叫未公開 API，不讀取 Cookie 或權杖，不傳送名單。
   * - 不會在載入頁面後自動開始。使用者必須先預覽並輸入確認詞。
   * - 每批最多 50 筆，超過 25 筆會顯示額外風險提醒；兩次操作至少間隔 8 秒。
   * - 遇到驗證、操作限制、登入失效或不明介面時立即暫停。
   *
   * Threads 會改版。找不到預期控制項時，本腳本採取「停止」而不是猜測。
   */

  const CONFIG = Object.freeze({
    storageKey: 'threads-safe-batch-manager.state.v1',
    panelHostId: 'threads-safe-batch-manager-host',
    stateVersion: 1,
    defaultBatchSize: 10,
    minBatchSize: 1,
    maxBatchSize: 50,
    largeBatchWarningThreshold: 25,
    defaultDelayMs: 10000,
    minDelayMs: 8000,
    maxDelayMs: 30000,
    handoffTtlMs: 60000,
    confirmationMaxAgeMs: 2 * 60 * 60 * 1000,
    elementWaitMs: 12000,
    scanStepDelayMs: 700,
    maxScanRounds: 120
  });

  const MODE = Object.freeze({
    REMOVE_FOLLOWERS: 'removeFollowers',
    UNFOLLOW: 'unfollow'
  });

  const LABELS = Object.freeze({
    followersTab: [
      /^粉絲(?:[\s\d,.萬万kmb]+)?$/i,
      /^粉丝(?:[\s\d,.萬万kmb]+)?$/i,
      /^followers?(?:[\s\d,.kmb]+)?$/i
    ],
    followingTab: [
      /^追蹤中(?:[\s\d,.萬万kmb]+)?$/i,
      /^正在关注(?:[\s\d,.萬万kmb]+)?$/i,
      /^following(?:[\s\d,.kmb]+)?$/i
    ],
    editProfile: [/^編輯個人檔案$/i, /^编辑个人资料$/i, /^edit profile$/i],
    more: [
      /^更多$/i,
      /^更多選項$/i,
      /^更多选项$/i,
      /^選項$/i,
      /^选项$/i,
      /^more$/i,
      /^more options$/i,
      /^options$/i
    ],
    removeFollower: [
      /^移除粉絲$/i,
      /^移除此粉絲$/i,
      /^移除粉丝$/i,
      /^移除此粉丝$/i,
      /^移除追蹤者$/i,
      /^remove follower$/i,
      /^remove this follower$/i
    ],
    removeConfirm: [
      /^移除$/i,
      /^remove$/i,
      /^移除粉絲$/i,
      /^移除粉丝$/i,
      /^移除追蹤者$/i,
      /^remove follower$/i
    ],
    followingAction: [
      /^追蹤中$/i,
      /^已追蹤$/i,
      /^正在追蹤$/i,
      /^正在关注$/i,
      /^已关注$/i,
      /^following(?:\s+@?[a-z0-9._]+)?$/i
    ],
    followAction: [
      /^追蹤對方$/i,
      /^回追$/i,
      /^追蹤$/i,
      /^关注$/i,
      /^回关$/i,
      /^follow$/i,
      /^follow back$/i
    ],
    unfollow: [
      /^取消追蹤(?:\s+@?[a-z0-9._]+)?$/i,
      /^停止追蹤(?:\s+@?[a-z0-9._]+)?$/i,
      /^取消关注(?:\s+@?[a-z0-9._]+)?$/i,
      /^unfollow(?:\s+@?[a-z0-9._]+)?$/i
    ],
    knownProfileMenuItem: [
      /^封鎖$/i,
      /^屏蔽$/i,
      /^block$/i,
      /^檢舉$/i,
      /^举报$/i,
      /^report$/i,
      /^噤聲$/i,
      /^静音$/i,
      /^mute$/i
    ],
    followerCount: [
      /[\d,.]+\s*(?:位)?粉絲/i,
      /[\d,.]+\s*(?:位)?粉丝/i,
      /\b[\d,.]+\s+followers?\b/i,
      /[\d,.]+\s*(?:萬|万|k|m|b)\s*(?:位)?粉絲/i,
      /[\d,.]+\s*(?:萬|万|k|m|b)\s+followers?/i
    ],
    safetyStop: [
      /請稍後再試/i,
      /请稍后再试/i,
      /try again later/i,
      /please wait a few minutes/i,
      /操作次數過多/i,
      /操作次数过多/i,
      /操作過於頻繁/i,
      /操作过于频繁/i,
      /請等候幾分鐘/i,
      /请等候几分钟/i,
      /too many requests/i,
      /we limit how often/i,
      /暫時封鎖/i,
      /暂时封锁/i,
      /temporarily blocked/i,
      /challenge required/i,
      /需要驗證/i,
      /需要验证/i,
      /verify (?:that )?it'?s you/i,
      /verify your account/i,
      /security check/i,
      /log in to continue/i,
      /登入以繼續/i,
      /登录以继续/i,
      /captcha/i,
      /發生錯誤/i,
      /发生错误/i,
      /something went wrong/i
    ]
  });

  const runtime = {
    preview: [],
    previewMode: null,
    previewOwnHandle: null,
    processing: false,
    scanning: false,
    scanCancelled: false,
    stopped: false,
    ui: null
  };

  class SafetyPauseError extends Error {
    constructor(message) {
      super(message);
      this.name = 'SafetyPauseError';
    }
  }

  class StopRequestedError extends Error {
    constructor() {
      super('使用者已停止腳本。');
      this.name = 'StopRequestedError';
    }
  }

  class PauseRequestedError extends Error {
    constructor() {
      super('已依要求在下一個動作前暫停。');
      this.name = 'PauseRequestedError';
    }
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase();
  }

  function textCandidates(element) {
    if (!(element instanceof Element)) {
      return [];
    }

    const values = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.innerText,
      element.textContent
    ];

    return [...new Set(values.map(normalizeText).filter(Boolean))];
  }

  function matchesLabels(element, patterns) {
    return textCandidates(element).some((text) => patterns.some((pattern) => pattern.test(text)));
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected || element.closest('[aria-hidden="true"]')) {
      return false;
    }

    return isRendered(element);
  }

  function isRendered(element) {
    if (!(element instanceof Element) || !element.isConnected) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function visibleElements(root, selector) {
    return [...root.querySelectorAll(selector)].filter(isVisible);
  }

  function renderedElements(root, selector) {
    return [...root.querySelectorAll(selector)].filter(isRendered);
  }

  function topmostMatchingElement(root, selector, patterns) {
    return visibleElements(root, selector)
      .filter((element) => matchesLabels(element, patterns))
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0] || null;
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function waitFor(getValue, timeoutMs = CONFIG.elementWaitMs, intervalMs = 200) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        const value = getValue();
        if (value) {
          return value;
        }
      } catch (error) {
        if (error instanceof StopRequestedError) {
          throw error;
        }
        lastError = error;
      }
      await sleep(intervalMs);
    }

    if (lastError) {
      console.debug('[Threads 批次管理] 等待控制項時收到錯誤：', lastError);
    }
    return null;
  }

  function clickVisibleElement(element) {
    if (!isVisible(element)) {
      throw new SafetyPauseError('預期控制項目前不可見，已暫停。');
    }

    if (element.matches('[disabled], [aria-disabled="true"]') || element.closest('[inert]')) {
      throw new SafetyPauseError('預期控制項目前已停用，腳本已暫停。');
    }

    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    if (!topElement || (topElement !== element && !element.contains(topElement))) {
      throw new SafetyPauseError('預期控制項被其他介面遮住，腳本已暫停。');
    }

    element.click();
  }

  function clampInteger(value, minimum, maximum, fallback) {
    const number = Number.parseInt(String(value), 10);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(maximum, Math.max(minimum, number));
  }

  function makeRunToken() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function isValidHandle(value) {
    return typeof value === 'string' && /^[a-z0-9._]{1,30}$/i.test(value);
  }

  function handleFromPath(pathname = window.location.pathname) {
    const match = pathname.match(/^\/@([^/?#]+)(?:\/|$)/);
    if (!match) {
      return null;
    }

    try {
      const handle = decodeURIComponent(match[1]);
      return isValidHandle(handle) ? handle : null;
    } catch (_error) {
      return null;
    }
  }

  function handleFromHref(href) {
    if (!href) {
      return null;
    }

    try {
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) {
        return null;
      }
      return handleFromPath(url.pathname);
    } catch (_error) {
      return null;
    }
  }

  function getOwnHandle() {
    const navigationRoots = visibleElements(document, '[role="navigation"], nav');

    for (const navigation of navigationRoots) {
      const profileLinks = visibleElements(navigation, 'a[href^="/@"]');
      for (const link of profileLinks) {
        const imageLabels = [...link.querySelectorAll('img[alt]')]
          .map((image) => image.getAttribute('alt'))
          .filter(Boolean)
          .join(' ');
        const combinedText = `${textCandidates(link).join(' ')} ${imageLabels}`;
        if (/個人檔案|个人资料|profile/i.test(combinedText)) {
          const handle = handleFromHref(link.getAttribute('href'));
          if (handle) {
            return handle;
          }
        }
      }
    }

    return null;
  }

  function getProfileRegion() {
    const currentHandle = handleFromPath();
    if (!currentHandle) {
      return null;
    }

    const normalizedHandle = normalizeText(currentHandle);
    const regions = visibleElements(document, '[role="region"]');
    const withHeading = regions.filter((region) => region.querySelector('h1, [role="heading"]'));
    const scored = withHeading.map((region) => {
      let score = 0;

      const hasMatchingLink = [...region.querySelectorAll('a[href^="/@"]')]
        .some((link) => {
          const handle = handleFromHref(link.getAttribute('href'));
          return handle && handle.toLowerCase() === currentHandle.toLowerCase();
        });
      if (hasMatchingLink) {
        score += 6;
      }

      const hasMatchingImage = [...region.querySelectorAll('img[alt]')]
        .some((image) => normalizeText(image.getAttribute('alt')).includes(normalizedHandle));
      if (hasMatchingImage) {
        score += 5;
      }

      const hasExactHandleLine = String(region.innerText || '')
        .split(/\n+/)
        .some((line) => normalizeText(line) === normalizedHandle);
      if (hasExactHandleLine) {
        score += 5;
      }

      const expectedProfileTabs = new Set([
        `/@${currentHandle.toLowerCase()}/replies`,
        `/@${currentHandle.toLowerCase()}/media`,
        `/@${currentHandle.toLowerCase()}/reposts`
      ]);
      const hasProfileTab = [...region.querySelectorAll('a[href^="/@"]')]
        .some((link) => {
          try {
            const url = new URL(link.getAttribute('href'), window.location.origin);
            return expectedProfileTabs.has(url.pathname.replace(/\/$/, '').toLowerCase());
          } catch (_error) {
            return false;
          }
        });
      if (hasProfileTab) {
        score += 5;
      }

      const profileMore = visibleElements(region, 'button, [role="button"]')
        .some((button) =>
          button.getAttribute('aria-haspopup') === 'dialog' &&
          matchesLabels(button, LABELS.more)
        );
      if (profileMore) {
        score += 5;
      }

      if (topmostMatchingElement(region, 'button, [role="button"]', LABELS.editProfile)) {
        score += 5;
      }

      if (topmostMatchingElement(region, 'button, [role="button"]', LABELS.followerCount)) {
        score += 2;
      }

      return {
        region,
        score,
        eligible: (hasMatchingLink || hasMatchingImage || hasExactHandleLine) && hasProfileTab
      };
    }).filter((candidate) => candidate.eligible).sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.region.getBoundingClientRect().top - right.region.getBoundingClientRect().top;
    });

    return scored[0] && scored[0].score >= 7 ? scored[0].region : null;
  }

  function isOwnProfilePage() {
    const ownHandle = getOwnHandle();
    const currentHandle = handleFromPath();
    const profileRegion = getProfileRegion();

    if (!ownHandle || !currentHandle || !profileRegion) {
      return false;
    }

    const editButton = topmostMatchingElement(
      profileRegion,
      'button, [role="button"]',
      LABELS.editProfile
    );

    return ownHandle.toLowerCase() === currentHandle.toLowerCase() && Boolean(editButton);
  }

  function underlyingOwnProfileMatches(
    expectedHandle,
    ownHandle = getOwnHandle(),
    currentHandle = handleFromPath()
  ) {
    if (!isValidHandle(expectedHandle)) {
      return false;
    }

    if (!ownHandle || !currentHandle ||
      ownHandle.toLowerCase() !== expectedHandle.toLowerCase() ||
      currentHandle.toLowerCase() !== expectedHandle.toLowerCase()) {
      return false;
    }

    const expectedProfileTabs = new Set([
      `/@${expectedHandle.toLowerCase()}/replies`,
      `/@${expectedHandle.toLowerCase()}/media`,
      `/@${expectedHandle.toLowerCase()}/reposts`
    ]);
    const normalizedHandle = normalizeText(expectedHandle);
    const candidates = renderedElements(document, '[role="region"]')
      .filter((region) => region.querySelector('h1, [role="heading"]'))
      .filter((region) => {
        const hasMatchingIdentity = [...region.querySelectorAll('a[href^="/@"]')]
          .some((link) => {
            const handle = handleFromHref(link.getAttribute('href'));
            return handle && handle.toLowerCase() === expectedHandle.toLowerCase();
          }) || [...region.querySelectorAll('img[alt]')]
          .some((image) => normalizeText(image.getAttribute('alt')).includes(normalizedHandle)) ||
          String(region.innerText || '')
            .split(/\n+/)
            .some((line) => normalizeText(line) === normalizedHandle);

        const hasProfileTab = [...region.querySelectorAll('a[href^="/@"]')]
          .some((link) => {
            try {
              const url = new URL(link.getAttribute('href'), window.location.origin);
              return expectedProfileTabs.has(url.pathname.replace(/\/$/, '').toLowerCase());
            } catch (_error) {
              return false;
            }
          });

        const hasEditButton = renderedElements(region, 'button, [role="button"]')
          .some((button) => matchesLabels(button, LABELS.editProfile));

        return hasMatchingIdentity && hasProfileTab && hasEditButton;
      });

    return candidates.length === 1;
  }

  function sanitizeState(candidate) {
    if (!candidate || typeof candidate !== 'object' || candidate.version !== CONFIG.stateVersion) {
      return null;
    }

    if (![MODE.REMOVE_FOLLOWERS, MODE.UNFOLLOW].includes(candidate.mode)) {
      return null;
    }

    const allowedStatuses = new Set(['handoff', 'running', 'paused', 'complete']);
    if (!allowedStatuses.has(candidate.status)) {
      return null;
    }

    const token = String(candidate.token || '');
    if (!/^[a-z0-9-]{8,100}$/i.test(token)) {
      return null;
    }

    const allowedPhases = new Set([
      'beforeAction',
      'actionClicked',
      'verificationUnknown',
      'afterAction',
      'finished'
    ]);
    const phase = String(candidate.phase || 'beforeAction');
    if (!allowedPhases.has(phase)) {
      return null;
    }

    if (!Array.isArray(candidate.queue) || !candidate.queue.every(isValidHandle)) {
      return null;
    }

    const queue = candidate.queue.map((handle) => handle.toLowerCase());
    if (queue.length > CONFIG.maxBatchSize || new Set(queue).size !== queue.length) {
      return null;
    }

    if (!isValidHandle(candidate.originHandle)) {
      return null;
    }

    const index = clampInteger(candidate.index, 0, queue.length, 0);
    const delayMs = clampInteger(
      candidate.delayMs,
      CONFIG.minDelayMs,
      CONFIG.maxDelayMs,
      CONFIG.defaultDelayMs
    );

    return {
      version: CONFIG.stateVersion,
      token,
      mode: candidate.mode,
      status: String(candidate.status || 'paused'),
      phase,
      queue,
      total: clampInteger(candidate.total, 0, CONFIG.maxBatchSize, queue.length),
      index,
      completedCount: clampInteger(candidate.completedCount, 0, CONFIG.maxBatchSize, 0),
      skippedCount: clampInteger(candidate.skippedCount, 0, CONFIG.maxBatchSize, 0),
      failedCount: clampInteger(candidate.failedCount, 0, CONFIG.maxBatchSize, 0),
      delayMs,
      originHandle: candidate.originHandle.toLowerCase(),
      originUrl: String(candidate.originUrl || ''),
      expectedHandle: isValidHandle(candidate.expectedHandle)
        ? candidate.expectedHandle.toLowerCase()
        : null,
      handoffUntil: Number(candidate.handoffUntil) || 0,
      confirmedAt: Number(candidate.confirmedAt) || 0,
      nextActionNotBefore: Math.max(0, Number(candidate.nextActionNotBefore) || 0),
      pauseRequested: Boolean(candidate.pauseRequested),
      lastMessage: String(candidate.lastMessage || '')
    };
  }

  function readState() {
    try {
      const raw = window.sessionStorage.getItem(CONFIG.storageKey);
      if (!raw) {
        return null;
      }

      const state = sanitizeState(JSON.parse(raw));
      if (!state) {
        window.sessionStorage.removeItem(CONFIG.storageKey);
      }
      return state;
    } catch (_error) {
      removeState();
      return null;
    }
  }

  function saveState(state) {
    const cleanState = sanitizeState(state);
    if (!cleanState) {
      throw new Error('批次狀態格式不正確。');
    }

    try {
      window.sessionStorage.setItem(CONFIG.storageKey, JSON.stringify(cleanState));
    } catch (_error) {
      runtime.stopped = true;
      removeState();
      throw new SafetyPauseError('瀏覽器無法寫入分頁暫存。批次未繼續，請檢查網站資料或私密瀏覽設定。');
    }
    return cleanState;
  }

  function removeState() {
    try {
      window.sessionStorage.removeItem(CONFIG.storageKey);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function modeName(mode) {
    return mode === MODE.REMOVE_FOLLOWERS ? '移除粉絲' : '取消追蹤';
  }

  function updateStatus(message, tone = 'normal') {
    if (!runtime.ui) {
      return;
    }
    runtime.ui.status.textContent = message;
    runtime.ui.status.dataset.tone = tone;
  }

  function showPreview(handles) {
    if (!runtime.ui) {
      return;
    }

    runtime.ui.preview.replaceChildren();
    runtime.ui.delay.onchange = null;
    if (!handles.length) {
      runtime.ui.preview.textContent = '尚未建立預覽。';
      return;
    }

    const summary = document.createElement('p');
    const list = document.createElement('div');
    list.style.cssText = 'max-height:180px;overflow:auto;display:grid;gap:6px';
    const checkboxes = [];
    const updateSelection = () => {
      if (readState()) {
        return;
      }
      runtime.preview = handles.filter((_handle, index) => checkboxes[index].checked);
      const seconds = clampInteger(runtime.ui.delay.value, 8, 30, 10);
      const minutes = Math.ceil(Math.max(0, runtime.preview.length - 1) * seconds / 60);
      summary.textContent = `已選 ${runtime.preview.length}/${handles.length} 筆。等待間隔約 ${minutes} 分鐘，另需頁面載入與確認時間。`;
      runtime.ui.startButton.disabled = runtime.scanning || runtime.preview.length === 0;
    };
    for (const handle of handles) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.style.width = 'auto';
      checkbox.addEventListener('change', updateSelection);
      checkboxes.push(checkbox);
      label.append(checkbox, document.createTextNode(`@${handle}`));
      list.append(label);
    }
    const controls = document.createElement('div');
    for (const [text, checked] of [['全選', true], ['取消全選', false]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.addEventListener('click', () => {
        if (runtime.scanning || readState()) {
          return;
        }
        checkboxes.forEach((checkbox) => { checkbox.checked = checked; });
        updateSelection();
      });
      controls.append(button);
    }
    runtime.ui.preview.append(summary, controls, list);
    runtime.ui.delay.onchange = updateSelection;
    updateSelection();
  }

  function syncUiFromState() {
    if (!runtime.ui) {
      return;
    }

    const state = readState();
    const active = Boolean(state && ['handoff', 'running', 'paused'].includes(state.status));
    const running = Boolean(state && ['handoff', 'running'].includes(state.status));

    runtime.ui.scanButton.disabled = active || runtime.scanning;
    runtime.ui.startButton.disabled = active || runtime.scanning || runtime.preview.length === 0;
    runtime.ui.mode.disabled = active || runtime.scanning;
    runtime.ui.limit.disabled = active || runtime.scanning;
    runtime.ui.delay.disabled = active || runtime.scanning;
    runtime.ui.pauseButton.hidden = !running;
    runtime.ui.resumeButton.hidden = !(state && state.status === 'paused');
    runtime.ui.skipButton.hidden = !(state && state.status === 'paused' && state.phase === 'beforeAction');
    runtime.ui.stopButton.hidden = !active && !(state && state.status === 'complete');
    runtime.ui.resumeButton.textContent = state && state.phase === 'verificationUnknown'
      ? '略過不明結果並繼續'
      : '繼續剩餘項目';

    if (!state) {
      if (!runtime.scanning) {
        updateStatus('待命。請先在自己的個人檔案頁掃描名單。');
      }
      return;
    }

    if (state.status === 'complete') {
      updateStatus(
        `本批完成：成功 ${state.completedCount}、略過 ${state.skippedCount}、錯誤暫停 ${state.failedCount} 次。`,
        state.failedCount ? 'warning' : 'success'
      );
      runtime.ui.preview.textContent = '本批名單已從分頁暫存中清除。';
      return;
    }

    const progress = `${Math.min(state.index, state.total)}/${state.total}`;
    if (state.status === 'paused') {
      updateStatus(`已暫停（${progress}）。${state.lastMessage || '可檢查頁面後再繼續。'}`, 'warning');
    } else if (state.status === 'handoff') {
      updateStatus(`正在前往下一個帳號（${progress}）。`);
    } else {
      updateStatus(`正在執行 ${modeName(state.mode)}（${progress}）。`);
    }
  }

  function mountPanel() {
    if (document.getElementById(CONFIG.panelHostId)) {
      return;
    }

    const host = document.createElement('div');
    host.id = CONFIG.panelHostId;
    host.style.position = 'fixed';
    host.style.right = '18px';
    host.style.bottom = '18px';
    host.style.zIndex = '2147483647';
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel {
          width: min(360px, calc(100vw - 24px));
          border: 1px solid #d0d5dd;
          border-radius: 14px;
          background: #ffffff;
          color: #101828;
          box-shadow: 0 12px 34px rgba(16, 24, 40, 0.22);
          font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          overflow: hidden;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          background: #101828;
          color: #ffffff;
        }
        .header strong { font-size: 14px; }
        .collapse {
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          cursor: pointer;
          padding: 2px 6px;
        }
        .body { padding: 14px; }
        .body[hidden] { display: none; }
        .notice {
          margin: 0 0 12px;
          padding: 9px 10px;
          border-radius: 9px;
          background: #fff4e5;
          color: #7a2e0e;
          font-size: 12px;
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        label { display: grid; gap: 5px; color: #344054; font-size: 12px; }
        label.mode { grid-column: 1 / -1; }
        select, input {
          width: 100%;
          border: 1px solid #d0d5dd;
          border-radius: 8px;
          background: #ffffff;
          color: #101828;
          padding: 8px 9px;
          font: inherit;
        }
        .preview, .status {
          margin-top: 10px;
          padding: 9px 10px;
          border-radius: 9px;
          background: #f2f4f7;
          overflow-wrap: anywhere;
          font-size: 12px;
        }
        .status[data-tone="warning"] { background: #fff4e5; color: #7a2e0e; }
        .status[data-tone="success"] { background: #ecfdf3; color: #027a48; }
        .status[data-tone="danger"] { background: #fef3f2; color: #b42318; }
        .actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-top: 12px;
        }
        button.action {
          min-height: 38px;
          border: 1px solid #d0d5dd;
          border-radius: 9px;
          background: #ffffff;
          color: #344054;
          padding: 8px 10px;
          font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
        }
        button.action.primary { border-color: #101828; background: #101828; color: #ffffff; }
        button.action.danger { border-color: #fda29b; color: #b42318; }
        button.action:disabled { cursor: not-allowed; opacity: 0.45; }
        button[hidden] { display: none; }
        .footnote { margin: 10px 0 0; color: #667085; font-size: 11px; }
      </style>
      <section class="panel" aria-label="Threads 粉絲與追蹤批次管理">
        <header class="header">
          <strong>Threads 批次管理</strong>
          <button class="collapse" type="button" aria-expanded="true">收合</button>
        </header>
        <div class="body">
          <p class="notice">本工具未獲 Meta 授權。自動掃描與批次操作可能違反平台條款；間隔與上限不代表 Meta 認可或保證帳號安全。</p>
          <div class="grid">
            <label class="mode">操作模式
              <select class="mode-select">
                <option value="removeFollowers">移除粉絲</option>
                <option value="unfollow">取消追蹤中帳號</option>
              </select>
            </label>
            <label>本批上限
              <input class="limit-input" type="number" min="1" max="50" step="1" value="10">
            </label>
            <label>每筆間隔（秒）
              <input class="delay-input" type="number" min="8" max="30" step="1" value="10">
            </label>
          </div>
          <div class="preview">尚未建立預覽。</div>
          <div class="status" data-tone="normal" aria-live="polite">待命。</div>
          <div class="actions">
            <button class="action scan" type="button">掃描並預覽</button>
            <button class="action primary start" type="button" disabled>確認並開始</button>
            <button class="action pause" type="button" hidden>本筆後暫停</button>
            <button class="action resume" type="button" hidden>繼續剩餘項目</button>
            <button class="action skip" type="button" hidden>略過目前項目</button>
            <button class="action danger stop" type="button" hidden>立即停止並清除</button>
          </div>
          <p class="footnote">停止只會阻止下一個動作。已送出的移除或取消追蹤不能由腳本復原。</p>
        </div>
      </section>
    `;

    runtime.ui = {
      host,
      shadow,
      body: shadow.querySelector('.body'),
      collapseButton: shadow.querySelector('.collapse'),
      mode: shadow.querySelector('.mode-select'),
      limit: shadow.querySelector('.limit-input'),
      delay: shadow.querySelector('.delay-input'),
      preview: shadow.querySelector('.preview'),
      status: shadow.querySelector('.status'),
      scanButton: shadow.querySelector('.scan'),
      startButton: shadow.querySelector('.start'),
      pauseButton: shadow.querySelector('.pause'),
      resumeButton: shadow.querySelector('.resume'),
      skipButton: shadow.querySelector('.skip'),
      stopButton: shadow.querySelector('.stop')
    };

    runtime.ui.collapseButton.addEventListener('click', () => {
      const willOpen = runtime.ui.body.hidden;
      runtime.ui.body.hidden = !willOpen;
      runtime.ui.collapseButton.textContent = willOpen ? '收合' : '展開';
      runtime.ui.collapseButton.setAttribute('aria-expanded', String(willOpen));
    });

    runtime.ui.mode.addEventListener('change', invalidatePreview);
    runtime.ui.limit.addEventListener('change', invalidatePreview);
    runtime.ui.scanButton.addEventListener('click', onScanClick);
    runtime.ui.startButton.addEventListener('click', onStartClick);
    runtime.ui.pauseButton.addEventListener('click', requestPause);
    runtime.ui.resumeButton.addEventListener('click', resumePausedRun);
    runtime.ui.skipButton.addEventListener('click', skipPausedCurrentItem);
    runtime.ui.stopButton.addEventListener('click', stopAndClear);

    syncUiFromState();
  }

  function invalidatePreview() {
    if (runtime.scanning || readState()) {
      return;
    }
    runtime.preview = [];
    runtime.previewMode = null;
    runtime.previewOwnHandle = null;
    showPreview([]);
    syncUiFromState();
  }

  function relationDialogs() {
    const dialogs = visibleElements(document, '[role="dialog"]');
    return dialogs.filter((dialog) => {
      const tabs = visibleElements(dialog, '[role="tab"]');
      const hasFollowers = tabs.some((tab) => relationTabMatches(tab, LABELS.followersTab));
      const hasFollowing = tabs.some((tab) => relationTabMatches(tab, LABELS.followingTab));
      return hasFollowers && hasFollowing;
    });
  }

  function relationDialog() {
    const dialogs = relationDialogs();
    return dialogs.length === 1 ? dialogs[0] : null;
  }

  function relationTabMatches(tab, patterns) {
    if (matchesLabels(tab, patterns)) {
      return true;
    }

    return [...tab.querySelectorAll('[aria-label], [role="button"], button')]
      .some((element) => matchesLabels(element, patterns));
  }

  function relationTab(dialog, mode) {
    const patterns = mode === MODE.REMOVE_FOLLOWERS ? LABELS.followersTab : LABELS.followingTab;
    const tabs = visibleElements(dialog, '[role="tab"]');
    const tab = tabs.find((candidate) => relationTabMatches(candidate, patterns));
    if (!tab) {
      return null;
    }

    const nestedButton = visibleElements(tab, '[role="button"], button')
      .find((candidate) => matchesLabels(candidate, patterns));
    return nestedButton || tab;
  }

  function selectedRelationMode(dialog) {
    const selectedTab = dialog.querySelector('[role="tab"][aria-selected="true"]');
    if (!selectedTab) {
      return null;
    }
    if (relationTabMatches(selectedTab, LABELS.followersTab)) {
      return MODE.REMOVE_FOLLOWERS;
    }
    if (relationTabMatches(selectedTab, LABELS.followingTab)) {
      return MODE.UNFOLLOW;
    }
    return null;
  }

  async function ensureRelationDialog(mode) {
    if (relationDialogs().length > 0) {
      throw new SafetyPauseError('畫面上已有粉絲／追蹤清單。請先關閉舊視窗，再重新掃描。');
    }

    if (!isOwnProfilePage()) {
      throw new SafetyPauseError('請先開啟目前登入帳號的個人檔案頁，再按「掃描並預覽」。');
    }

    const expectedOwnHandle = getOwnHandle();
    const profileRegion = getProfileRegion();
    const followerCountButton = topmostMatchingElement(
      profileRegion,
      'button, [role="button"]',
      LABELS.followerCount
    );

    if (!expectedOwnHandle || !followerCountButton) {
      throw new SafetyPauseError('找不到本人個人檔案的粉絲數量按鈕。Threads 介面可能已改版。');
    }

    const beforeDialogs = new Set(visibleElements(document, '[role="dialog"]'));
    clickVisibleElement(followerCountButton);
    let dialog = await waitFor(() => {
      const candidate = relationDialog();
      return candidate && !beforeDialogs.has(candidate) ? candidate : null;
    });
    if (!dialog) {
      throw new SafetyPauseError('無法確認是本次新開啟的粉絲／追蹤清單。');
    }

    const currentOwnHandle = getOwnHandle();
    const currentProfileHandle = handleFromPath();
    if (!underlyingOwnProfileMatches(expectedOwnHandle) || !currentOwnHandle || !currentProfileHandle ||
      currentOwnHandle.toLowerCase() !== expectedOwnHandle.toLowerCase() ||
      currentProfileHandle.toLowerCase() !== expectedOwnHandle.toLowerCase()) {
      throw new SafetyPauseError('清單開啟後無法再次確認底層仍是本人個人檔案，已停止掃描。');
    }

    if (selectedRelationMode(dialog) !== mode) {
      const tab = relationTab(dialog, mode);
      if (!tab) {
        throw new SafetyPauseError('找不到指定的粉絲／追蹤分頁。');
      }
      clickVisibleElement(tab);

      const selected = await waitFor(() => {
        const currentDialog = relationDialog();
        return currentDialog && selectedRelationMode(currentDialog) === mode ? currentDialog : null;
      });

      if (!selected) {
        throw new SafetyPauseError('無法切換到指定名單。');
      }
      dialog = selected;
      await sleep(CONFIG.scanStepDelayMs);
      dialog = relationDialog();
      if (!dialog || selectedRelationMode(dialog) !== mode ||
        !underlyingOwnProfileMatches(expectedOwnHandle)) {
        throw new SafetyPauseError('切換名單後無法確認目前分頁。');
      }
    }

    return dialog;
  }

  function findScrollContainer(dialog) {
    const candidates = [dialog, ...dialog.querySelectorAll('div')]
      .filter((element) => {
        if (!isVisible(element) || element.clientHeight < 100) {
          return false;
        }
        return element.scrollHeight > element.clientHeight + 40;
      })
      .map((element) => {
        const style = window.getComputedStyle(element);
        const scrollableStyle = /(auto|scroll)/i.test(style.overflowY);
        return {
          element,
          score: (scrollableStyle ? 1000000 : 0) + (element.scrollHeight - element.clientHeight)
        };
      })
      .sort((left, right) => right.score - left.score);

    return candidates[0] ? candidates[0].element : null;
  }

  function relationRowForLink(link, dialog, mode) {
    const relationPatterns = mode === MODE.UNFOLLOW
      ? LABELS.followingAction
      : [...LABELS.followingAction, ...LABELS.followAction];
    let node = link;

    for (let depth = 0; depth < 8; depth += 1) {
      node = node.parentElement;
      if (!node || node === dialog) {
        break;
      }

      const rowHandles = new Set(
        [...node.querySelectorAll('a[href^="/@"]')]
          .map((anchor) => handleFromHref(anchor.getAttribute('href')))
          .filter(Boolean)
          .map((handle) => handle.toLowerCase())
      );
      const rowActions = visibleElements(node, 'button, [role="button"]')
        .filter((button) => matchesLabels(button, relationPatterns));
      const rect = node.getBoundingClientRect();

      if (rowHandles.size === 1 && rowActions.length >= 1 && rect.height >= 32 && rect.height <= 360) {
        return node;
      }
    }

    return null;
  }

  function collectHandles(dialog, ownHandle, collection, mode, limit = CONFIG.maxBatchSize) {
    const normalizedOwnHandle = ownHandle.toLowerCase();
    const links = visibleElements(dialog, 'a[href^="/@"]');
    for (const link of links) {
      if (collection.size >= limit) {
        break;
      }
      const handle = handleFromHref(link.getAttribute('href'));
      if (!handle) {
        continue;
      }
      const normalizedHandle = handle.toLowerCase();
      if (normalizedHandle === normalizedOwnHandle || collection.has(normalizedHandle)) {
        continue;
      }

      if (!relationRowForLink(link, dialog, mode)) {
        continue;
      }

      collection.add(normalizedHandle);
    }
  }

  async function scanRelations(mode, limit) {
    const ownHandle = getOwnHandle();
    if (!ownHandle) {
      throw new SafetyPauseError('無法確認目前登入帳號。請登入 Threads 後重試。');
    }

    let dialog = await ensureRelationDialog(mode);
    const handles = new Set();
    let stableRounds = 0;
    let previousCount = 0;

    const firstProfileLink = await waitFor(() => {
      if (runtime.scanCancelled) {
        throw new StopRequestedError();
      }
      dialog = relationDialog();
      return dialog && dialog.querySelector('a[href^="/@"]');
    });

    if (!firstProfileLink) {
      return { handles: [], ownHandle };
    }

    let scrollContainer = findScrollContainer(dialog);
    const originalScrollContainer = scrollContainer;
    const originalScrollTop = scrollContainer ? scrollContainer.scrollTop : null;

    try {
      if (scrollContainer && scrollContainer.scrollTop > 0) {
        scrollContainer.scrollTop = 0;
        await sleep(350);
      }

      for (let round = 0; round < CONFIG.maxScanRounds; round += 1) {
        if (runtime.scanCancelled) {
          throw new StopRequestedError();
        }

        const currentOwnHandle = getOwnHandle();
        const currentProfileHandle = handleFromPath();
        if (!underlyingOwnProfileMatches(ownHandle, currentOwnHandle, currentProfileHandle)) {
          throw new SafetyPauseError('掃描期間登入帳號或個人檔案已變更，已停止掃描。');
        }

        dialog = relationDialog();
        if (!dialog || selectedRelationMode(dialog) !== mode) {
          throw new SafetyPauseError('掃描期間名單已關閉或切換，已停止掃描。');
        }

        collectHandles(dialog, ownHandle, handles, mode, limit);
        const previewHandles = [...handles].slice(0, limit);
        updateStatus(`正在掃描：已找到 ${previewHandles.length}/${limit} 筆。`);

        if (previewHandles.length >= limit) {
          return { handles: previewHandles, ownHandle };
        }

        if (handles.size === previousCount) {
          stableRounds += 1;
        } else {
          stableRounds = 0;
          previousCount = handles.size;
        }

        scrollContainer = findScrollContainer(dialog) || scrollContainer;
        if (!scrollContainer) {
          break;
        }
        const atBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 4;

        if (atBottom && stableRounds >= 3) {
          break;
        }

        const step = Math.max(220, Math.floor(scrollContainer.clientHeight * 0.75));
        scrollContainer.scrollTop = Math.min(
          scrollContainer.scrollHeight,
          scrollContainer.scrollTop + step
        );
        await sleep(CONFIG.scanStepDelayMs);
      }

      return { handles: [...handles].slice(0, limit), ownHandle };
    } finally {
      const currentDialog = relationDialog();
      const restoreContainer = originalScrollContainer && originalScrollContainer.isConnected
        ? originalScrollContainer
        : (currentDialog ? findScrollContainer(currentDialog) : null);
      if (restoreContainer && originalScrollTop !== null) {
        restoreContainer.scrollTop = Math.min(originalScrollTop, restoreContainer.scrollHeight);
      }
    }
  }

  async function onScanClick() {
    if (runtime.scanning) {
      runtime.scanCancelled = true;
      updateStatus('正在停止掃描……', 'warning');
      return;
    }

    if (readState()) {
      updateStatus('已有尚未清除的批次狀態。請先停止或完成該批次。', 'warning');
      return;
    }

    const mode = runtime.ui.mode.value;
    const limit = clampInteger(
      runtime.ui.limit.value,
      CONFIG.minBatchSize,
      CONFIG.maxBatchSize,
      CONFIG.defaultBatchSize
    );

    runtime.ui.limit.value = String(limit);
    runtime.scanning = true;
    runtime.scanCancelled = false;
    runtime.preview = [];
    runtime.previewMode = null;
    runtime.ui.scanButton.textContent = '停止掃描';
    runtime.ui.startButton.disabled = true;
    runtime.ui.mode.disabled = true;
    runtime.ui.limit.disabled = true;
    runtime.ui.delay.disabled = true;
    showPreview([]);
    updateStatus('正在開啟並掃描名單。此階段不會移除任何帳號。');

    try {
      const previewResult = await scanRelations(mode, limit);
      const handles = previewResult.handles;
      if (!handles.length) {
        updateStatus('清單中沒有找到可處理帳號。', 'warning');
        return;
      }

      runtime.preview = handles;
      runtime.previewMode = mode;
      runtime.previewOwnHandle = previewResult.ownHandle;
      showPreview(handles);
      const largeBatch = handles.length > CONFIG.largeBatchWarningThreshold;
      updateStatus(
        largeBatch
          ? `預覽完成，共 ${handles.length} 筆。大型批次較容易觸發 Threads 限制，建議分批執行。`
          : `預覽完成。尚未執行任何 ${modeName(mode)} 動作。`,
        largeBatch ? 'warning' : 'success'
      );
    } catch (error) {
      if (error instanceof StopRequestedError) {
        updateStatus('掃描已停止，沒有執行移除動作。', 'warning');
      } else {
        updateStatus(error.message || '掃描失敗。', 'danger');
      }
    } finally {
      const finalStatusText = runtime.ui.status.textContent;
      const finalStatusTone = runtime.ui.status.dataset.tone || 'normal';
      runtime.scanning = false;
      runtime.scanCancelled = false;
      runtime.ui.scanButton.textContent = '掃描並預覽';
      syncUiFromState();
      updateStatus(finalStatusText, finalStatusTone);
    }
  }

  function confirmBatch(mode, count) {
    const phrase = modeName(mode);
    const largeBatchNotice = count > CONFIG.largeBatchWarningThreshold
      ? `本批超過 ${CONFIG.largeBatchWarningThreshold} 筆，較容易觸發 Threads 限制。\n`
      : '';
    const answer = window.prompt(
      `本批將逐筆執行「${phrase}」，共 ${count} 筆。\n` +
      largeBatchNotice +
      '這些變更可能無法復原，也可能觸發 Threads 的操作限制。\n\n' +
      `若確定要繼續，請輸入：${phrase}`
    );

    if (normalizeText(answer) !== normalizeText(phrase)) {
      return false;
    }

    return window.confirm(
      `最後確認：現在開始 ${phrase} ${count} 筆。\n\n` +
      '腳本遇到驗證、限制或不明介面時會暫停。是否開始？'
    );
  }

  function buildProfileUrl(handle) {
    const url = new URL(`/@${encodeURIComponent(handle)}`, window.location.origin);
    const language = new URL(window.location.href).searchParams.get('hl');
    if (language) {
      url.searchParams.set('hl', language);
    }
    return url.href;
  }

  function validOriginUrl(urlText, originHandle) {
    try {
      const url = new URL(urlText, window.location.origin);
      return url.origin === window.location.origin &&
        handleFromPath(url.pathname) &&
        handleFromPath(url.pathname).toLowerCase() === originHandle.toLowerCase();
    } catch (_error) {
      return false;
    }
  }

  function navigateToCurrentTarget(state) {
    const target = state.queue[state.index];
    if (!target) {
      finishRun(state);
      return;
    }

    const nextState = {
      ...state,
      status: 'handoff',
      phase: 'beforeAction',
      expectedHandle: target,
      handoffUntil: Date.now() + CONFIG.handoffTtlMs,
      pauseRequested: false,
      lastMessage: ''
    };

    saveState(nextState);
    syncUiFromState();

    if (handleFromPath() && handleFromPath().toLowerCase() === target.toLowerCase()) {
      window.setTimeout(resumeHandoff, 0);
      return;
    }

    window.location.assign(buildProfileUrl(target));
  }

  async function onStartClick() {
    if (!runtime.preview.length || !runtime.previewOwnHandle || readState()) {
      return;
    }

    const mode = runtime.ui.mode.value;
    if (mode !== runtime.previewMode) {
      invalidatePreview();
      updateStatus('操作模式已變更，請重新掃描。', 'warning');
      return;
    }

    if (!underlyingOwnProfileMatches(runtime.previewOwnHandle)) {
      updateStatus('開始前請回到目前登入帳號的個人檔案頁。', 'warning');
      return;
    }

    const currentOwnHandle = getOwnHandle();
    if (!currentOwnHandle || currentOwnHandle.toLowerCase() !== runtime.previewOwnHandle.toLowerCase()) {
      invalidatePreview();
      updateStatus('登入帳號已與預覽不同。請用目前帳號重新掃描。', 'warning');
      return;
    }

    const previewDialog = relationDialog();
    if (!previewDialog || selectedRelationMode(previewDialog) !== mode) {
      invalidatePreview();
      updateStatus('名單已關閉或切換分頁。為避免操作錯誤名單，請重新掃描。', 'warning');
      return;
    }

    const delaySeconds = clampInteger(
      runtime.ui.delay.value,
      CONFIG.minDelayMs / 1000,
      CONFIG.maxDelayMs / 1000,
      CONFIG.defaultDelayMs / 1000
    );
    runtime.ui.delay.value = String(delaySeconds);

    if (!confirmBatch(mode, runtime.preview.length)) {
      updateStatus('已取消。沒有執行任何變更。', 'warning');
      return;
    }

    const ownHandle = getOwnHandle();
    const state = {
      version: CONFIG.stateVersion,
      token: makeRunToken(),
      mode,
      status: 'paused',
      phase: 'beforeAction',
      queue: runtime.preview.slice(0, CONFIG.maxBatchSize),
      total: runtime.preview.length,
      index: 0,
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      delayMs: delaySeconds * 1000,
      originHandle: ownHandle,
      originUrl: window.location.href.split('#')[0],
      expectedHandle: runtime.preview[0],
      handoffUntil: 0,
      confirmedAt: Date.now(),
      nextActionNotBefore: 0,
      pauseRequested: false,
      lastMessage: ''
    };

    runtime.stopped = false;
    try {
      saveState(state);
    } catch (error) {
      syncUiFromState();
      updateStatus(error.message || '無法建立批次暫存，因此沒有開始。', 'danger');
      return;
    }
    runtime.preview = [];
    runtime.previewMode = null;
    runtime.previewOwnHandle = null;
    showPreview([]);
    navigateToCurrentTarget(state);
  }

  function safetySurfaceText() {
    const surfaces = visibleElements(
      document,
      '[role="alert"], [role="status"], [aria-live="assertive"], [role="dialog"]'
    );
    return normalizeText(surfaces.map((element) => element.innerText || element.textContent || '').join(' '));
  }

  function detectedSafetyStopMessage() {
    const captchaFrame = visibleElements(document, 'iframe[title], iframe[src]')
      .find((frame) => /captcha|challenge|security check|verify/i.test(
        `${frame.getAttribute('title') || ''} ${frame.getAttribute('src') || ''}`
      ));
    if (captchaFrame) {
      return 'Threads 顯示 CAPTCHA 或安全驗證框架。腳本已暫停，不會嘗試處理或繞過。';
    }

    const text = safetySurfaceText();
    const matched = LABELS.safetyStop.some((pattern) => pattern.test(text));
    return matched ? 'Threads 顯示錯誤、驗證或操作限制。腳本已暫停，不會嘗試繞過。' : null;
  }

  function assertRunMayContinue(token, allowPause = false) {
    if (runtime.stopped) {
      throw new StopRequestedError();
    }

    const state = readState();
    if (!state || state.token !== token) {
      throw new StopRequestedError();
    }

    const ownHandle = getOwnHandle();
    if (!ownHandle) {
      throw new SafetyPauseError('無法確認登入狀態，已暫停。');
    }

    if (ownHandle.toLowerCase() !== state.originHandle.toLowerCase()) {
      throw new SafetyPauseError('目前登入帳號已與本批預覽帳號不同，腳本已暫停。');
    }

    const expectedHandle = state.queue[state.index] || state.expectedHandle;
    const currentHandle = handleFromPath();
    if (!expectedHandle || !currentHandle || expectedHandle.toLowerCase() !== currentHandle.toLowerCase()) {
      throw new SafetyPauseError('目前頁面已離開預期帳號，腳本已暫停。');
    }

    const safetyMessage = detectedSafetyStopMessage();
    if (safetyMessage) {
      throw new SafetyPauseError(safetyMessage);
    }

    if (!allowPause && state.pauseRequested) {
      throw new PauseRequestedError();
    }

    return state;
  }

  function markActionClicked(token) {
    const state = assertRunMayContinue(token);
    return saveState({
      ...state,
      phase: 'actionClicked',
      lastMessage: '目前動作已送出，正在確認結果。'
    });
  }

  function profileTabBoundary(profileRegion, currentHandle = handleFromPath()) {
    if (!currentHandle) {
      return null;
    }

    const escapedHandle = currentHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const profileTabPattern = new RegExp(`^/@${escapedHandle}/(?:replies|media|reposts)/?$`, 'i');
    const tabTops = visibleElements(profileRegion, 'a[href^="/@"]')
      .filter((link) => {
        try {
          const url = new URL(link.getAttribute('href'), window.location.origin);
          return profileTabPattern.test(url.pathname);
        } catch (_error) {
          return false;
        }
      })
      .map((link) => link.getBoundingClientRect().top)
      .filter((top) => Number.isFinite(top));

    return tabTops.length ? Math.min(...tabTops) : null;
  }

  function findUniqueProfileMore(
    profileRegion,
    tabBoundary = profileTabBoundary(profileRegion)
  ) {
    if (!Number.isFinite(tabBoundary)) {
      return null;
    }

    const candidates = visibleElements(profileRegion, 'button, [role="button"]')
      .filter((button) =>
        button.getAttribute('aria-haspopup') === 'dialog' &&
        matchesLabels(button, LABELS.more) &&
        !button.closest('article, [role="listitem"]') &&
        button.getBoundingClientRect().top < tabBoundary - 2
      );

    return candidates.length === 1 ? candidates[0] : null;
  }

  async function openProfileMenu(profileRegion) {
    const moreButton = findUniqueProfileMore(profileRegion);

    if (!moreButton) {
      throw new SafetyPauseError('無法唯一確認個人檔案標頭的「更多」按鈕。');
    }

    const beforeMenus = new Set(visibleElements(document, '[role="menu"]'));
    if (beforeMenus.size > 0) {
      throw new SafetyPauseError('畫面上已有其他選單。請先關閉選單，再繼續批次。');
    }

    clickVisibleElement(moreButton);
    const menu = await waitFor(() =>
      visibleElements(document, '[role="menu"]').find((candidate) =>
        !beforeMenus.has(candidate) &&
        visibleElements(candidate, '[role="menuitem"]').some((item) =>
          matchesLabels(item, LABELS.removeFollower) ||
          matchesLabels(item, LABELS.knownProfileMenuItem)
        )
      ) || null,
    5000);
    if (!menu) {
      throw new SafetyPauseError('無法確認本次開啟的個人檔案選單。');
    }
    return menu;
  }

  function findActionInSurface(surface, patterns) {
    return visibleElements(surface, 'button, [role="button"], [role="menuitem"]')
      .find((element) => matchesLabels(element, patterns)) || null;
  }

  async function removeFollowerOnCurrentProfile(state) {
    const profileRegion = await waitFor(getProfileRegion);
    if (!profileRegion) {
      throw new SafetyPauseError('個人檔案尚未載入。');
    }

    assertRunMayContinue(state.token);
    let menu = await openProfileMenu(profileRegion);
    const removeItem = findActionInSurface(menu, LABELS.removeFollower);

    if (!removeItem) {
      throw new SafetyPauseError(
        '選單中找不到「移除粉絲」。帳號關係可能已改變，也可能是 Threads 介面改版；腳本已暫停，不會猜測。'
      );
    }

    const beforeActionDialogs = new Set(visibleElements(document, '[role="dialog"]'));
    markActionClicked(state.token);
    clickVisibleElement(removeItem);
    await sleep(450);

    assertRunMayContinue(state.token, true);
    const confirmationSurfaces = visibleElements(document, '[role="dialog"]')
      .filter((surface) => !beforeActionDialogs.has(surface));
    const confirmationSurface = confirmationSurfaces.find((surface) =>
      matchesLabels(surface, LABELS.removeFollower) ||
      visibleElements(surface, '*').some((element) => matchesLabels(element, LABELS.removeFollower))
    );

    if (confirmationSurface) {
      const confirmButton = findActionInSurface(confirmationSurface, LABELS.removeConfirm);
      if (!confirmButton || confirmButton === removeItem ||
        removeItem.contains(confirmButton) || confirmButton.contains(removeItem)) {
        throw new SafetyPauseError('Threads 顯示移除確認視窗，但找不到明確的「移除」按鈕。');
      }
      assertRunMayContinue(state.token, true);
      clickVisibleElement(confirmButton);

      const confirmationClosed = await waitFor(
        () => !confirmationSurface.isConnected || !isVisible(confirmationSurface),
        5000
      );
      if (!confirmationClosed) {
        throw new SafetyPauseError('移除確認視窗仍然開啟，無法確認操作是否完成。');
      }
    }

    await sleep(1100);
    assertRunMayContinue(state.token, true);

    const currentRegion = getProfileRegion();
    if (!currentRegion) {
      throw new SafetyPauseError('移除後無法重新確認個人檔案。');
    }

    menu = await openProfileMenu(currentRegion);
    const stillPresent = findActionInSurface(menu, LABELS.removeFollower);
    if (stillPresent) {
      throw new SafetyPauseError('「移除粉絲」仍出現在選單中，無法確認操作成功。');
    }

    return { status: 'completed', message: '已移除一位粉絲。' };
  }

  function findPrimaryProfileRelation(profileRegion) {
    const tabBoundary = profileTabBoundary(profileRegion);
    const moreButton = findUniqueProfileMore(profileRegion, tabBoundary);
    if (!moreButton || !Number.isFinite(tabBoundary)) {
      return null;
    }

    const moreRect = moreButton.getBoundingClientRect();

    const candidates = visibleElements(profileRegion, 'button, [role="button"]')
      .filter((button) =>
        matchesLabels(button, LABELS.followingAction) ||
        matchesLabels(button, LABELS.followAction)
      )
      .filter((button) => !button.closest('article, [role="listitem"]'))
      .filter((button) => {
        const top = button.getBoundingClientRect().top;
        return top < tabBoundary - 2 && Math.abs(top - moreRect.top) <= 320;
      });

    if (candidates.length !== 1) {
      return null;
    }

    return {
      element: candidates[0],
      state: matchesLabels(candidates[0], LABELS.followingAction)
        ? 'following'
        : 'notFollowing'
    };
  }

  async function unfollowCurrentProfile(state) {
    let profileRegion = await waitFor(getProfileRegion);
    if (!profileRegion) {
      throw new SafetyPauseError('個人檔案尚未載入。');
    }

    assertRunMayContinue(state.token);
    const relation = findPrimaryProfileRelation(profileRegion);
    if (!relation) {
      throw new SafetyPauseError('無法唯一確認個人檔案標頭的主關係按鈕。');
    }
    if (relation.state === 'notFollowing') {
      return { status: 'skipped', message: '目前已沒有追蹤此帳號，已略過。' };
    }

    const beforeActionSurfaces = new Set(
      visibleElements(document, '[role="dialog"], [role="menu"]')
    );
    if (beforeActionSurfaces.size > 0) {
      throw new SafetyPauseError('畫面上已有其他對話框或選單。請先關閉後再繼續。');
    }

    markActionClicked(state.token);
    clickVisibleElement(relation.element);
    await sleep(450);
    assertRunMayContinue(state.token, true);

    const outcome = await waitFor(() => {
      profileRegion = getProfileRegion();
      const currentRelation = profileRegion ? findPrimaryProfileRelation(profileRegion) : null;
      if (currentRelation && currentRelation.state === 'notFollowing') {
        return { type: 'completed' };
      }

      const actionSurfaces = visibleElements(document, '[role="dialog"], [role="menu"]')
        .filter((surface) => !beforeActionSurfaces.has(surface));
      for (const surface of actionSurfaces) {
        const action = findActionInSurface(surface, LABELS.unfollow);
        if (action) {
          return { type: 'confirm', element: action };
        }
      }
      return null;
    }, 5000);

    if (!outcome) {
      throw new SafetyPauseError('按下「追蹤中」後找不到明確的完成狀態或「取消追蹤」控制項。');
    }

    if (outcome.type === 'completed') {
      return { status: 'completed', message: '已取消追蹤一個帳號。' };
    }

    assertRunMayContinue(state.token, true);
    clickVisibleElement(outcome.element);

    const verified = await waitFor(() => {
      const currentRegion = getProfileRegion();
      const currentRelation = currentRegion ? findPrimaryProfileRelation(currentRegion) : null;
      return currentRelation && currentRelation.state === 'notFollowing';
    }, 6000);

    if (!verified) {
      throw new SafetyPauseError('取消追蹤後無法確認按鈕已變成「追蹤」。');
    }

    return { status: 'completed', message: '已取消追蹤一個帳號。' };
  }

  async function waitBetweenActions(notBefore, token) {
    const deadline = Math.max(Date.now(), Number(notBefore) || 0);

    while (Date.now() < deadline) {
      if (runtime.stopped) {
        throw new StopRequestedError();
      }

      const state = readState();
      if (!state || state.token !== token) {
        throw new StopRequestedError();
      }

      if (state.pauseRequested) {
        pauseRun('已依要求在完成目前項目後暫停。');
        return false;
      }

      const safetyMessage = detectedSafetyStopMessage();
      if (safetyMessage) {
        throw new SafetyPauseError(safetyMessage);
      }

      const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      updateStatus(`目前項目完成。${remainingSeconds} 秒後處理下一筆。`);
      await sleep(Math.min(500, Math.max(1, deadline - Date.now())));
    }

    return true;
  }

  async function waitBeforeResumedAction(notBefore, token) {
    const deadline = Math.max(Date.now(), Number(notBefore) || 0);

    while (Date.now() < deadline) {
      if (runtime.stopped) {
        throw new StopRequestedError();
      }

      const state = readState();
      if (!state || state.token !== token) {
        throw new StopRequestedError();
      }

      if (state.pauseRequested) {
        pauseRun('已依要求在下一個動作前暫停。');
        return false;
      }

      assertRunMayContinue(token, true);
      const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      updateStatus(`仍需等待 ${remainingSeconds} 秒，才會開始下一筆。`);
      await sleep(Math.min(500, Math.max(1, deadline - Date.now())));
    }

    return true;
  }

  function pauseRun(message) {
    const state = readState();
    if (!state) {
      return;
    }

    saveState({
      ...state,
      status: 'paused',
      phase: 'beforeAction',
      pauseRequested: false,
      handoffUntil: 0,
      lastMessage: message
    });
    syncUiFromState();
  }

  function finishRun(state) {
    const completedState = saveState({
      ...state,
      status: 'complete',
      phase: 'finished',
      queue: [],
      index: state.total,
      expectedHandle: null,
      handoffUntil: 0,
      pauseRequested: false,
      lastMessage: '本批已完成。'
    });

    syncUiFromState();

    if (validOriginUrl(completedState.originUrl, completedState.originHandle)) {
      window.setTimeout(() => {
        if (!runtime.stopped && readState() && readState().status === 'complete') {
          window.location.assign(completedState.originUrl);
        }
      }, 1200);
    }
  }

  async function processCurrentTarget(state) {
    const target = state.queue[state.index];
    const currentHandle = handleFromPath();

    if (!target || !currentHandle || target.toLowerCase() !== currentHandle.toLowerCase()) {
      throw new SafetyPauseError('目前頁面不是預期目標，已暫停以避免操作錯誤帳號。');
    }

    if (target.toLowerCase() === state.originHandle.toLowerCase()) {
      throw new SafetyPauseError('目標意外指向目前登入帳號，已暫停。');
    }

    assertRunMayContinue(state.token);
    if (state.mode === MODE.REMOVE_FOLLOWERS) {
      return removeFollowerOnCurrentProfile(state);
    }
    return unfollowCurrentProfile(state);
  }

  async function resumeHandoff() {
    if (runtime.processing) {
      return;
    }

    let state = readState();
    if (!state || state.status !== 'handoff') {
      syncUiFromState();
      return;
    }

    runtime.processing = true;

    try {
      if (Date.now() > state.handoffUntil) {
        throw new SafetyPauseError('頁面切換逾時。為避免稍後自動續跑，批次已暫停。');
      }

      if (Date.now() - state.confirmedAt > CONFIG.confirmationMaxAgeMs) {
        throw new SafetyPauseError('原確認已超過兩小時，請重新確認後再繼續。');
      }

      const currentHandle = handleFromPath();
      if (!currentHandle || !state.expectedHandle ||
        currentHandle.toLowerCase() !== state.expectedHandle.toLowerCase()) {
        throw new SafetyPauseError('頁面不是預期目標，已暫停。');
      }

      if (state.pauseRequested) {
        pauseRun('已依要求在下一個動作前暫停。');
        return;
      }

      if (state.nextActionNotBefore > Date.now()) {
        const mayStart = await waitBeforeResumedAction(
          state.nextActionNotBefore,
          state.token
        );
        if (!mayStart) {
          return;
        }
        state = readState();
        if (!state || state.status !== 'handoff') {
          return;
        }
      }

      state = saveState({
        ...state,
        status: 'running',
        phase: 'beforeAction',
        lastMessage: ''
      });
      syncUiFromState();

      const result = await processCurrentTarget(state);
      state = readState();
      if (!state || runtime.stopped) {
        throw new StopRequestedError();
      }

      state = saveState({
        ...state,
        index: state.index + 1,
        completedCount: state.completedCount + (result.status === 'completed' ? 1 : 0),
        skippedCount: state.skippedCount + (result.status === 'skipped' ? 1 : 0),
        phase: 'afterAction',
        nextActionNotBefore: Date.now() + state.delayMs,
        lastMessage: result.message
      });
      syncUiFromState();

      if (state.index >= state.total || state.index >= state.queue.length) {
        finishRun(state);
        return;
      }

      if (state.pauseRequested) {
        pauseRun('已依要求在完成目前項目後暫停。');
        return;
      }

      const shouldContinue = await waitBetweenActions(state.nextActionNotBefore, state.token);
      if (!shouldContinue) {
        return;
      }

      state = readState();
      if (!state) {
        return;
      }
      navigateToCurrentTarget(state);
    } catch (error) {
      if (error instanceof StopRequestedError) {
        return;
      }

      if (error instanceof PauseRequestedError) {
        pauseRun(error.message);
        return;
      }

      let finalErrorMessage = error.message || '批次已因錯誤暫停。';
      const currentState = readState();
      if (currentState) {
        const resultIsUnknown = ['actionClicked', 'verificationUnknown'].includes(currentState.phase);
        try {
          saveState({
            ...currentState,
            status: 'paused',
            phase: resultIsUnknown ? 'verificationUnknown' : 'beforeAction',
            pauseRequested: false,
            failedCount: Math.min(CONFIG.maxBatchSize, currentState.failedCount + 1),
            handoffUntil: 0,
            nextActionNotBefore: resultIsUnknown
              ? Math.max(currentState.nextActionNotBefore, Date.now() + currentState.delayMs)
              : currentState.nextActionNotBefore,
            lastMessage: resultIsUnknown
              ? `${error.message || '無法確認操作結果。'} 為避免重複，腳本不會再次點擊此帳號。`
              : (error.message || '發生不明錯誤。')
          });
        } catch (storageError) {
          finalErrorMessage = storageError.message || finalErrorMessage;
        }
      }
      syncUiFromState();
      updateStatus(finalErrorMessage, 'danger');
    } finally {
      runtime.processing = false;
    }
  }

  function requestPause() {
    const state = readState();
    if (!state || !['handoff', 'running'].includes(state.status)) {
      return;
    }

    saveState({
      ...state,
      pauseRequested: true,
      lastMessage: '已要求暫停。若目前動作已送出，會在驗證後暫停。'
    });
    updateStatus('已要求暫停；不會開始下一筆。', 'warning');
  }

  function pausedRunContextError(state) {
    const ownHandle = getOwnHandle();
    if (!ownHandle || ownHandle.toLowerCase() !== state.originHandle.toLowerCase()) {
      return '目前登入帳號已與本批預覽帳號不同。腳本不會略過或繼續。';
    }

    return detectedSafetyStopMessage();
  }

  function skipPausedCurrentItem() {
    const state = readState();
    if (!state || state.status !== 'paused' || state.phase !== 'beforeAction') {
      return;
    }

    const contextError = pausedRunContextError(state);
    if (contextError) {
      updateStatus(contextError, 'danger');
      return;
    }

    const target = state.queue[state.index];
    if (!target) {
      finishRun(state);
      return;
    }

    if (!window.confirm(
      `略過 @${target}，且不對這個帳號執行「${modeName(state.mode)}」嗎？\n\n` +
      '腳本會保留原本的每筆間隔，再前往下一個帳號。'
    )) {
      return;
    }

    const nextIndex = Math.min(state.total, state.index + 1);
    const nextState = saveState({
      ...state,
      index: nextIndex,
      skippedCount: Math.min(CONFIG.maxBatchSize, state.skippedCount + 1),
      phase: 'beforeAction',
      expectedHandle: state.queue[nextIndex] || null,
      pauseRequested: false,
      lastMessage: `已依你的要求略過 @${target}，沒有點擊關係按鈕。`
    });

    if (nextState.index >= nextState.total || nextState.index >= nextState.queue.length) {
      finishRun(nextState);
      return;
    }

    runtime.stopped = false;
    navigateToCurrentTarget(nextState);
  }

  function resumePausedRun() {
    let state = readState();
    if (!state || state.status !== 'paused') {
      return;
    }

    const contextError = pausedRunContextError(state);
    if (contextError) {
      updateStatus(contextError, 'danger');
      return;
    }

    if (state.phase === 'verificationUnknown') {
      if (!window.confirm(
        '上一筆動作已送出，但腳本無法確認結果。\n\n' +
        '為避免重複操作，腳本不會再點擊該帳號。要略過此筆並繼續下一筆嗎？'
      )) {
        return;
      }

      state = saveState({
        ...state,
        index: Math.min(state.total, state.index + 1),
        skippedCount: Math.min(CONFIG.maxBatchSize, state.skippedCount + 1),
        phase: 'beforeAction',
        pauseRequested: false,
        lastMessage: '已略過上一筆不明結果，未重新點擊。'
      });

      if (state.index >= state.total || state.index >= state.queue.length) {
        finishRun(state);
        return;
      }

      runtime.stopped = false;
      navigateToCurrentTarget(state);
      return;
    }

    const remaining = Math.max(0, state.total - state.index);
    if (!remaining) {
      finishRun(state);
      return;
    }

    if (Date.now() - state.confirmedAt > CONFIG.confirmationMaxAgeMs) {
      if (!confirmBatch(state.mode, remaining)) {
        updateStatus('維持暫停。', 'warning');
        return;
      }
      state.confirmedAt = Date.now();
    } else if (!window.confirm(`繼續剩餘 ${remaining} 筆「${modeName(state.mode)}」嗎？`)) {
      return;
    }

    runtime.stopped = false;
    navigateToCurrentTarget({
      ...state,
      pauseRequested: false,
      lastMessage: ''
    });
  }

  function stopAndClear() {
    const state = readState();
    const active = state && ['handoff', 'running', 'paused'].includes(state.status);

    if (active && !window.confirm(
      '立即停止並清除本批暫存名單？\n\n已經送出的移除或取消追蹤不會復原。'
    )) {
      return;
    }

    runtime.stopped = true;
    runtime.preview = [];
    runtime.previewMode = null;
    runtime.previewOwnHandle = null;

    let parkedSafely = false;
    if (active) {
      const resultIsUnknown = ['actionClicked', 'verificationUnknown'].includes(state.phase);
      try {
        saveState({
          ...state,
          status: 'paused',
          phase: resultIsUnknown ? 'verificationUnknown' : 'beforeAction',
          pauseRequested: false,
          handoffUntil: 0,
          lastMessage: resultIsUnknown
            ? '使用者已停止。上一筆結果不明，重新開啟時不會自動重複點擊。'
            : '使用者已停止。重新開啟時維持暫停。'
        });
        parkedSafely = true;
      } catch (_error) {
        parkedSafely = false;
      }
    }

    const storageCleared = removeState();
    showPreview([]);
    syncUiFromState();

    if (storageCleared) {
      updateStatus('已停止並清除本批分頁暫存。', 'warning');
    } else if (parkedSafely) {
      updateStatus('批次已停止並保持暫停，但瀏覽器拒絕清除分頁暫存。請關閉此分頁或清除 Threads 網站資料。', 'danger');
    } else {
      updateStatus('目前分頁已停止執行，但瀏覽器拒絕讀寫暫存。重新載入前請關閉分頁或清除 Threads 網站資料。', 'danger');
    }
  }

  function recoverInterruptedState() {
    const state = readState();
    if (!state) {
      return;
    }

    const navigationEntry = typeof window.performance?.getEntriesByType === 'function'
      ? window.performance.getEntriesByType('navigation')[0]
      : null;
    const navigationType = navigationEntry ? navigationEntry.type : 'unknown';

    if (state.status === 'handoff' &&
      (Date.now() > state.handoffUntil || navigationType !== 'navigate')) {
      saveState({
        ...state,
        status: 'paused',
        phase: 'beforeAction',
        pauseRequested: false,
        handoffUntil: 0,
        lastMessage: navigationType === 'reload'
          ? '頁面在前往目標期間重新載入。為避免未預期續跑，批次已暫停。'
          : '無法確認這是腳本剛發起的頁面切換，批次已暫停。'
      });
      return;
    }

    if (state.status === 'running') {
      const resultIsUnknown = ['actionClicked', 'verificationUnknown'].includes(state.phase);
      saveState({
        ...state,
        status: 'paused',
        phase: resultIsUnknown ? 'verificationUnknown' : 'beforeAction',
        pauseRequested: false,
        failedCount: resultIsUnknown
          ? Math.min(CONFIG.maxBatchSize, state.failedCount + 1)
          : state.failedCount,
        handoffUntil: 0,
        nextActionNotBefore: resultIsUnknown
          ? Math.max(state.nextActionNotBefore, Date.now() + state.delayMs)
          : state.nextActionNotBefore,
        lastMessage: resultIsUnknown
          ? '頁面在動作送出後重新載入。結果不明，腳本不會再次點擊此帳號。'
          : '頁面在操作前重新載入。為避免未預期續跑，批次已暫停。'
      });
    }
  }

  function handleBfcacheRestore(event) {
    if (!event.persisted) {
      return;
    }

    runtime.stopped = true;
    const state = readState();
    let message = '頁面已從瀏覽器上一頁／下一頁快取還原。批次不會自動續跑。';
    let tone = 'warning';

    if (state && ['handoff', 'running'].includes(state.status)) {
      const resultIsUnknown = ['actionClicked', 'verificationUnknown'].includes(state.phase);
      try {
        saveState({
          ...state,
          status: 'paused',
          phase: resultIsUnknown ? 'verificationUnknown' : 'beforeAction',
          pauseRequested: false,
          handoffUntil: 0,
          nextActionNotBefore: resultIsUnknown
            ? Math.max(state.nextActionNotBefore, Date.now() + state.delayMs)
            : state.nextActionNotBefore,
          lastMessage: resultIsUnknown
            ? '頁面從快取還原時，上一筆結果不明。腳本不會再次點擊此帳號。'
            : '頁面從快取還原。為避免未預期續跑，批次已暫停。'
        });
      } catch (error) {
        message = error.message || message;
        tone = 'danger';
      }
    }

    syncUiFromState();
    updateStatus(message, tone);
  }

  function init() {
    mountPanel();
    try {
      recoverInterruptedState();
    } catch (error) {
      syncUiFromState();
      updateStatus(error.message || '無法安全恢復上次批次，因此沒有繼續。', 'danger');
      return;
    }
    syncUiFromState();

    const state = readState();
    if (state && state.status === 'handoff') {
      window.setTimeout(resumeHandoff, 350);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.addEventListener('pageshow', handleBfcacheRestore);
})();
