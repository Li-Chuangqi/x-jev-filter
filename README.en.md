<p align="center"><img src="extension/icons/icon-128.png" width="112" alt="A broom sweeping a large X silhouette"></p>

# X Jev Filter · X 清流

**A cleaner X timeline, on your terms.** A Chrome extension that filters selected advertising categories in posts and replies with Jev, with an optional filter for suspected AI-written text.

[简体中文](README.md) | **English**

> Version 0.1.5 · Manifest V3 · Personal-use prototype. Decisions can be wrong. Full validation against live X pages and the real Jev API, including accuracy evaluation, has not been completed.

## Features

- **Choose what to filter:** platform ads, product promotions, paid services and courses, affiliate/referral offers, commercial lead generation, investment/crypto promotions, gambling promotions, and adult-service ads.
- **Optional AI-authorship assessment:** independent of advertising, disabled by default. Text-only heuristics cannot prove who authored a post.
- **Reversible collapsing:** see a reason and restore the original post, or hide filtered posts without a placeholder.
- **Account allowlist:** bypass filtering and avoid submitting those accounts’ text to the model.
- **Request controls:** content caching, cooldowns, and a daily request budget shared across X tabs. Errors leave content visible.
- **No backend or build step:** plain JavaScript with no npm dependencies at extension runtime.

## Install

1. Select **Code → Download ZIP** on GitHub and extract to a permanent folder, or clone this repository.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the project’s **`extension/` folder**, not the repository root.
4. Refresh X and click the extension icon to open settings.
5. To use Jev, create a key in the [TypeSafe console](https://console.typesafe.ai/), enter it under “连接 Jev” (Connect Jev), test the connection, and enable “用 Jev 识别营销内容” (Use Jev to identify promotional content).
6. Select your categories and click “保存设置” (Save settings).

The extension UI is currently in Simplified Chinese; this repository provides documentation in both languages.

To update, replace the files in the same directory, reload the extension in Chrome, and refresh X and the settings page. Never put an API key in source files or commit one to GitHub.

## Defaults and behavior

| Setting | Default |
| --- | --- |
| Extension filtering | On |
| Platform ads | **Off** |
| Jev processing | **Off**; requires a key and explicit activation |
| Suspected AI-written text | **Off** |
| AI advertising categories | All selected, active only when Jev is enabled |
| Collapsed-content placeholder | On |
| Filtering threshold | 0.95; a model estimate, not measured accuracy |
| Daily request limit | 1,000, shared across X tabs |

Platform ads are identified locally using page markers. When this category is off, identified platform ads also bypass AI processing. For AI advertising categories, matching any selected category can trigger filtering; categories can overlap. AI-authorship assessment is separate and works with all advertising categories deselected, but still requires the Jev master switch.

Only on-screen post text in a visible tab is processed. Requests include at most 5,000 characters. Up to 500 content-hash decisions are cached for 24 hours within the browser session. Limits are 120 requests per minute and a 12-second timeout. Failed requests and manual connection tests count toward the local budget; this is not a dollar spending cap.

## Privacy and credentials

When enabled, Jev receives visible post text and quoted text through **TypeSafe**. This may include protected-account posts and personal information contained in the text. The extension does not read DMs or deliberately send author fields, post URLs, cookies, images, or video. Information appearing inside post text is transmitted with that text.

- Keys remain in `chrome.storage.session`, inaccessible to content scripts, and must be entered again after the browser exits.
- Preferences and usage totals are local. Hashed decision caches are session-only. No built-in telemetry or raw-post logging.
- Server-side data handling is governed by [TypeSafe’s privacy policy](https://typesafe.ai/legal/privacy-policy).

The fixed endpoint is `https://api.typesafe.ai/v1/systemone`, using `jev-latest` and the native `state + questions` / `noul` contract, not a chat-completions endpoint. See the [TypeSafe API reference](https://docs.typesafe.ai/api).

## Limitations and validation

X layout changes can break detection. Posts remain visible while requests are pending. This version does not perform OCR, video analysis, or full-thread context analysis. Advertising judgments may be incorrect, AI-authorship assessment is uncertain, and model updates can change behavior.

**22 simulated tests pass**, covering DOM recycling, category changes, caching, rate limits, fail-open behavior, and restoring content. These tests do not establish live-site compatibility or model accuracy. The extension is not listed in the Chrome Web Store. This project is not affiliated with X or TypeSafe.

## Development

Use Node.js 22 or newer:

```sh
npm ci
npm test
npm run check
```

```text
extension/             Loadable Chrome extension
  icons/               16 / 32 / 48 / 128 px icons
assets/                Master icon and generation prompts
tests/                 Node + jsdom simulated tests
README.md              Chinese documentation
```

The AI-generated icon depicts a broom sweeping a large X silhouette. See the [design prompts](assets/icon-design.md).
