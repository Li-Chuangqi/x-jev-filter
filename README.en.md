<p align="center"><img src="extension/icons/icon-128.png" width="112" alt="A broom sweeping a large X silhouette"></p>

# X Jev Filter · X 清流

**A cleaner X timeline, on your terms.** A Chrome extension that filters selected advertising categories in posts and replies with Jev, with an optional filter for suspected AI-written text.

[简体中文](README.md) | **English**

> Version 0.4.1 · Manifest V3 · Personal-use prototype. Decisions can be wrong. Full validation against live X pages and the real Jev API, including accuracy evaluation, has not been completed.

[更新日志 / Changelog](CHANGELOG.md) · [v0.4.1 Release](https://github.com/Li-Chuangqi/x-jev-filter/releases/tag/v0.4.1)

## Features

- **Choose what to filter:** platform ads, product promotions, paid services and courses, affiliate/referral offers, commercial lead generation, investment/crypto promotions, gambling promotions, and adult-service ads.
- **Optional AI-authorship assessment:** independent of advertising, disabled by default. Text-only heuristics cannot prove who authored a post.
- **Reversible collapsing:** see a reason and restore the original post, or hide filtered posts without a placeholder.
- **Account allowlist:** bypass filtering and avoid submitting those accounts’ text to the model.
- **Request controls:** content caching, cooldowns, and a daily request budget shared across X tabs. Errors leave content visible.
- **No backend or build step:** plain JavaScript with no npm dependencies at extension runtime.

## Install

Download the [v0.4.1 extension ZIP](https://github.com/Li-Chuangqi/x-jev-filter/releases/download/v0.4.1/x-jev-filter-0.4.1.zip), extract it, and load the directory containing `manifest.json`. **Export rules before upgrading from v0.3.x; the new extension ID may prevent automatic data migration.**

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
| Limit daily API requests | On, 1,000/day; optional under advanced settings, shared across X tabs |

Platform ads are identified locally using page markers. When this category is off, identified platform ads also bypass AI processing. For AI advertising categories, matching any selected category can trigger filtering; categories can overlap. AI-authorship assessment is separate and works with all advertising categories deselected, but still requires the Jev master switch.

Automatic API decisions process on-screen text in a visible tab; local rules also apply to loaded content. Requests include at most 5,000 characters. Up to 500 content-hash decisions are cached for 24 hours within the browser session. Limits are 120 requests per minute and a 12-second timeout. Failed requests and manual connection tests count toward the local budget; this is not a dollar spending cap. Under Connect Jev → Advanced settings, turn off “限制每日 API 请求量” (Limit daily API requests) to remove the daily cap. Usage statistics, per-minute limits and error cooldowns remain active. Updates preserve existing caps; re-enabling the limit uses the previously saved value.

## Personal cross-device sync (v0.4.0)

Use the same Chrome account with extension sync enabled, install the same extension ID on each device, and opt in to “通过 Chrome 同步我的规则” in each installation. Rules merge on first enable; edits, enabled state, rule exceptions and deletions sync afterward. Offline filtering continues normally.

The rule-sync switch syncs only rules. Names, conditions and templates can contain account handles or original text. API keys, independent source samples, global allowlists, preferences and usage remain local. No public sharing or X authorization is involved; different X accounts in one Chrome profile share these rules.

Concurrent edits use the newer version timestamp, with device IDs breaking ties; keep device clocks accurate. Up to 20 replaced local rules are retained as exportable conflict backups, recoverable through import (disabled by default). Durable deletion markers prevent stale devices from resurrecting deleted rules. Chrome quotas are 100 KB total, 8 KB per item and 512 items, including deletion markers. Capacity failures retain local data and display an error. Disable stops this device only and does not erase cloud data. The extension cannot verify Chrome sign-in or cloud delivery; status indicates local Chrome sync storage reconciliation only.

**Before upgrading from v0.3.x, export rules from the old installation.** v0.4.0 introduces a stable public manifest key for unpacked installs, ID `hbcocdmomlljjgphneaeefolcondcnll`. Chrome may treat it as a separate extension. Disable the old install, import and enable your rules in the new one, and reconfigure preferences and API credentials. On other devices, enable sync without importing duplicate copies. A future Web Store identity may require another migration. Real cross-device delivery with a signed-in Chrome account still requires user-environment validation.

## Optional encrypted Jev key sync (v0.4.1)

Key sync is separate from rule sync and off by default. Save your API key on the first device, enable key sync, and create an independent passphrase of at least 12 characters. On another device with the same Chrome account and extension ID, enter that passphrase once to unlock the synced key without pasting the API key again.

Web Crypto uses PBKDF2-SHA-256 (600,000 iterations), AES-256-GCM, a random salt and fresh IVs. Only algorithm parameters and ciphertext enter Chrome sync. The passphrase is neither uploaded nor saved. A non-exportable CryptoKey persists in device-local extension IndexedDB so the session key can be restored after restart. This does not protect against an attacker controlling the browser/device.

Saving a replacement API key while sync is enabled updates the encrypted cloud record. Failed writes keep the previous key and report an error. Turning sync off removes the device unlock credential but retains the current session key. “Clear key” also disables this device's key sync to prevent restoration. Neither action erases cloud ciphertext or keys on other devices. AI filtering remains independently opt-in on each device. Keep the passphrase safe; there is no passphrase recovery. Incorrect passwords and corrupt ciphertext preserve the existing local key.

Actual Chrome Web Crypto / IndexedDB persistence has been checked with mocked sync transport; transfer between real signed-in devices remains unverified.

## Explicit, editable blocking rules

The crossed-eye action appears to the left of Share when hovering over a post or reply. Click it to block and learn immediately, with no selection menu:

- **Block and learn similar content:** collapse immediately without an editor, confirmation or toast. Save reliable local conditions automatically; otherwise save a post-only rule and sample. Undo from the collapsed bar or edit in settings. Save failures appear only in the collapsed bar; temporary hiding remains active.

The settings rule manager supports creation, editing, source inspection, enable/disable, deletion, search and JSON import/export. Collapsed placeholders identify the matching rule and offer restoration or rule removal.

| Type | Editable fields | Execution |
| --- | --- | --- |
| Account | Handle and keyword/account exceptions | Local exact match |
| Content | Text/name/both, keywords, URL domains, AND/OR conditions, or a near-duplicate text template | Local matching |
| Semantic | Explicit content pattern, scope and natural-language exceptions | Separate Jev decision per rule |

- Keywords use case-insensitive substring matching. Domains match exact hosts in visible HTTP(S) text URLs, without expanding shortened links or automatically including subdomains. Similarity templates require at least 20 characters and only match very close text of comparable length.
- Clicking the learning action saves complete extracted conditions directly as active rules. Generic short replies save a post-only rule and sample that can be edited later in settings. The extension does not generate natural-language rules or train/fine-tune a model.
- Per-rule keyword and account exceptions override that rule; other rules can still match. The global allowlist overrides all rules.
- **Semantic rules are off by default** and require both the Jev master switch and “用 Jev 执行语义规则”. Requests include current text/name, all eligible active semantic descriptions and exceptions, and up to five related source samples with text/display names. Each rule has its own Noul question and requires at least a 0.98 score, which is not measured accuracy. Rule/sample changes invalidate relevant prior decisions.
- **Saved rules are not evicted at 100 entries.** Only independent source samples are capped at 100, deduplicated, then evicted oldest first. Deleting a source never deletes the saved rule or its template/description. Browser storage failures report an error instead of silently deleting rules.
- Imports add rules without replacing existing ones and keep all imported rules disabled for review. Exports contain conditions, handles and template text, but not independent source records, API keys or usage. Import files are limited to 2 MB each.
- Upgrades migrate existing account/post/similarity records into editable rules, preserving previous switch intent. Previously evicted records cannot be recovered. Legacy single-post blocks remain editable post-ID rules.

## Privacy and credentials

When enabled, Jev receives visible post text and quoted text through **TypeSafe**. This may include protected-account posts and personal information contained in the text. The extension does not read DMs or deliberately send account identifiers, post URLs, cookies, images, or video. Opt-in Jev semantic rules also send display names, rule descriptions/exceptions and reference examples as described above. Information appearing inside post text is transmitted with that text.

- By default plaintext keys remain in trusted `chrome.storage.session` only. Optional encrypted key sync stores ciphertext in Chrome sync and a non-exportable device CryptoKey in extension IndexedDB, allowing session restoration after restart. The passphrase is not stored or uploaded.
- Preferences and usage totals are local. Hashed decision caches are session-only. No built-in telemetry. Rules and independent source samples may retain text, display names, handles and post IDs locally across restarts. Rules remain until explicitly deleted; source samples can be deleted or evicted by the separate sample limit.
- Server-side data handling is governed by [TypeSafe’s privacy policy](https://typesafe.ai/legal/privacy-policy).

The fixed endpoint is `https://api.typesafe.ai/v1/systemone`, using `jev-latest` and the native `state + questions` / `noul` contract, not a chat-completions endpoint. See the [TypeSafe API reference](https://docs.typesafe.ai/api).

## Limitations and validation

X layout changes can break detection. Posts remain visible while requests are pending. This version does not perform OCR, video analysis, or full-thread context analysis. Advertising judgments may be incorrect, AI-authorship assessment is uncertain, and model updates can change behavior.

**56 simulated tests pass**, covering DOM recycling, category changes, caching, rate limits, fail-open behavior, and restoring content. These tests do not establish live-site compatibility or model accuracy. The extension is not listed in the Chrome Web Store. This project is not affiliated with X or TypeSafe.

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
