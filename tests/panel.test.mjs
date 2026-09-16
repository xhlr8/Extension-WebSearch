import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSearchOptions, buildExtractOptions, buildTraversalOptions, buildResearchOptions, parsePathPatterns, boundedInteger,
    safeHttpUrl, parseUrls, parseDomains, resultDocuments, researchMarkdown,
    pollResearch, MAX_MONITOR_MS, mountTavilyPanel, parseResearchSchema,
} from '../tavily-panel.js';
import { makeDom, descendants, control, button, change, flush } from './panel-dom.mjs';

// Every API below is an in-memory stub. Tests never contact Tavily or SillyTavern.
// Most legacy workflow tests deliberately simulate an unlocked server; policy tests pass false.
function fixture(overrides = {}, settings = {}, expensiveEnabled = true) {
    const dom = makeDom();
    const calls = [];
    const imported = [];
    let saves = 0;
    const api = {
        capabilities: async force => { calls.push(['capabilities', force]); return { version: 1, configured: true, operations: ['search', 'extract', 'map', 'crawl', 'research', 'usage'], limits: { max_pages: 50 }, policy: { expensive_enabled: expensiveEnabled } }; },
        search: async (query, options) => { calls.push(['search', query, options]); return { sources: [{ id: 's1', title: '<script>title</script>', url: 'https://example.com/', content: '<img src=x onerror=alert(1)>', score: 0.9, published_date: '2026-01-01' }, { title: 'bad', url: 'javascript:alert(1)', content: 'bad' }], text: 'formatted', answer: '<script>answer</script>', request_id: 'search-1', usage: { credits: 1 }, cached: true }; },
        extract: async (urls, options) => { calls.push(['extract', urls, options]); return { results: urls.map(url => ({ url, raw_content: 'Extracted ' + url })), failed_results: [], request_id: 'extract-1', usage: { credits: 1 } }; },
        map: async (url, options) => { calls.push(['map', url, options]); return { results: ['https://example.com/a', 'https://example.com/b'], request_id: 'map-1' }; },
        crawl: async (url, options) => { calls.push(['crawl', url, options]); return { results: [{ url: 'https://example.com/a', raw_content: 'Crawled content' }], request_id: 'crawl-1' }; },
        createResearch: async (input, options) => { calls.push(['createResearch', input, options]); return { request_id: 'research-1', status: 'pending', model: options.model }; },
        getResearch: async (id, options) => { calls.push(['getResearch', id, options]); return { request_id: id, status: 'completed', content: '# Report\n<script>provider</script>', sources: [{ title: 'Citation', url: 'https://example.com/citation' }, { url: 'javascript:bad' }], usage: { credits: 4 } }; },
        forgetResearch: async id => { calls.push(['forgetResearch', id]); },
        usage: async options => { calls.push(['usage', options]); return { credits: 5 }; },
        setExpensiveEnabled: async enabled => { calls.push(['setExpensiveEnabled', enabled]); expensiveEnabled = enabled; return { expensive_enabled: enabled }; },
        ...overrides,
    };
    return { ...dom, settings, api, calls, imported, get saves() { return saves; }, async mount() {
        this.handle = await mountTavilyPanel({ container: dom.container, settings, api, onChange: () => { saves++; }, importDocuments: async rows => { imported.push(rows); } });
        return this.handle;
    } };
}

for (const depth of ['basic', 'advanced', 'fast', 'ultra-fast']) {
    test('search depth ' + depth + ' keeps typed options and conditional chunks', () => {
        const options = buildSearchOptions({ search_depth: depth });
        assert.equal(options.search_depth, depth);
        assert.equal(options.max_results, 5);
        assert.equal(options.include_answer, false);
        assert.equal(options.include_raw_content, false);
        assert.equal(options.include_usage, true);
        assert.equal(options.chunks_per_source, depth === 'ultra-fast' ? undefined : 3);
    });
}

test('search rejects invalid coercion and unsupported values', () => {
    for (const options of [
        { max_results: '5' }, { max_results: 0 }, { max_results: 21 }, { max_results: 2.5 },
        { include_answer: 'false' }, { include_raw_content: 'true' }, { safe_search: 'false' },
        { include_usage: 1 }, { chunks_per_source: 4 }, { search_depth: 'expensive' },
        { topic: 'other' }, { language: 'English' }, { include_domains_mode: 'maybe' },
        { country: 'US', topic: 'news' }, { include_domains: true },
    ]) assert.throws(() => buildSearchOptions(options));
    assert.equal(buildSearchOptions({ include_answer: 'advanced', include_raw_content: 'text' }).include_raw_content, 'text');
    assert.equal(buildSearchOptions({ include_image_descriptions: true, include_images: false }).include_image_descriptions, false);
});

test('dates and domains validate limits and do not mutate settings', () => {
    const settings = { start_date: '2024-02-29', end_date: '2024-03-01', include_domains: ['Example.com', 'example.com'], exclude_domains: 'other.com, third.org' };
    const before = structuredClone(settings);
    const result = buildSearchOptions(settings);
    assert.deepEqual(result.include_domains, ['example.com']);
    assert.deepEqual(result.exclude_domains, ['other.com', 'third.org']);
    assert.deepEqual(settings, before);
    assert.throws(() => buildSearchOptions({ start_date: '2025-02-29' }), /valid date/);
    assert.throws(() => buildSearchOptions({ start_date: '2026-02-01', end_date: '2026-01-01' }), /after/);
    assert.throws(() => buildSearchOptions({ start_date: '2026-02-01', time_range: 'week' }), /not both/);
    assert.throws(() => parseDomains('https://example.com', 300), /bare domains/);
    assert.throws(() => parseDomains('a.com,b.com', 1), /At most/);
    assert.deepEqual(parseDomains('', 300), []);
});

test('extraction and traversal hard bounds never allow external traversal', () => {
    assert.deepEqual(buildExtractOptions(), { extract_depth: 'basic', format: 'markdown', timeout: 30, include_usage: true });
    for (const value of ['30', false, 0, 61, NaN]) assert.throws(() => buildExtractOptions({ timeout: value }));
    assert.equal(buildTraversalOptions({ limit: 50, max_depth: 3, max_breadth: 20, allow_external: true }).allow_external, false);
    assert.throws(() => buildTraversalOptions({ limit: 51 }));
    assert.throws(() => buildTraversalOptions({ max_depth: 4 }));
    assert.throws(() => buildTraversalOptions({ max_breadth: 21 }));
    assert.throws(() => boundedInteger('', 1, 50));
});

test('URL helpers reject unsafe schemes, credentials and malformed links', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///x', '//example.com', '/relative', 'https://user:pass@example.com', '', null]) assert.equal(safeHttpUrl(url), null);
    assert.equal(safeHttpUrl(' https://example.com/path '), 'https://example.com/path');
    assert.deepEqual(parseUrls('https://example.com\nhttps://example.com/'), ['https://example.com/']);
    assert.throws(() => parseUrls(''), /at least/);
    assert.throws(() => parseUrls('https://a.com https://b.com', 1), /at most/);
    assert.throws(() => parseUrls('https://a.com javascript:bad'), /HTTP/);
});

test('normalization handles Map URLs and raw Crawl documents safely', () => {
    assert.equal(resultDocuments({ results: ['https://example.com/a', 'javascript:bad'] }).length, 1);
    assert.equal(resultDocuments({ results: [{ url: 'https://example.com/', raw_content: '<script>x</script>' }] })[0].content, '<script>x</script>');
    assert.deepEqual(resultDocuments({}), []);
});

test('Markdown report retains content and appends only validated citations', () => {
    const markdown = researchMarkdown({ content: '# Report', sources: [{ title: '[bad]\nnext', url: 'https://example.com/a(b)' }, { title: 'malicious', url: 'javascript:alert(1)' }] });
    assert.match(markdown, /^# Report/);
    assert.match(markdown, /## Sources/);
    assert.match(markdown, /<https:\/\/example.com\/a\(b\)>/);
    assert.doesNotMatch(markdown, /javascript:|malicious|\[bad\]/);
});

test('research polling returns terminal result with progressive status', async () => {
    const statuses = ['pending', 'in_progress', 'completed'];
    const seen = [];
    let calls = 0;
    const result = await pollResearch(async (id, { signal }) => {
        assert.equal(id, 'id-1');
        assert.ok(signal instanceof AbortSignal);
        return { status: statuses[calls++], content: 'partial' };
    }, 'id-1', { intervalMs: 0, timeoutMs: 1000, onUpdate: value => seen.push(value.status) });
    assert.equal(result.status, 'completed');
    assert.deepEqual(seen, statuses);
});

test('research polling rejects provider failure and bounded deadline', async () => {
    await assert.rejects(pollResearch(async () => ({ status: 'failed', error: 'quota' }), 'id'), /quota/);
    await assert.rejects(pollResearch(async () => new Promise(() => {}), 'id', { timeoutMs: 10 }), /time limit/);
    await assert.rejects(pollResearch(async () => ({}), 'id', { timeoutMs: MAX_MONITOR_MS + 1 }), /Monitoring duration/);
});

test('research polling aborts locally even if transport ignores signal', async () => {
    const controller = new AbortController();
    let requestSignal;
    const task = pollResearch(async (_, options) => { requestSignal = options.signal; return new Promise(() => {}); }, 'id', { signal: controller.signal });
    await flush();
    controller.abort();
    await assert.rejects(task, { name: 'AbortError' });
    assert.equal(requestSignal.aborted, true);
    let called = false;
    await assert.rejects(pollResearch(async () => { called = true; }, 'id', { signal: controller.signal }));
    assert.equal(called, false);
});

test('mount performs only capability discovery and preserves host settings', async t => {
    const settings = { reader: 'html', search: { unknown_host_option: 7 }, research: { request_id: 'previous-paid-task' } };
    const before = structuredClone(settings);
    const f = fixture({}, settings);
    await f.mount(); t.after(() => f.handle.destroy());
    assert.deepEqual(f.calls.map(call => call[0]), ['capabilities']);
    assert.deepEqual(settings, before);
    assert.equal(f.saves, 0);
    assert.equal(f.handle.element.tagName, 'DETAILS');
    assert.equal(f.handle.element.children[0].textContent, 'Tavily Plus');
    assert.match(f.container.textContent, /2,000-character/);
    const inputs = descendants(f.container).filter(node => ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName));
    for (const input of inputs) assert.ok(descendants(f.container).some(label => label.tagName === 'LABEL' && label.htmlFor === input.id));
    assert.equal(new Set(inputs.map(node => node.id)).size, inputs.length);
});

test('missing and unconfigured companions disable enhanced operations', async t => {
    const f = fixture({ capabilities: async () => { throw new Error('plugin not found'); } });
    await f.mount(); t.after(() => f.handle.destroy());
    assert.match(f.container.textContent, /plugin not found/);
    assert.ok(descendants(f.container).some(node => node.href === 'https://github.com/xhlr8/SillyTavern-Tavily-Companion'));
    for (const name of ['Run search', 'Extract URLs', 'Run Map / Crawl', 'Start research', 'Resume monitoring', 'Refresh usage']) assert.equal(button(f.container, name).disabled, true);
    assert.equal(control(f.container, 'Search depth').effectivelyDisabled(), true);
    assert.equal(button(f.container, 'Refresh capability').disabled, false);
    f.api.capabilities = async () => ({ version: 1, configured: false, operations: ['search'] });
    await f.handle.refreshCapabilities();
    assert.equal(button(f.container, 'Run search').disabled, true);
    f.api.capabilities = async () => ({ version: 1, configured: true, operations: ['search'] });
    await f.handle.refreshCapabilities();
    assert.equal(button(f.container, 'Run search').disabled, false);
    assert.equal(button(f.container, 'Start research').disabled, true);
});

test('settings edits preserve boolean/string choices and presets', async t => {
    const f = fixture(); await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Include answer'), 'false');
    change(control(f.container, 'Include raw content'), 'markdown');
    change(control(f.container, 'Safe search'), true);
    assert.equal(f.settings.search.include_answer, false);
    assert.equal(f.settings.search.include_raw_content, 'markdown');
    assert.equal(f.settings.search.safe_search, true);
    change(control(f.container, 'Search preset'), 'detailed');
    assert.equal(f.settings.search.search_depth, 'advanced');
    assert.equal(control(f.container, 'Chunks per source').disabled, false);
    change(control(f.container, 'Max results'), 12);
    assert.equal(f.settings.search.max_results, 12);
    assert.equal(control(f.container, 'Search preset').value, 'custom');
    change(control(f.container, 'Max results'), 21);
    assert.equal(f.settings.search.max_results, 12);
    assert.match(control(f.container, 'Max results').validationMessage, /1 to 20/);
    change(control(f.container, 'Search preset'), 'news');
    assert.equal(f.settings.search.topic, 'news');
    assert.equal(f.settings.search.time_range, 'week');
    change(control(f.container, 'Use Tavily companion enhancements'), false);
    assert.equal(button(f.container, 'Run search').disabled, true);
    assert.ok(f.saves > 0);
});

test('search renders provider markup as text and validates every source link', async t => {
    const f = fixture(); await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Search query'), 'a query');
    button(f.container, 'Run search').click(); await flush();
    assert.equal(f.calls.filter(call => call[0] === 'search').length, 1);
    const request = f.calls.find(call => call[0] === 'search');
    assert.equal(request[2].include_answer, false);
    assert.ok(request[2].signal instanceof AbortSignal);
    assert.match(f.container.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.match(f.container.textContent, /Cached/);
    assert.match(f.container.textContent, /Request: search-1/);
    assert.match(f.container.textContent, /Usage \/ cost/);
    for (const anchor of descendants(f.container).filter(node => node.tagName === 'A')) {
        assert.ok(safeHttpUrl(anchor.href));
        assert.equal(anchor.rel, 'noopener noreferrer');
    }
    assert.equal(descendants(f.container).filter(node => ['IMG', 'SCRIPT', 'IFRAME'].includes(node.tagName)).length, 0);
});

test('usage and read URLs are user-triggered and extraction honors settings', async t => {
    const f = fixture({}, { extract: { format: 'text', timeout: 15 } });
    await f.mount(); t.after(() => f.handle.destroy());
    button(f.container, 'Refresh usage').click(); await flush();
    change(control(f.container, 'URLs to read (one per line)'), 'https://example.com/');
    button(f.container, 'Extract URLs').click(); await flush();
    const request = f.calls.find(call => call[0] === 'extract');
    assert.deepEqual(request[1], ['https://example.com/']);
    assert.equal(request[2].format, 'text');
    assert.equal(request[2].timeout, 15);
    assert.match(f.container.textContent, /Extraction complete: 1/);
});

test('Map confirmation resets per request, selected URLs extract then import', async t => {
    const f = fixture(); await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Website URL'), 'https://example.com');
    button(f.container, 'Run Map / Crawl').click(); await flush();
    assert.equal(f.calls.some(call => call[0] === 'map'), false);
    change(control(f.container, 'I confirm this Map / Crawl request may spend credits'), true);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    const request = f.calls.find(call => call[0] === 'map');
    assert.equal(request[2].confirmed, true);
    assert.equal(request[2].allow_external, false);
    assert.equal(request[2].limit, 10);
    assert.equal(control(f.container, 'I confirm this Map / Crawl request may spend credits').checked, false);
    assert.equal(button(f.container, 'Import selected to Data Bank').disabled, true);
    change(control(f.container, 'Select https://example.com/a'), true);
    button(f.container, 'Extract selected').click(); await flush();
    assert.deepEqual(f.calls.find(call => call[0] === 'extract')[1], ['https://example.com/a']);
    button(f.container, 'Import selected to Data Bank').click(); await flush();
    assert.deepEqual(f.imported[0], [{ title: 'https://example.com/a', url: 'https://example.com/a', content: 'Extracted https://example.com/a' }]);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    assert.equal(f.calls.filter(call => call[0] === 'map').length, 1);
});

test('Crawl imports only selected content and limits invalid pages', async t => {
    const f = fixture(); await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Discovery method'), 'crawl');
    change(control(f.container, 'Website URL'), 'https://example.com');
    change(control(f.container, 'Page cap'), 51);
    change(control(f.container, 'I confirm this Map / Crawl request may spend credits'), true);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    assert.equal(f.calls.some(call => call[0] === 'crawl'), false);
    change(control(f.container, 'Page cap'), 50);
    assert.equal(control(f.container, 'I confirm this Map / Crawl request may spend credits').checked, false);
    change(control(f.container, 'I confirm this Map / Crawl request may spend credits'), true);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    assert.equal(f.calls.find(call => call[0] === 'crawl')[2].limit, 50);
    change(control(f.container, 'Select https://example.com/a'), true);
    button(f.container, 'Import selected to Data Bank').click(); await flush();
    assert.equal(f.imported[0][0].content, 'Crawled content');
});

test('research requires per-submit consent, polls, downloads and imports citations', async t => {
    const f = fixture(); await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Research question / instructions'), 'Explain a topic');
    change(control(f.container, 'Research mode'), 'mini');
    change(control(f.container, 'Report length'), 'short');
    button(f.container, 'Start research').click(); await flush();
    assert.equal(f.calls.some(call => call[0] === 'createResearch'), false);
    change(control(f.container, 'I confirm this research submission may spend credits'), true);
    button(f.container, 'Start research').click(); await flush();
    assert.equal(f.settings.research.request_id, 'research-1');
    const request = f.calls.find(call => call[0] === 'createResearch');
    assert.equal(request[2].confirmed, true);
    assert.equal(request[2].model, 'mini');
    assert.equal(request[2].output_length, 'short');
    assert.equal(control(f.container, 'I confirm this research submission may spend credits').checked, false);
    assert.match(f.container.textContent, /<script>provider<\/script>/);
    button(f.container, 'Import report to Data Bank').click(); await flush();
    assert.match(f.imported[0][0].content, /## Sources/);
    assert.match(f.imported[0][0].content, /https:\/\/example.com\/citation/);
    button(f.container, 'Download Markdown').click(); await flush();
    assert.equal(f.blobs.length, 1);
    assert.match(await f.blobs[0].text(), /## Sources/);
    assert.equal(f.document.downloads[0].download, 'tavily-research-research-1.md');
    button(f.container, 'Start research').click(); await flush();
    assert.equal(f.calls.filter(call => call[0] === 'createResearch').length, 1);
    f.handle.destroy();
    assert.deepEqual(f.revoked, ['blob:offline-1']);
});

test('stop monitoring warns about ongoing provider charges without forgetting task', async t => {
    let signal;
    const f = fixture({ getResearch: async (_, options) => { signal = options.signal; return new Promise(() => {}); } });
    await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Research request ID (resume explicitly)'), 'existing-id');
    button(f.container, 'Resume monitoring').click(); await flush();
    assert.equal(button(f.container, 'Stop monitoring').disabled, false);
    button(f.container, 'Stop monitoring').click(); await flush();
    assert.equal(signal.aborted, true);
    assert.match(f.container.textContent, /provider may continue running and charging/);
    assert.equal(f.settings.research.request_id, 'existing-id');
    assert.equal(f.calls.some(call => ['forgetResearch', 'createResearch'].includes(call[0])), false);
    button(f.container, 'Forget saved request').click(); await flush();
    assert.equal(f.settings.research.request_id, '');
    assert.equal(f.calls.some(call => call[0] === 'forgetResearch'), true);
});

test('domain mode, country and safe search match companion options', () => {
    assert.equal(buildSearchOptions().include_domains_mode, undefined);
    assert.equal(buildSearchOptions({ include_domains: ['example.com'], include_domains_mode: 'filter' }).include_domains_mode, 'filter');
    assert.equal(buildSearchOptions({ country: 'canada' }).country, 'canada');
    assert.throws(() => buildSearchOptions({ country: 'USA' }));
    assert.throws(() => buildSearchOptions({ include_domains: ['sub.example.com'], exclude_domains: ['example.com'] }), /excluded/);
    assert.equal(buildSearchOptions({ search_depth: 'fast', safe_search: true }).safe_search, undefined);
    assert.throws(() => buildTraversalOptions({ instructions: 'x'.repeat(4001) }), /4,000/);
});

test('selected Map extraction batches at 20 and retains all selected documents', async t => {
    const urls = Array.from({ length: 21 }, (_, index) => 'https://example.com/page-' + index);
    const f = fixture({ map: async () => ({ results: urls }) }, { traversal: { limit: 50 } });
    await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Website URL'), 'https://example.com');
    change(control(f.container, 'I confirm this Map / Crawl request may spend credits'), true);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    for (const url of urls) change(control(f.container, 'Select ' + url), true);
    button(f.container, 'Extract selected').click(); await flush(); await flush();
    assert.deepEqual(f.calls.filter(call => call[0] === 'extract').map(call => call[1].length), [20, 1]);
    button(f.container, 'Import selected to Data Bank').click(); await flush();
    assert.equal(f.imported[0].length, 21);
});

test('missing importer is explained and disabled without breaking workbench', async () => {
    const f = fixture();
    const handle = await mountTavilyPanel({ container: f.container, settings: f.settings, api: f.api });
    try {
        assert.equal(button(f.container, 'Import selected to Data Bank').disabled, true);
        assert.equal(button(f.container, 'Import report to Data Bank').disabled, true);
        assert.match(f.container.textContent, /host did not provide an importDocuments callback/);
    } finally { handle.destroy(); }
});

test('new monitoring disables stale report download until completion', async t => {
    const f = fixture(); await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Research request ID (resume explicitly)'), 'completed-id');
    button(f.container, 'Resume monitoring').click(); await flush();
    assert.equal(button(f.container, 'Download Markdown').disabled, false);
    f.api.getResearch = async () => new Promise(() => {});
    change(control(f.container, 'Research request ID (resume explicitly)'), 'pending-id');
    button(f.container, 'Resume monitoring').click(); await flush();
    assert.equal(button(f.container, 'Download Markdown').disabled, true);
    assert.equal(button(f.container, 'Import report to Data Bank').disabled, true);
    button(f.container, 'Stop monitoring').click(); await flush();
    assert.equal(button(f.container, 'Download Markdown').disabled, true);
});

test('subscription renders tool and cached evidence safely without requests or settings edits', async () => {
    let callback;
    let disposed = 0;
    const f = fixture({ subscribeResults: listener => { callback = listener; return () => { disposed++; }; } });
    await f.mount();
    const panel = f.handle.element;
    const before = structuredClone(f.settings);
    try {
        assert.equal(typeof callback, 'function');
        callback({ query: 'tool query', sources: [{ title: '<script>tool title</script>', url: 'https://example.com/tool', content: '<img src=x onerror=alert(1)>' }, { url: 'javascript:bad' }], request_id: 'tool-result', usage: { credits: 1 }, cached: false });
        assert.match(panel.textContent, /Query: tool query/);
        assert.match(panel.textContent, /<script>tool title<\/script>/);
        assert.match(panel.textContent, /Request: tool-result/);
        callback({ query: 'automatic query', sources: [{ title: 'Cached evidence', url: 'https://example.com/cache', content: 'from cache' }], cached: true, request_id: 'cached-result' });
        assert.match(panel.textContent, /Cached evidence/);
        assert.match(panel.textContent, /Cached/);
        assert.doesNotMatch(panel.textContent, /tool-result/);
        assert.deepEqual(f.calls.map(call => call[0]), ['capabilities']);
        assert.deepEqual(f.settings, before);
        assert.equal(f.saves, 0);
        assert.equal(f.imported.length, 0);
        assert.equal(descendants(panel).filter(node => ['IMG', 'SCRIPT', 'IFRAME'].includes(node.tagName)).length, 0);
        const snapshot = panel.textContent;
        f.handle.destroy();
        f.handle.destroy();
        assert.equal(disposed, 1);
        callback({ sources: [{ title: 'late result', url: 'https://example.com/late' }] });
        assert.equal(panel.textContent, snapshot);
    } finally { f.handle.destroy(); }
});

test('subscription handles immediate replay and unsubscribes old instance on remount', async () => {
    const callbacks = [];
    let disposed = 0;
    const f = fixture({ subscribeResults: callback => {
        callbacks.push(callback);
        callback({ query: 'replay', sources: [], cached: true });
        return () => { disposed++; };
    } });
    await f.mount();
    const previous = f.handle;
    assert.match(previous.element.textContent, /Query: replay/);
    await f.mount();
    assert.equal(disposed, 1);
    callbacks[0]({ query: 'stale', sources: [] });
    assert.doesNotMatch(f.container.textContent, /Query: stale/);
    callbacks[1]({ query: 'current', sources: [] });
    assert.match(f.container.textContent, /Query: current/);
    f.handle.destroy();
    assert.equal(disposed, 2);
});

test('workbench response and subscription replace evidence without duplicate cards', async t => {
    let callback;
    const result = { query: 'workbench', request_id: 'shared', sources: [{ title: 'Shared source', url: 'https://example.com/shared', content: 'evidence' }] };
    const f = fixture({
        subscribeResults: listener => { callback = listener; return () => {}; },
        search: async () => { callback(structuredClone(result)); return result; },
    });
    await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Search query'), 'workbench');
    button(f.container, 'Run search').click(); await flush();
    assert.equal(descendants(f.container).filter(node => node.className === 'tp-source').length, 1);
    assert.match(f.container.textContent, /Query: workbench/);
});

test('subscription setup or disposer failure does not break workbench cleanup', async () => {
    const f = fixture({ subscribeResults: () => { throw new Error('subscriber unavailable'); } });
    await f.mount();
    assert.match(f.container.textContent, /Search result updates unavailable/);
    assert.equal(button(f.container, 'Run search').disabled, false);
    f.handle.destroy();
    const g = fixture({ subscribeResults: () => () => { throw new Error('dispose failed'); } });
    await g.mount();
    assert.doesNotThrow(() => g.handle.destroy());
    assert.equal(g.container.children.length, 0);
});

test('optional research schema accepts bounded object subset and blank omission', () => {
    assert.equal(parseResearchSchema('  '), undefined);
    const schema = { type: 'object', properties: {
        summary: { type: 'string', description: 'Brief summary' },
        facts: { type: 'array', description: 'Facts', items: { type: 'object', properties: { claim: { type: 'string', description: 'Claim' } }, required: ['claim'] } },
    }, required: ['summary', 'facts'] };
    assert.deepEqual(parseResearchSchema(JSON.stringify(schema)), schema);
    for (const value of ['{', 'null', '[]', '{}', '{"type":"string"}', '{"properties":{"x":{"type":"boolean","description":"flag"}}}', '{"properties":{"x":{"type":"string"}}}', '{"properties":{"x":{"type":"string","description":"x","enum":["x"]}}}', '{"properties":{"constructor":{"type":"string","description":"x"}}}', '{"properties":{"x":{"type":"string","description":"x"}},"required":["missing"]}', '{"properties":{"x":{"type":"string","description":"x"}},"required":["x","x"]}']) {
        assert.throws(() => parseResearchSchema(value), undefined, value);
    }
    assert.throws(() => parseResearchSchema(' '.repeat(16384) + '{}'), /16 KiB/);
    assert.throws(() => parseResearchSchema(JSON.stringify({ properties: { x: { type: 'string', description: '界'.repeat(6000) } } })), /16 KiB/);
    let deep = { type: 'string', description: 'leaf' };
    for (let i = 0; i < 10; i++) deep = { type: 'array', description: 'level', items: deep };
    assert.throws(() => parseResearchSchema(JSON.stringify({ properties: { deep } })), /nesting/);
});

test('research schema JSON is validated before paid call and sent as an object', async t => {
    const f = fixture(); await f.mount(); t.after(() => f.handle.destroy());
    const schemaInput = control(f.container, 'Research output schema (optional JSON)');
    const confirmation = control(f.container, 'I confirm this research submission may spend credits');
    change(control(f.container, 'Research question / instructions'), 'Research topic');
    change(schemaInput, '{broken');
    change(confirmation, true);
    button(f.container, 'Start research').click(); await flush();
    assert.equal(f.calls.some(call => call[0] === 'createResearch'), false);
    assert.match(schemaInput.validationMessage, /valid JSON/);
    const schema = { properties: { summary: { type: 'string', description: 'Summary' } }, required: ['summary'] };
    change(schemaInput, JSON.stringify(schema));
    assert.equal(confirmation.checked, false);
    assert.deepEqual(f.settings.research.output_schema, schema);
    change(confirmation, true);
    button(f.container, 'Start research').click(); await flush();
    const first = f.calls.find(call => call[0] === 'createResearch');
    assert.deepEqual(first[2].output_schema, schema);
    assert.equal(first[2].confirmed, true);
    assert.equal(confirmation.checked, false);
    assert.match(f.container.textContent, /async status polling/);
    assert.match(f.container.textContent, /not token streaming/);
    change(schemaInput, '');
    assert.equal(Object.hasOwn(f.settings.research, 'output_schema'), false);
    change(confirmation, true);
    button(f.container, 'Start research').click(); await flush();
    const calls = f.calls.filter(call => call[0] === 'createResearch');
    assert.equal(calls.length, 2);
    assert.equal(Object.hasOwn(calls[1][2], 'output_schema'), false);
});

test('changed paid inputs revoke consent and persisted confirmed flags never authorize calls', async t => {
    const f = fixture({}, { traversal: { confirmed: true }, research: { confirmed: true } });
    await f.mount(); t.after(() => f.handle.destroy());
    const mapConfirm = control(f.container, 'I confirm this Map / Crawl request may spend credits');
    const researchConfirm = control(f.container, 'I confirm this research submission may spend credits');
    assert.equal(mapConfirm.checked, false);
    assert.equal(researchConfirm.checked, false);
    button(f.container, 'Run Map / Crawl').click();
    button(f.container, 'Start research').click(); await flush();
    assert.deepEqual(f.calls.map(call => call[0]), ['capabilities']);
    change(control(f.container, 'Website URL'), 'https://example.com');
    change(mapConfirm, true);
    change(control(f.container, 'Depth'), 2);
    assert.equal(mapConfirm.checked, false);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    assert.equal(f.calls.some(call => call[0] === 'map'), false);
    change(mapConfirm, true);
    change(control(f.container, 'Extraction depth'), 'advanced');
    assert.equal(mapConfirm.checked, false);
    change(control(f.container, 'Research question / instructions'), 'Research topic');
    change(researchConfirm, true);
    change(control(f.container, 'Research mode'), 'pro');
    assert.equal(researchConfirm.checked, false);
    button(f.container, 'Start research').click(); await flush();
    assert.equal(f.calls.some(call => call[0] === 'createResearch'), false);
    assert.match(f.container.textContent, /default 8,000/);
});

test('search published-date controls enforce dependencies and strict boolean types', async t => {
    assert.throws(() => buildSearchOptions({ filter_by_published_date: true }), /date/);
    assert.throws(() => buildSearchOptions({ filter_by_published_date: true, time_range: 'week', include_published_date: false }), /Include published dates/);
    for (const key of ['exact_match', 'include_published_date', 'filter_by_published_date']) assert.throws(() => buildSearchOptions({ [key]: 'false' }));
    const f = fixture(); await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Search query'), 'quoted topic');
    change(control(f.container, 'Exact-match search'), true);
    change(control(f.container, 'Filter by published date'), true);
    button(f.container, 'Run search').click(); await flush();
    assert.equal(f.calls.some(call => call[0] === 'search'), false);
    change(control(f.container, 'Relative date range'), 'week');
    button(f.container, 'Run search').click(); await flush();
    const options = f.calls.find(call => call[0] === 'search')[2];
    assert.equal(options.exact_match, true);
    assert.equal(options.filter_by_published_date, true);
    assert.equal(options.include_published_date, true);
    for (const depth of ['basic', 'fast', 'advanced', 'ultra-fast']) {
        change(control(f.container, 'Search depth'), depth);
        assert.equal(control(f.container, 'Chunks per source').disabled, depth === 'ultra-fast');
    }
});

test('explicit capability refresh bypasses adapter cache without paid APIs', async () => {
    const f = fixture(); await f.mount();
    try {
        assert.deepEqual(f.calls, [['capabilities', false]]);
        button(f.container, 'Refresh capability').click(); await flush();
        assert.deepEqual(f.calls, [['capabilities', false], ['capabilities', true]]);
        await f.handle.refreshCapabilities();
        assert.deepEqual(f.calls[2], ['capabilities', true]);
        assert.equal(f.calls.some(call => call[0] !== 'capabilities'), false);
    } finally { f.handle.destroy(); }
});

test('path regex filters preserve raw lines, reject invalid syntax and strip UI fields', () => {
    assert.deepEqual(parsePathPatterns('^/docs/\n^/blog/[0-9]{1,4}$'), ['^/docs/', '^/blog/[0-9]{1,4}$']);
    assert.deepEqual(parsePathPatterns(''), []);
    assert.throws(() => parsePathPatterns('['), /Invalid path regex/);
    assert.throws(() => parsePathPatterns(['x'.repeat(501)]), /1–500/);
    assert.throws(() => parsePathPatterns(Array.from({ length: 51 }, (_, i) => '^/p' + i)), /50/);
    assert.throws(() => parsePathPatterns(false));
    const options = buildTraversalOptions({ method: 'map', depth: 'bad-ui-depth', max_depth: 2, instructions: ' Find docs ', select_paths: '^/docs/', exclude_paths: ['^/private/'], confirmed: false, output_schema: {} });
    assert.deepEqual(options, { limit: 10, max_depth: 2, max_breadth: 10, allow_external: false, instructions: 'Find docs', select_paths: ['^/docs/'], exclude_paths: ['^/private/'] });
});

test('Map DOM workflow sends only allowed traversal keys and resets consent on path edits', async t => {
    const f = fixture({}, { traversal: { method: 'map', depth: 'UI only', select_paths: ['^/docs/', '^/news/'] } });
    await f.mount(); t.after(() => f.handle.destroy());
    assert.equal(control(f.container, 'Select path regexes').value, '^/docs/\n^/news/');
    change(control(f.container, 'Website URL'), 'https://example.com');
    change(control(f.container, 'Discovery instructions (optional)'), 'Find public docs');
    change(control(f.container, 'I confirm this Map / Crawl request may spend credits'), true);
    change(control(f.container, 'Exclude path regexes'), '^/private/');
    assert.equal(control(f.container, 'I confirm this Map / Crawl request may spend credits').checked, false);
    change(control(f.container, 'I confirm this Map / Crawl request may spend credits'), true);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    const options = f.calls.find(call => call[0] === 'map')[2];
    assert.deepEqual(Object.keys(options).sort(), ['allow_external', 'confirmed', 'exclude_paths', 'instructions', 'limit', 'max_breadth', 'max_depth', 'select_paths', 'signal'].sort());
    assert.equal(options.instructions, 'Find public docs');
    assert.deepEqual(options.select_paths, ['^/docs/', '^/news/']);
    assert.deepEqual(options.exclude_paths, ['^/private/']);
    assert.equal(options.confirmed, true);
    assert.equal(control(f.container, 'I confirm this Map / Crawl request may spend credits').checked, false);
});

test('research builder bounds domains, validates citation choices and excludes UI metadata', () => {
    for (const citation_format of ['numbered', 'mla', 'apa', 'chicago']) assert.equal(buildResearchOptions({ citation_format }).citation_format, citation_format);
    assert.throws(() => buildResearchOptions({ citation_format: 'raw-html' }));
    assert.throws(() => buildResearchOptions({ include_domains: Array.from({ length: 21 }, (_, i) => 'site' + i + '.com') }), /20/);
    assert.throws(() => buildResearchOptions({ include_domains: ['docs.example.com'], exclude_domains: ['example.com'] }), /excluded/);
    assert.deepEqual(buildResearchOptions({ request_id: 'saved', confirmed: true, include_domains: ['EXAMPLE.com'], exclude_domains: ['other.com'] }), { model: 'mini', output_length: 'standard', citation_format: 'numbered', include_domains: ['example.com'], exclude_domains: ['other.com'] });
});

test('research advanced controls pass citations/domains and final polling preserves safe sources', async t => {
    let finishPoll;
    const f = fixture({ getResearch: async () => new Promise(resolve => { finishPoll = resolve; }) });
    await f.mount(); t.after(() => f.handle.destroy());
    change(control(f.container, 'Research question / instructions'), 'Investigate topic');
    change(control(f.container, 'Research citation format'), 'apa');
    change(control(f.container, 'Research include domains'), 'example.com');
    change(control(f.container, 'Research exclude domains'), 'other.com');
    change(control(f.container, 'I confirm this research submission may spend credits'), true);
    button(f.container, 'Start research').click(); await flush();
    const options = f.calls.find(call => call[0] === 'createResearch')[2];
    assert.equal(options.citation_format, 'apa');
    assert.deepEqual(options.include_domains, ['example.com']);
    assert.deepEqual(options.exclude_domains, ['other.com']);
    assert.equal(Object.hasOwn(options, 'request_id'), false);
    assert.equal(button(f.container, 'Start research').disabled, true);
    assert.equal(button(f.container, 'Stop monitoring').disabled, false);
    assert.equal(button(f.container, 'Download Markdown').disabled, true);
    finishPoll({ request_id: 'research-1', status: 'completed', content: '<script>safe text report</script>', sources: [{ title: '<img>citation', url: 'https://example.com/evidence' }, { title: 'unsafe', url: 'javascript:bad' }] });
    await flush();
    assert.equal(button(f.container, 'Start research').disabled, false);
    assert.equal(button(f.container, 'Stop monitoring').disabled, true);
    assert.equal(button(f.container, 'Download Markdown').disabled, false);
    assert.match(f.container.textContent, /<script>safe text report<\/script>/);
    const citation = descendants(f.container).find(node => node.tagName === 'A' && node.href === 'https://example.com/evidence');
    assert.ok(citation);
    assert.equal(citation.rel, 'noopener noreferrer');
    assert.equal(descendants(f.container).some(node => node.tagName === 'A' && node.href === 'javascript:bad'), false);
    button(f.container, 'Start research').click(); await flush();
    assert.equal(f.calls.filter(call => call[0] === 'createResearch').length, 1);
});

test('search prefers image_details descriptions and deduplicates legacy image URLs', async t => {
    let publish;
    const f = fixture({ subscribeResults: callback => { publish = callback; return () => {}; } });
    await f.mount(); t.after(() => f.handle.destroy());
    publish({ sources: [{ url: 'https://example.com/source', title: 'Source', score: 0.95 }], image_details: [{ url: 'https://example.com/pic.png', description: '<img onerror=alert(1)> image description' }, { url: 'javascript:bad', description: 'unsafe' }], images: ['https://example.com/pic.png', 'https://example.com/legacy.png'] });
    assert.match(f.container.textContent, /Relevance score 0.95/);
    const imageLinks = descendants(f.container).filter(node => node.tagName === 'A' && node.href === 'https://example.com/pic.png');
    assert.equal(imageLinks.length, 1);
    assert.equal(imageLinks[0].textContent, '<img onerror=alert(1)> image description');
    assert.equal(imageLinks[0].rel, 'noopener noreferrer');
    assert.ok(descendants(f.container).some(node => node.tagName === 'A' && node.href === 'https://example.com/legacy.png'));
    assert.equal(descendants(f.container).some(node => ['IMG', 'SCRIPT'].includes(node.tagName)), false);
    publish({ sources: [], images: ['https://example.com/only-legacy.png'] });
    assert.ok(descendants(f.container).some(node => node.tagName === 'A' && node.href === 'https://example.com/only-legacy.png'));
});

test('Research defaults to Mini without overwriting existing explicit choice', async () => {
    assert.equal(buildResearchOptions().model, 'mini');
    const f = fixture(); await f.mount();
    try {
        assert.equal(control(f.container, 'Research mode').value, 'mini');
        assert.deepEqual(f.settings, {});
        change(control(f.container, 'Research question / instructions'), 'Investigate conservatively');
        change(control(f.container, 'I confirm this research submission may spend credits'), true);
        button(f.container, 'Start research').click(); await flush();
        assert.equal(f.calls.find(call => call[0] === 'createResearch')[2].model, 'mini');
    } finally { f.handle.destroy(); }
    const g = fixture({}, { research: { model: 'auto' } }); await g.mount();
    try { assert.equal(control(g.container, 'Research mode').value, 'auto'); }
    finally { g.handle.destroy(); }
});

test('extraction focus validates text and typed chunks only when query is set', () => {
    assert.deepEqual(buildExtractOptions({ query: '  ', chunks_per_source: 5 }), buildExtractOptions());
    assert.equal(buildExtractOptions({ query: ' facts ' }).query, 'facts');
    assert.equal(buildExtractOptions({ query: 'facts' }).chunks_per_source, 3);
    for (const chunks of [1, 5]) assert.equal(buildExtractOptions({ query: 'facts', chunks_per_source: chunks }).chunks_per_source, chunks);
    for (const chunks of [0, 6, '3', false, 1.5]) assert.throws(() => buildExtractOptions({ query: 'facts', chunks_per_source: chunks }));
    for (const query of [false, 123, 'x'.repeat(4001), 'bad\u0000query']) assert.throws(() => buildExtractOptions({ query }));
});

test('Read URLs focus toggles chunks and clearing query omits both payload keys', async t => {
    const f = fixture(); await f.mount(); t.after(() => f.handle.destroy());
    const focus = control(f.container, 'Extraction focus query (optional)');
    const chunks = control(f.container, 'Extraction chunks per source');
    assert.equal(chunks.disabled, true);
    change(control(f.container, 'URLs to read (one per line)'), 'https://example.com/');
    change(focus, 'find facts');
    assert.equal(chunks.disabled, false);
    change(chunks, 5);
    button(f.container, 'Extract URLs').click(); await flush();
    const first = f.calls.find(call => call[0] === 'extract')[2];
    assert.equal(first.query, 'find facts');
    assert.equal(first.chunks_per_source, 5);
    change(focus, '');
    assert.equal(chunks.disabled, true);
    button(f.container, 'Extract URLs').click(); await flush();
    const requests = f.calls.filter(call => call[0] === 'extract');
    assert.equal(requests.length, 2);
    assert.equal(Object.hasOwn(requests[1][2], 'query'), false);
    assert.equal(Object.hasOwn(requests[1][2], 'chunks_per_source'), false);
});

test('selected URL extraction shares focus but Crawl does not receive extract query fields', async t => {
    const f = fixture({}, { extract: { query: 'focus topic', chunks_per_source: 4 } });
    await f.mount(); t.after(() => f.handle.destroy());
    assert.equal(control(f.container, 'Extraction chunks per source').disabled, false);
    change(control(f.container, 'Website URL'), 'https://example.com/');
    change(control(f.container, 'I confirm this Map / Crawl request may spend credits'), true);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    change(control(f.container, 'Select https://example.com/a'), true);
    button(f.container, 'Extract selected').click(); await flush();
    const extraction = f.calls.find(call => call[0] === 'extract')[2];
    assert.equal(extraction.query, 'focus topic');
    assert.equal(extraction.chunks_per_source, 4);
    change(control(f.container, 'Discovery method'), 'crawl');
    change(control(f.container, 'I confirm this Map / Crawl request may spend credits'), true);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    const crawl = f.calls.find(call => call[0] === 'crawl')[2];
    assert.equal(Object.hasOwn(crawl, 'query'), false);
    assert.equal(Object.hasOwn(crawl, 'chunks_per_source'), false);
});

test('missing or false session policy defaults expensive creation off despite stale UI preferences', async () => {
    for (const policy of [undefined, {}, { expensive_enabled: false }, { expensive_enabled: 'true' }]) {
        const settings = { expensive_enabled: true, policy: { expensive_enabled: true }, traversal: { confirmed: true }, research: { confirmed: true, request_id: 'existing-id' } };
        const before = structuredClone(settings);
        const f = fixture({ capabilities: async () => ({ version: 1, configured: true, operations: ['search', 'extract', 'map', 'crawl', 'research', 'usage'], ...(policy === undefined ? {} : { policy }) }) }, settings);
        await f.mount();
        try {
            assert.equal(control(f.container, 'Enable Map/Crawl and Research for this session').checked, false);
            for (const name of ['Run Map / Crawl', 'Start research']) assert.equal(button(f.container, name).disabled, true);
            assert.equal(control(f.container, 'Website URL').effectivelyDisabled(), true);
            assert.equal(control(f.container, 'Research question / instructions').effectivelyDisabled(), true);
            assert.equal(control(f.container, 'Research request ID (resume explicitly)').effectivelyDisabled(), false);
            assert.equal(button(f.container, 'Resume monitoring').disabled, false);
            assert.equal(button(f.container, 'Forget saved request').disabled, false);
            assert.equal(button(f.container, 'Run search').disabled, false);
            assert.equal(button(f.container, 'Extract URLs').disabled, false);
            button(f.container, 'Run Map / Crawl').click(); button(f.container, 'Start research').click(); await flush();
            assert.deepEqual(f.calls, []);
            assert.deepEqual(settings, before);
            assert.equal(f.saves, 0);
            assert.match(f.container.textContent, /1,000 free monthly credits/);
            assert.match(f.container.textContent, /Basic search uses 1 credit; advanced search uses 2/);
        } finally { f.handle.destroy(); }
    }
});

test('session checkbox only changes server preference then force-refreshes and never persists consent', async () => {
    const f = fixture({}, { expensive_enabled: true }, false); await f.mount();
    try {
        const unlock = control(f.container, 'Enable Map/Crawl and Research for this session');
        assert.equal(unlock.checked, false);
        assert.equal(unlock.disabled, false); // setExpensiveEnabled is not an advertised operation.
        change(unlock, true);
        assert.equal(button(f.container, 'Start research').disabled, true);
        await flush();
        assert.deepEqual(f.calls, [['capabilities', false], ['setExpensiveEnabled', true], ['capabilities', true]]);
        assert.equal(unlock.checked, true);
        assert.equal(button(f.container, 'Run Map / Crawl').disabled, false);
        assert.equal(button(f.container, 'Start research').disabled, false);
        assert.equal(control(f.container, 'I confirm this Map / Crawl request may spend credits').checked, false);
        assert.equal(control(f.container, 'I confirm this research submission may spend credits').checked, false);
        assert.deepEqual(f.settings, { expensive_enabled: true });
        assert.equal(f.saves, 0);
        change(control(f.container, 'I confirm this research submission may spend credits'), true);
        change(unlock, false); await flush();
        assert.equal(unlock.checked, false);
        assert.equal(button(f.container, 'Start research').disabled, true);
        assert.equal(control(f.container, 'I confirm this research submission may spend credits').checked, false);
        assert.deepEqual(f.calls.slice(-2), [['setExpensiveEnabled', false], ['capabilities', true]]);
        assert.equal(f.calls.some(call => ['map', 'crawl', 'createResearch'].includes(call[0])), false);
        assert.equal(f.saves, 0);
    } finally { f.handle.destroy(); }
});

test('unlock still requires fresh per-run consent and cannot survive restarted server policy', async () => {
    const f = fixture({}, {}, false); await f.mount();
    change(control(f.container, 'Enable Map/Crawl and Research for this session'), true); await flush();
    change(control(f.container, 'Website URL'), 'https://example.com');
    button(f.container, 'Run Map / Crawl').click(); await flush();
    assert.equal(f.calls.some(call => call[0] === 'map'), false);
    change(control(f.container, 'I confirm this Map / Crawl request may spend credits'), true);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    assert.equal(f.calls.filter(call => call[0] === 'map').length, 1);
    button(f.container, 'Run Map / Crawl').click(); await flush();
    assert.equal(f.calls.filter(call => call[0] === 'map').length, 1);
    const settings = structuredClone(f.settings); f.handle.destroy();
    const restarted = fixture({}, settings, false); await restarted.mount();
    try {
        assert.equal(control(restarted.container, 'Enable Map/Crawl and Research for this session').checked, false);
        assert.equal(button(restarted.container, 'Run Map / Crawl').disabled, true);
        assert.equal(button(restarted.container, 'Start research').disabled, true);
    } finally { restarted.handle.destroy(); }
});

test('disabling new research permits polling and forgetting existing tasks', async () => {
    let finish;
    let signal;
    const f = fixture({ getResearch: async (_, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); } }, { research: { request_id: 'existing-id' } });
    await f.mount();
    try {
        button(f.container, 'Resume monitoring').click(); await flush();
        assert.equal(signal.aborted, false);
        change(control(f.container, 'Enable Map/Crawl and Research for this session'), false); await flush();
        assert.equal(signal.aborted, false);
        assert.equal(button(f.container, 'Start research').disabled, true);
        finish({ request_id: 'existing-id', status: 'completed', content: 'Existing report', sources: [] }); await flush();
        assert.equal(button(f.container, 'Resume monitoring').disabled, false);
        assert.equal(button(f.container, 'Download Markdown').disabled, false);
        button(f.container, 'Forget saved request').click(); await flush();
        assert.equal(f.calls.some(call => call[0] === 'forgetResearch'), true);
        assert.equal(f.calls.some(call => call[0] === 'createResearch'), false);
    } finally { f.handle.destroy(); }
});

test('failed unlock and unverified capability response remain locked', async () => {
    const f = fixture({ setExpensiveEnabled: async () => { throw new Error('preference unavailable'); } }, {}, false);
    await f.mount();
    try {
        change(control(f.container, 'Enable Map/Crawl and Research for this session'), true); await flush();
        assert.equal(button(f.container, 'Start research').disabled, true);
        assert.equal(control(f.container, 'Enable Map/Crawl and Research for this session').checked, false);
        assert.match(f.container.textContent, /preference unavailable/);
    } finally { f.handle.destroy(); }
    const g = fixture({ setExpensiveEnabled: async () => ({ expensive_enabled: true }) }, {}, false);
    await g.mount();
    try {
        change(control(g.container, 'Enable Map/Crawl and Research for this session'), true); await flush();
        assert.equal(button(g.container, 'Start research').disabled, true); // Setter result is not authority.
        assert.equal(control(g.container, 'Enable Map/Crawl and Research for this session').checked, false);
    } finally { g.handle.destroy(); }
});

test('free-plan preset restores low-credit search/extract settings without unlocking or scraping', async () => {
    const f = fixture({}, { search: { search_depth: 'advanced', max_results: 20, auto_parameters: true, include_answer: 'advanced', include_raw_content: 'markdown', include_images: true, include_image_descriptions: true }, extract: { extract_depth: 'advanced', format: 'text', query: 'focus' }, visit_enabled: false }, false);
    await f.mount();
    try {
        change(control(f.container, 'Search preset'), 'free');
        const search = f.settings.search;
        assert.equal(search.search_depth, 'basic');
        assert.equal(search.max_results, 5);
        for (const key of ['auto_parameters', 'include_answer', 'include_raw_content', 'include_images', 'include_image_descriptions']) assert.equal(search[key], false);
        assert.equal(f.settings.extract.extract_depth, 'basic');
        assert.equal(control(f.container, 'Extraction depth').value, 'basic');
        assert.equal(f.settings.extract.format, 'text');
        assert.equal(f.settings.visit_enabled, false);
        assert.equal(control(f.container, 'Enable Map/Crawl and Research for this session').checked, false);
        assert.equal(button(f.container, 'Run Map / Crawl').disabled, true);
        assert.deepEqual(f.calls, [['capabilities', false]]);
        assert.equal(f.saves, 1);
    } finally { f.handle.destroy(); }
});

test('model URL-read limit defaults to three and saves only bounded integers', async () => {
    const f = fixture({}, {}, false); await f.mount();
    try {
        const limit = control(f.container, 'Model URL-read limit');
        assert.equal(limit.value, '3');
        assert.equal(limit.min, '1'); assert.equal(limit.max, '20');
        assert.equal(f.saves, 0); assert.deepEqual(f.settings, {});
        change(limit, 1); assert.equal(f.settings.toolMaxUrls, 1);
        change(limit, 20); assert.equal(f.settings.toolMaxUrls, 20);
        const saved = f.saves;
        for (const invalid of ['', 0, 21, 2.5, 'not-a-number']) {
            change(limit, invalid);
            assert.equal(f.settings.toolMaxUrls, 20);
            assert.equal(f.saves, saved);
            assert.ok(limit.validationMessage);
        }
        change(limit, 4);
        assert.equal(typeof f.settings.toolMaxUrls, 'number');
        assert.equal(f.settings.toolMaxUrls, 4);
        assert.deepEqual(f.calls, [['capabilities', false]]);
        assert.equal(button(f.container, 'Start research').disabled, true);
    } finally { f.handle.destroy(); }
});

test('model read limit preserves manual twenty-URL batches and migrated settings', async () => {
    const settings = { toolMaxUrls: 1, freePlanDefaultsApplied: true, visit_enabled: false, search: { max_results: 7 }, extract: { extract_depth: 'advanced' } };
    const before = structuredClone(settings);
    const f = fixture({}, settings, false); await f.mount();
    try {
        assert.equal(control(f.container, 'Model URL-read limit').value, '1');
        assert.deepEqual(settings, before);
        const urls = Array.from({ length: 20 }, (_, index) => 'https://example.com/page-' + index);
        change(control(f.container, 'URLs to read (one per line)'), urls.join('\n'));
        button(f.container, 'Extract URLs').click(); await flush();
        assert.equal(f.calls.find(call => call[0] === 'extract')[1].length, 20);
        assert.equal(settings.toolMaxUrls, 1);
        assert.equal(settings.visit_enabled, false);
        assert.equal(settings.freePlanDefaultsApplied, true);
        assert.equal(f.saves, 0);
    } finally { f.handle.destroy(); }
});

test('destroy aborts pending work and remount removes only its own panel', async () => {
    let signal;
    let resolveSearch;
    const f = fixture({ search: async (_, options) => { signal = options.signal; return new Promise(resolve => { resolveSearch = resolve; }); } });
    const existing = f.document.createElement('p'); existing.textContent = 'Host UI'; f.container.append(existing);
    await f.mount();
    const first = f.handle;
    change(control(f.container, 'Search query'), 'pending');
    button(f.container, 'Run search').click(); await flush();
    await f.mount();
    assert.equal(signal.aborted, true);
    assert.equal(first.element.parentNode, null);
    assert.equal(existing.parentNode, f.container);
    resolveSearch({ sources: [] }); await flush();
    assert.doesNotMatch(f.container.textContent, /Search complete/);
    f.handle.destroy();
    assert.equal(f.container.textContent, 'Host UI');
});
