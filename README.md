# Daily Desk — browser edition

A local dashboard for your three existing ChatGPT conversations: Robinhood Agent, Daily Briefing, and iPhone Deal Watch.

The interface uses a light vaporwave theme with pearl and lavender surfaces, cyan, pink, and violet accents, static topographic contours, and a CSS sunset. Reports, tables, history, and connection controls share the light palette, with deeper accent colors for readable text. The layout adapts to mobile screens and respects reduced-motion preferences; all visual assets are local.

This version uses an extension in your normal, signed-in Chrome or Edge browser. **OpenAI API generation is disabled.** There is no API SDK, API key setup, or paid API fallback. ChatGPT subscription limits still apply.

## Start and connect

1. Run **Start Dashboard.ps1** in this project, then visit **http://127.0.0.1:4317/**.
2. In the normal browser where you use ChatGPT, open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Disable or remove the old Daily Desk extension if present. Enable **Developer mode**, click **Load unpacked**, and select this project's **extension** folder. Connection setup on the dashboard shows its complete path and a Copy folder button.
4. Keep that browser open and signed into the account that owns the linked conversations. The dashboard says **Browser connection ready** when connected.

The dashboard itself can stay in the Codex in-app browser: the local server relays requests to the extension in your normal browser. You do not need to sign into ChatGPT inside the in-app browser. Sign-in or verification, if requested by ChatGPT, must be completed in your normal browser.

Chrome/Edge 116 or newer is required. For later source updates, click **Reload** on this extension's card. Use **Reset browser pairing** on the dashboard when changing the installed extension or browser; disable the former extension first.

Use **Stop Dashboard.ps1** to stop this project's server. Alternatively, install dependencies with `npm install` and start with `npm start` (Node.js 22 or newer).

## Buttons

- **View conversation**: shows the last locally saved reply immediately, even when the extension is offline. It sends nothing and opens no chat tab.
- **Sync latest**: reads the most recent completed reply in that existing chat. It sends no message.
- **Run today**: sends exactly **Try again today** once to that chat and waits for a new completed reply after that message. It never displays an older reply as the new result.
- **Response history**: opens prior locally saved replies, including labelled API archives from the previous version.

The extension temporarily opens an inactive tab for the selected ChatGPT conversation and closes only that tab when finished. It does not navigate or close your own tabs. The dashboard does not link to the ChatGPT interface.

Sending is confirmed by observing the new user message. Other drafts are preserved. Duplicate clicks reuse the current request. A dashboard page refresh resumes checking the same request. A server or extension restart with uncertain send status does **not** resubmit a prompt: use Sync latest before another Run today.

A new reply can take several minutes. Sign-in, service limits, verification, missing conversation access, or changes to ChatGPT's page structure can stop a request. The dashboard reports the failure and retains the previous report. This browser integration depends on the ChatGPT interface and may need maintenance when it changes.

Extension 2.0.2 checks the loaded page before reading or sending and distinguishes sign-in, browser verification, unavailable conversations, page errors, and an unrecognized conversation layout. Failed requests include page state, element counts, and a limited list of element labels and attributes in `.local/extension-state.json`; no cookies, tokens, or page transcript are collected. The packaged `extension/conversation-dom.js` reader is loaded on each request and shares layout detection between reading and sending. Reload the extension card in Chrome or Edge after updates to its background worker or manifest; the dashboard flags an older connected version.

The reader supports both the older message attributes and the current Conversation region, user-message bubbles, and selection-marked Markdown replies. New syncs preserve headings, bold, italics, nested lists, tables, quotes, and code. The dashboard renders sanitized Markdown with source links and horizontally scrollable tables on small screens. Older plain-text snapshots remain readable as originally saved; Sync latest retrieves the formatting of the current reply without sending a prompt. The reader recognizes the Ask ChatGPT composer and limits Send-button compatibility to that composer. When ChatGPT combines multiple explicitly dated daily briefings in one rendered reply, the dashboard displays the final dated briefing.

The shared reader source is `src/conversation-dom.js`. Run `npm run build:reader` after editing it to regenerate the checked-in `extension/conversation-dom.js` bundle. That packaged reader loads on the next sync without an extension reload. Formatting libraries are bundled or served locally; no CDN or API requests are involved.

Emphasis is preserved from both semantic HTML tags and ChatGPT's CSS-styled spans. The reader inspects rendered font weight and italics before converting the response to Markdown, including inherited styling, while keeping code and retry-prompt confirmation literal. If an older saved reply lost emphasis, Sync latest recovers it from the current chat.

## Existing tasks and prompts

The three linked conversation IDs are in `extension/policy.js`; sending is also constrained to the same IDs in `extension/submit-retry.js`. These are your original ChatGPT chats, not the API conversations created by the previous edition.

`prompts/` retains the instructions you supplied, and the website displays them for reference. The existing ChatGPT chats use their own conversation instructions. Editing a local prompt file does not change a ChatGPT thread; Run today sends only the short retry message.

There is no new automatic schedule. Existing ChatGPT scheduled tasks are unchanged. The extension reads whatever completed response ChatGPT provides for the iPhone check, including a no-deal status if one is generated. It does not generate separate quiet-check messages or notifications.

Robinhood runs inside the existing ChatGPT conversation and its connected tools. The extension only types the requested prompt and reads the response. It does not click broker approvals, permission dialogs, or trade confirmation controls. If ChatGPT pauses for an approval, that requires attention in your normal browser.

## Local data and security

- `.local/extension-state.json`: paired extension identity, job status, send confirmation, and saved report history.
- `.local/api-state.json`: retained API-era report data, read locally only during initial migration. API jobs are never resumed.
- `data/imported.json`: original ChatGPT snapshots, if available.
- `.local/server.log`, `.local/server-error.log`, `.local/server.pid`: local server lifecycle.

The new project does not load the old API key or Robinhood OAuth credentials. Local data, browser test profiles, and dependencies are excluded from Git. Keep report data private.

The server binds to loopback, validates Host and request Origin, requires a per-session token for dashboard mutations, and uses expiring one-use credentials to authenticate the extension WebSocket. The first successfully connected extension is paired locally. Only the three configured task chats can be read or retriggered. No cookies or ChatGPT access tokens are read or exported.

## Tests and recoverable history

`npm test` covers disabled API endpoints, private routes, authentication, preserved reports, duplicate requests, sync behavior, mismatched conversations, and restart recovery. `npm run test:browser` tests the actual extension against isolated mock ChatGPT pages; it sends no real prompts and places no trades. It uses the locally installed test Chromium, or an executable supplied through `CHROMIUM_PATH`.

Git commit **e985677** preserves the API dashboard source before the extension restoration. View it with `git show e985677:<path>` or inspect `git log --oneline`. Runtime reports and credentials are intentionally outside Git.
