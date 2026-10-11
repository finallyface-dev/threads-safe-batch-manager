# Threads Toolkit — Follower Manager, Copy Text & Clean Links

Preview your Threads followers or following list, select the accounts you want to manage, and confirm the batch before removing followers or unfollowing accounts one at a time. The panel includes individual selection, Select all, Deselect all, a waiting-time estimate, pause, skip, and stop controls.

If you find this script useful, please give it a star on [GitHub](https://github.com/finallyface-dev/threads-safe-batch-manager).

[English description for Greasy Fork](GreasyFork-description.en.md)

[繁體中文](README.md)

> [!WARNING]
> This project is not affiliated with or authorized by Meta or Threads. Automated scanning and batch actions may violate platform terms and may lead to verification prompts, action limits, or account restrictions. The batch cap and delay are conservative design choices, not Meta-approved safety limits.

`safe` in the repository name refers only to confirmation, identity checks, and stop mechanisms in the official release. It is not an account-safety guarantee. The MIT License allows third-party modifications, and forks may remove these safeguards.

## Features

- Optional post tools to copy identifiable visible text and post links without query parameters or fragments.
- Enable post tools in the panel. They are off by default and support identifiable article containers and the pressable post containers currently used by Threads. Current panel labels remain in Traditional Chinese.
- Feature ideas reference [Threads Plugin](https://github.com/Jwander0820/threads-plugin). This implementation does not copy its code.

- Remove followers or unfollow accounts in separate modes.
- Read-only preview before any relationship change.
- View every account in the preview and select accounts individually, select all, or deselect all.
- Estimate waiting time from the selected account count and action delay. Page loading and confirmation take additional time.
- Typed confirmation and a final confirmation dialog.
- Confirmation applies to the whole batch, not to every account. If Threads presents a clearly identified native confirmation dialog, the script continues that confirmed batch by clicking the required confirmation control.
- Maximum of 50 accounts per batch. The panel shows an extra risk warning above 25.
- Fixed delay of 8 to 30 seconds between actions.
- Pause, explicitly skip the current item, or stop and clear session data.
- Cancel scanning while a list opens, tabs switch, or scrolling settles. The panel scrolls on short screens, and waiting-time estimates update while editing the delay.
- Fail closed on CAPTCHA, rate limits, account changes, ambiguous controls, reloads, history navigation, and BFCache restores.
- No private API, telemetry, ads, tracking, external code, or custom update checker.

## Install

Install Tampermonkey, Violentmonkey, Greasemonkey, or another userscript manager.

[Install or view the userscript source](https://github.com/finallyface-dev/threads-safe-batch-manager/raw/refs/heads/main/threads-safe-batch-manager.user.js)

If your browser only displays the source, create a new script in your userscript manager, paste the complete file, and save it.

## Use

1. Sign in at `https://www.threads.com/`.
2. Open your own profile and close any existing followers/following dialog.
3. Select Remove followers or Unfollow in the panel.
4. Set the batch cap and delay.
5. Scan, review the full preview, and deselect accounts you want to keep.
6. Confirm the batch and enter the requested confirmation phrase.

Removing a follower and unfollowing an account are different actions. See Meta's help pages for [removing a Threads follower](https://help.instagram.com/1414274879323976/) and [following or unfollowing on Threads](https://help.instagram.com/150298994419902/).

## Privacy and safety

- Target handles are stored only in the current tab's `sessionStorage` while the batch is active.
- `sessionStorage` is not isolated userscript-manager storage. Same-origin Threads page code can read the tab's data, and duplicating a tab may copy its initial session storage.
- The target queue is deleted from session storage after the batch completes.
- The script does not read passwords, cookies, login tokens, private messages, or CSRF tokens.
- The script does not send lists or summaries to the author or any third party.
- It uses only visible, uniquely validated Threads controls and stops when the interface is ambiguous.
- An unknown action result is never clicked again automatically.
- CAPTCHA, verification, and platform limits are never handled or bypassed.

## Development

The userscript and basic offline tests require no build step or external package.

```bash
node --check threads-safe-batch-manager.user.js
node --test tests/*.test.js
```

The tests are offline. They do not sign in to Threads or modify account relationships.

For the post-copy and panel-layout browser suite, provide Playwright and its Chromium browser, then run `node tests/post-tools.browser.js`. Alternatively, set `PLAYWRIGHT_MODULE` to an existing Playwright package and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a local Chromium-based browser. The suite uses a separate temporary browser and intercepts website requests with local fixtures; it does not connect to Threads.

On 2026-08-24, the current Traditional Chinese Threads DOM and selectors were checked read-only in Edge. A complete live batch was not run against a user account. Other browser, userscript-manager, and interface-language combinations remain unverified.

On 2026-10-11, the current Threads home feed post-container structure was inspected read-only. Copy-tool and scan-cancellation changes are additionally covered by local fixtures; this is not a live batch execution test.

The `main` branch is the development source. Formal versions use a Git tag matching the userscript `@version`, such as `v1.1.0`. Use a tag rather than raw `main` when you need an immutable version.

`SHA256SUMS` contains the SHA-256 checksum for the released userscript file.

## License

Released under the [MIT License](LICENSE).

Meta, Threads, Instagram, and related names are trademarks of their respective owners. This project is not affiliated with, endorsed by, or sponsored by Meta.
