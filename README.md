# WebSearch Plus

An English-language fork of [SillyTavern/Extension-WebSearch](https://github.com/SillyTavern/Extension-WebSearch), with deprecated Extras removed and an optional modern Tavily workbench.

## Two components, no core patch

1. **This extension**: fixes loading on SillyTavern forks without the Extras exports and preserves SerpApi, Serper, SearXNG, Selenium, KoboldCpp, Z.AI and Tavily. It registers the existing WebSearch / VisitLinks tools, slash command and Data Bank scraper.
2. **[Tavily companion server plugin](https://github.com/xhlr8/SillyTavern-Tavily-Companion)**: adds server-side Search, Extract, Map, Crawl, Research and Usage. Credentials never need to be exposed to the browser or stored in this repository.

The companion is optional. Without it, legacy Tavily search still uses SillyTavern's existing backend, but advanced settings cannot be applied. The UI clearly labels that fallback and disables companion-only operations. A broken or unauthorized companion is reported instead of silently causing a second paid request.

## Installation

Back up your current extension/configuration first. Do not install both the original and this fork at once: they use the same tool names, setting IDs and generation hook.

Install this URL through SillyTavern's extension installer:

https://github.com/xhlr8/Extension-WebSearch

For an existing clean checkout of the original extension, advanced users can repoint its origin to this fork and fast-forward. Do not reset/discard local edits. Installing through the extension manager is generally simpler.

Install the companion following its README under SillyTavern's plugins directory, enable server plugins in configuration, and **restart SillyTavern when you choose**. Server-plugin installation is distinct from frontend extension installation. No script in these repositories automatically installs, restarts, updates or modifies your SillyTavern core.

Set the Tavily key with the existing **Tavily AI Key** button in Web Search settings. The companion reads the active SillyTavern user's Tavily secret. DSH's Windows TAVILY_API_KEY is unrelated. Do not put keys in source control.

Automatic updates are disabled in this fork's manifest for predictable rollouts. Review changes and update explicitly. Your SillyTavern-wide auto-update settings may independently affect updates; review them too.

## Free-plan preset (default)

Designed for Tavily's documented 1,000-credit free monthly allowance. Search defaults to basic (1 credit), five results, automatic parameter selection OFF, generated answer/raw content/images OFF. Requesting fewer results saves context, not per-search credits. No API test runs automatically and no test in this repository spends credits.

On first use of this fork, a one-time migration applies these conservative Tavily settings, turns automatic Visit Links OFF, and limits model-initiated page reads to the first 3 requested URLs. A notice is shown; existing provider selection, credentials and activation mode are preserved. Subsequent manual changes remain saved. Manual extraction can still batch up to 20 URLs. Use the Free-plan search preset to restore conservative settings later.

**Map, Crawl and Research are kept but disabled by default**, not merely hidden. Explicitly enable them for the signed-in user through the companion-backed session opt-in control, then confirm each individual request. Turning the preference off blocks new costly tasks but leaves polling/forgetting existing research available. The backend resets this nonpersistent preference on restart/expiry; saved browser settings cannot bypass it.

The opt-in is not a credit budget. Use Tavily's API-key/account limits for provider-enforced spending limits. Research Mini can use up to the currently documented 110 credits; Pro up to 250. Stopping local monitoring does not cancel billing.

## Features

### Search

- Quick, Detailed and Recent News presets, plus advanced settings.
- Basic / advanced / fast / ultra-fast depth; result and chunk limits.
- General / news / finance topics; date windows and estimated publication dates.
- Domain allow/block lists; prefer domains or strictly restrict them.
- English-language preference (not mandatory exclusion of other languages), strict language toggle and country preference.
- Optional generated answer, cleaned raw content, image descriptions, favicons and usage.
- Automatic parameter choice remains opt-in. Explicit parameters override automatic choices; depth can affect credit cost.
- Structured evidence with a source ID, title, URL and excerpt. Dates and relevance scores are metadata, not truth guarantees.
- A sources/result display also receives ordinary model-tool search results.

New installations default to basic search, five results, English preference, generated answer off, images off, and an 8,000-character evidence budget. Existing prompt budgets, provider credentials and activation settings are preserved; the first-use free-plan migration described above resets only Tavily request options and automatic visit/image behavior. Selecting Extras from an old installation migrates to Tavily but disables automatic activation until you configure and enable it.

### Page reading

VisitLinks uses Tavily Extract when the selected provider is Tavily and the companion is available. It supports batches of up to 20 public URLs, Markdown/text, basic/advanced extraction, optional query-focused chunks and partial failures. The basic HTML reader remains available as a fallback. No extraction can guarantee access to paywalls/login-only pages.

### Map / Crawl and Data Bank

Explicit workbench actions discover URLs or extract a bounded set of pages. Defaults stay on the starting domain; depth, breadth and total page limits prevent unbounded exploration. Preview/select content before importing to the **current chat's Data Bank**, or download it. Imports do not edit characters or lorebooks.

Map discovers URLs only; use Extract selected to read those pages. Crawl discovers and reads pages. Both require a new confirmation before each run. Remote page content is shown as text, never executable HTML.

### Research

An explicit paid Tavily Research task can use mini, pro or auto, with report length and citation options. The workbench shows task status while polling, then the resulting report and sources. This is Tavily's research agent, not an unbounded loop of your chat model.

The task ID is saved in your user settings for explicit resume after closing/reloading the panel. The companion keeps ownership in memory for up to 24 hours: a server/plugin restart loses that ownership, so old IDs cannot be resumed through this plugin afterward. Check the Tavily dashboard if submission returned no ID or the server restarted.

**Stopping monitoring does not cancel the provider task or refund credits.** Submitting an expensive task requires confirmation. Research is not registered as an automatic LLM tool. No private chat history, character cards or attached files are automatically sent to Research—only the input you submit and selected request options.

### Reliability and privacy

- Session-scoped caches keyed by query + provider + options; no cross-account disk cache of results. Reloading clears caches.
- Tavily news/day searches are cached at most five minutes, other searches at most one hour, respecting a shorter configured cache lifetime.
- Bounded results, page limits, request timeouts and abort controls. Legacy page/image response streams are capped at 8 MiB each; assembled imports at 500,000 characters total.
- Automatic search captures chat/message identity and discards stale results after chat switches, edits or superseding requests. An already accepted file upload may finish unattached, but never attaches to a new chat.
- Model tool responses use a separate allowlisted projection bounded by the full serialized JSON character count (256–100,000; default 8,000), including citation metadata/errors. Richer UI image/usage metadata is not dumped into the model context.
- Paid POSTs are not automatically repeated after uncertain network failures.
- Authentication, quota and rate-limit failures are reported as failures, not successful empty searches.
- Website text is untrusted reference material. It must not override your system instructions or authorize unrelated tool calls.
- Public HTTP(S) URLs only for the enhanced operations; local addresses, credentials in URLs and onion addresses are rejected.

## Activation

Enable Web Search after selecting a provider and setting the needed credentials. Function tools need a compatible Chat Completion API with tool calling enabled. When function-tool mode is active it takes precedence over automatic text triggers.

The existing backtick, trigger-phrase and regex modes, /websearch slash command and Data Bank scraper remain available. Map/Crawl/Research always require separate explicit workbench actions.

## Cost awareness

Provider pricing can change. Current documentation lists basic/fast/ultra-fast Search at 1 credit, advanced Search at 2. Extract is billed per five successful URLs (basic 1 credit, advanced 2). Map is billed per ten returned pages, with extra cost for instructions; Crawl combines mapping and extraction.

Research is substantially more expensive: the documented range is **4–110 credits for mini** and **15–250 for pro**. Displayed figures are guidance, not a hard per-request spending cap. Enforce account/API-key limits through Tavily. No charge can be prevented merely by closing the browser or cancelling local polling.

## Development

Node 20+ for offline tests:

~~~sh
npm test
# Equivalent: node --experimental-vm-modules --test tests/*.test.mjs
node --check index.js
~~~

Tests mock the provider and never require an API key or use paid search credits. Do not test against a running personal installation without its owner's approval.

## References

- [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Extract API](https://docs.tavily.com/documentation/api-reference/endpoint/extract)
- [Map](https://docs.tavily.com/documentation/api-reference/endpoint/map) / [Crawl](https://docs.tavily.com/documentation/api-reference/endpoint/crawl)
- [Research](https://docs.tavily.com/documentation/api-reference/endpoint/research)
- [Credits and pricing](https://docs.tavily.com/documentation/api-credits)

## License

AGPL-3.0. Original extension by Cohee1207 and contributors. Enhancements maintained in xhlr8's fork. The upstream license is retained.
