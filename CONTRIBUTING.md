# Contributing

Thank you for helping improve this userscript.

## Safety boundaries

Changes must preserve these rules:

- Do not use private Threads APIs, scraped credentials, cookies, CSRF tokens, or login tokens.
- Do not bypass CAPTCHA, verification, rate limits, or account restrictions.
- Do not add stealth, fingerprint evasion, or human-behavior simulation.
- Do not send handles, account data, telemetry, or operation summaries to third parties.
- Do not add advertising, referral links, mining, tracking, or unrelated site matches.
- Destructive controls must be visible, uniquely identified, and bound to the expected profile.
- Persist the action phase before every destructive click.
- Unknown results must pause and must not be clicked again automatically.
- Interface uncertainty must stop the batch rather than guess.

## Pull requests

- Explain the user-visible change and the safety impact.
- Keep the code readable and unminified for Greasy Fork review.
- Update `@version` and the change notes when behavior changes.
- Add or update offline tests where possible.
- Do not use real private handles or live account actions in test fixtures.

Run these checks before opening a pull request:

```bash
node --check threads-safe-batch-manager.user.js
node tests/userscript.test.js
```
