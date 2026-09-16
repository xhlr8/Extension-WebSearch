# Validation

## Offline automated checks

- 110 frontend adapter, module-link, optional-provider, workbench DOM, deferred chat-race, response-size and serialized payload tests passed.
- A non-executing module-graph diagnostic reproduced the installed missing textgen-settings.js failure and linked the patched extension against 139 actual static modules served by the target SillyTavern fork.
- Companion repository: 44 authenticated API/validation/ownership tests passed.
- Separate development integration fixture linked the actual adapter and companion routes to a fake provider: Search, Extract, Map, Crawl, Research, default-off gate, polling after opt-out, cross-user denial.
- Browser mock preview exercised source rendering, Map -> Extract selected -> Import, Research -> polling -> report import, and explicit free-plan unlock. Provider markup was rendered as text.
- Mobile preview: 390px viewport, document width 390px (no horizontal overflow).
- node --check and git diff --check passed.

These checks used no live Tavily requests, real API keys, or running SillyTavern installation. Server mounting, actual user secret lookup, selected model tool-calling, provider behavior and live Data Bank persistence remain post-install acceptance checks.

## After explicitly installing

1. Confirm WebSearch settings load on the English-only/Extras-free fork.
2. Save a Tavily key through the existing key button; refresh capability (does not validate the key with Tavily).
3. Run one basic search intentionally; this consumes a credit. Verify citations, options and usage.
4. Check Map/Crawl/Research are disabled until user opt-in and per-request confirmation.
5. Test a small URL extraction/import only when desired; extraction can consume credits.
6. Do not test Research merely to check connectivity; even Mini can consume up to the documented 110 credits.

## Mock preview

Run node tests/preview-server.mjs and open http://127.0.0.1:4187. This serves only an isolated UI with fake responses; it does not contact SillyTavern or Tavily. Stop the fixture with Ctrl+C.
