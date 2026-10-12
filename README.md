# Daily Desk — API edition

A local website for Robinhood Agent, Daily Briefing, and iPhone Deal Watch. It uses the official OpenAI Responses and Conversations APIs. The browser extension is no longer used.

## Start

Run **Start Dashboard.ps1**, then open **http://127.0.0.1:4317/** in any browser. Use **Stop Dashboard.ps1** to stop it. Alternatively, run `npm install` once and `npm start`. Node.js 22 or later is recommended.

The server listens only on the local computer. It must remain running while requests are in progress.

## API connection

Open **API settings** on the website. An existing `OPENAI_API_KEY` environment variable is used automatically. You can instead enter a key there and save it. The key is never returned to the browser. Saved credentials use Windows DPAPI protection for the current Windows user; on other systems they use a private file with owner-only permissions.

**Check API connection** verifies access and creates three separate API conversations if they do not exist. Metadata access can succeed even when the API project has no generation credit. A failed run reports that billing problem explicitly.

Defaults:
- Daily Briefing and iPhone Deal Watch: `gpt-5.4-mini`.
- Robinhood Agent: `gpt-5.4`.

Both are configurable in API settings. Generation and web search are billed to the API project. Viewing a saved reply makes no model request.

## Use

**View conversation** shows the latest locally saved reply immediately. **Response history** opens earlier API replies. **Run today** sends a new daily request to the same task's API conversation using its full instructions and the current New York date and time.

The prompts are stored in `prompts/` and can be viewed in the website's **Task instructions** section. The Robinhood prompt was copied from the supplied trading instructions. The iPhone model-list typo was normalized to 16/17/18 Pro Max.

All new daily runs request current web research. The iPhone task returns a private quiet-status marker when no new standout deal qualifies; the website records the check without a deal alert. No desktop notifications are created.

Daily Briefing and iPhone Deal Watch run in two steps in the same conversation. Research has a web-action allowance of 6 for the briefing or 8 for deals, including page opens and finds. Web search is required, and a run without any completed search cannot become a fresh daily report. Research uses low reasoning effort and a 6,000-token output budget, then a separate writing step gets its own 6,000-token budget with tools disabled. Research notes are not saved as a finished report. The website shows **Writing your report** during the second step.

If research exhausts its token budget, the writing step can still summarize the collected evidence with a visible limited-coverage warning. It must disclose missing checks. An interrupted iPhone check cannot silently become a successful no-deal result. If writing also fails, the previous complete report stays available; there is no further automatic generation attempt. These two steps are API-billed, and token limits include reasoning as well as answer text.

Refreshing the page reconnects to an existing run. Duplicate clicks for a running task reuse that run. When the server restarts with a known response ID, it retrieves that response rather than submitting it again. An unconfirmed creation request is not automatically resent.

The original ChatGPT snapshots remain available, clearly labelled, until a task has its first API reply. They are not imported into the new API conversation. Existing ChatGPT schedules are not changed; this website currently runs tasks when you click **Run today**.

## Robinhood

Choose **Connect Robinhood** in API settings to authorize the website's own connection through Robinhood's OAuth page. This is separate from the ChatGPT/Codex connector. The flow uses PKCE, a one-use state value, and the local callback `http://127.0.0.1:4317/oauth/robinhood/callback`. Tokens are saved with Windows credential protection and refreshed when needed.

Enter your intended brokerage account number in API settings before submitting an order. The model may research without an account selection, but the server blocks an order that does not match the chosen account.

The supplied research and trading rules are passed to the model on each run. Tool access is restricted to research/account reads and the stock preview/placement tools. The server blocks sells, unsupported order fields, extended-hours orders, orders over $20 notional, changed or expired previews, previews with broker alerts, and a second order attempt in the same run. It requires a broker quote disclosure and your review of the exact proposal on the website before approving a submission. Broker approval requirements still apply. Approving a proposal is not confirmation that it filled.

The prompt also requires verification of market holidays/early closes, settled buying power, fees, security eligibility, and the investment criteria. These checks depend on current broker/research data; a weekday time-window check alone does not establish that the market is open.

No real trades are used in automated tests.

Robinhood retains its broker approval flow. A response-limit failure does not automatically replay or continue trading actions.

## Data and maintenance

- `.local/api-state.json`: conversation IDs, request progress, response history, and per-response diagnostics (phase, API status, exact incomplete reason/error code, token usage, configured limits, and tool counts). Usage on a saved report totals all steps in that run. Diagnostic metadata excludes credentials, broker arguments, and internal reasoning text. Diagnostics are also available on the local `/api/jobs/<job-id>` endpoint.
- `.local/settings.json`: model preferences.
- `.local/credentials.dpapi`: encrypted saved credentials on Windows.
- `prompts/`: task instructions.
- `data/imported.json` and `.local/responses.json`: earlier saved ChatGPT copies.

New conversation messages are stored by the OpenAI API as well as locally. Private runtime files are not served as web assets. Do not publish this folder's private data. The retired Daily Desk extension can be removed from Chrome or Edge.

## Validation

Run `npm test`. Tests use simulated API/broker responses and cover persistent conversations, duplicate runs, saved reads, credentials, OAuth state/PKCE, order limits, explicit approval, restart recovery, billing errors, research-limit recovery, tool-free writing, exact failure diagnostics, and preservation of complete reports. Browser QA additionally checks refresh recovery, history, source rendering, quiet checks, mobile layout, and error states.

References: [Responses API](https://developers.openai.com/api/reference/responses/overview), [conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [web search](https://developers.openai.com/api/docs/guides/tools-web-search), and [MCP integration](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).

