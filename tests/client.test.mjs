import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicUrl, stableKey, normalizeSearch, budgetEvidence, createTavilyClient, TAVILY_DEFAULTS } from '../tavily-client.mjs';

const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const result = { results: [{ url: 'https://example.com/article', title: 'Example', content: 'Evidence '.repeat(300), score: 0.9 }], images: [{ url: 'https://example.com/image.png', description: 'Photo' }], usage: { credits: 1 }, request_id: 'r1' };
function fixture(handler, settings = structuredClone(TAVILY_DEFAULTS)) {
    const calls = []; let clock = 100;
    const api = createTavilyClient({ getHeaders: () => ({ 'content-type': 'application/json', 'X-CSRF-Token': 'test-token' }), getSettings: () => settings, now: () => clock, fetchImpl: async (path, init) => { calls.push({ path, init }); if (path.endsWith('/capabilities')) return reply({ operations: ['search', 'extract', 'map', 'crawl', 'research'], configured: true, policy: { expensive_enabled: true } }); return handler(path, init); } });
    return { api, calls, settings, advance: n => { clock += n; } };
}
test('public URLs reject local networks, credentials and script schemes', () => {
    for (const url of ['http://localhost', 'http://127.0.0.1', 'http://10.1.2.3', 'http://192.168.1.1', 'http://172.17.0.1', 'http://[::1]', 'http://foo.onion', 'http://user:pass@example.com', 'javascript:alert(1)', 'http://2130706433']) assert.equal(publicUrl(url), '', url);
    assert.equal(publicUrl('https://example.com'), 'https://example.com/');
});
test('cache key is stable but changes with provider options', () => {
    assert.equal(stableKey({ b: 2, a: 1 }), stableKey({ a: 1, b: 2 }));
    assert.notEqual(stableKey({ query: 'q', topic: 'news' }), stableKey({ query: 'q', topic: 'general' }));
});
test('structured sources retain identity, deduplicate URLs and normalize images', () => {
    const x = normalizeSearch({ ...result, results: [...result.results, ...result.results, { url: 'http://localhost' }] }, 'q');
    assert.equal(x.sources.length, 1); assert.equal(x.sources[0].score, 0.9); assert.equal(x.request_id, 'r1');
    assert.deepEqual(x.images, ['https://example.com/image.png']);
});
test('evidence budget bounds text and structured excerpts, retains sources before summary', () => {
    const data = normalizeSearch({ ...result, answer: 'Summary '.repeat(500), results: Array.from({ length: 5 }, (_, i) => ({ ...result.results[0], url: 'https://example.com/' + i, raw_content: 'Unbounded '.repeat(5000) })) }, 'q');
    for (const size of [256, 1000, 2000, 8000]) {
        const bounded = budgetEvidence(data, size);
        assert.ok(bounded.text.length <= size); assert.ok(bounded.sources.length > 0);
        for (const source of bounded.sources) { assert.ok(bounded.text.includes(source.url)); assert.equal(source.raw_content, undefined); }
    }
});
test('advanced search forwards parameters server-side and preserves CSRF', async () => {
    const f = fixture(async () => reply(result));
    const r = await f.api.search('test', { search_depth: 'advanced', max_results: 3 });
    const call = f.calls.at(-1); assert.equal(call.path, '/api/plugins/tavily-companion/search');
    const b = JSON.parse(call.init.body); assert.equal(b.search_depth, 'advanced'); assert.equal(b.max_results, 3); assert.equal(b.api_key, undefined);
    assert.equal(call.init.headers['X-CSRF-Token'], 'test-token'); assert.equal(r.mode, 'companion');
});
test('cache options and news TTL prevent stale cross-mode reuse', async () => {
    const f = fixture(async () => reply(result));
    assert.equal((await f.api.search('q')).cached, false);
    assert.equal((await f.api.search('q')).cached, true);
    assert.equal((await f.api.search('q', { topic: 'news' })).cached, false);
    f.advance(301000);
    assert.equal((await f.api.search('q', { topic: 'news' })).cached, false);
    assert.equal((await f.api.search('q')).cached, true);
    f.api.clearCache(); assert.equal((await f.api.search('q')).cached, false);
});
test('missing companion falls back explicitly to legacy search, not Extract', async () => {
    const calls = [];
    const api = createTavilyClient({ getHeaders: () => ({}), getSettings: () => TAVILY_DEFAULTS, fetchImpl: async (p, i) => { calls.push(p); return p.endsWith('capabilities') ? reply({}, 404) : reply(result); } });
    const r = await api.search('q'); assert.equal(r.mode, 'legacy'); assert.match(r.warning, /advanced settings are not applied/);
    assert.equal(calls.at(-1), '/api/search/tavily');
    await assert.rejects(api.extract(['https://example.com']), /companion/);
});
test('failed requests are not cached or blindly retried', async () => {
    const f = fixture(async () => reply({ error: { code: 'RATE_LIMIT', message: 'Wait', retry_after: 10 } }, 429));
    await assert.rejects(f.api.search('q'), e => e.status === 429 && e.retry_after === 10);
    assert.equal(f.calls.filter(c => c.path.endsWith('/search')).length, 1);
});
test('paid operation confirmation is sent and abort signal is not JSON serialized', async () => {
    const f = fixture(async () => reply({ results: [] }));
    await f.api.crawl('https://example.com', { confirmed: true, signal: new AbortController().signal });
    const body = JSON.parse(f.calls.at(-1).init.body); assert.equal(body.confirmed, true); assert.equal(body.allow_external, false); assert.equal(body.signal, undefined);
});
test('extension imports no removed Extras API and research is not an automatic LLM tool', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /doExtrasFetch|getApiUrl|WEBSEARCH_SOURCES\.EXTRAS/);
    assert.doesNotMatch(source, /name:\s*['"](?:Research|Crawl)['"]/);
    for (const provider of ['SERPAPI', 'PLUGIN', 'SEARXNG', 'TAVILY', 'KOBOLDCPP', 'SERPER', 'ZAI']) assert.ok(source.includes(provider));
    assert.ok(source.includes('mountTavilyPanel')); assert.ok(source.includes('getRequestHeaders'));
});

test('malformed successful JSON is not accepted as empty search', async () => {
    const f = fixture(async () => new Response('<html>bad gateway</html>', { status: 200 }));
    await assert.rejects(f.api.search('q'), /invalid response/);
});
test('ultra-fast removes incompatible options and news removes country', async () => {
    const f = fixture(async () => reply(result));
    await f.api.search('q', { search_depth: 'ultra-fast', safe_search: false, topic: 'news', country: 'canada' });
    const body = JSON.parse(f.calls.at(-1).init.body);
    assert.equal(body.chunks_per_source, undefined); assert.equal(body.safe_search, undefined); assert.equal(body.country, undefined);
});
test('every search including cache can update an evidence viewer without giving it control of search', async () => {
    const f = fixture(async () => reply(result)); const seen = [];
    const off = f.api.subscribeResults(r => seen.push(r));
    f.api.subscribeResults(() => { throw new Error('broken viewer'); });
    await f.api.search('q'); await f.api.search('q'); off(); await f.api.search('q');
    assert.equal(seen.length, 2); assert.equal(seen[1].cached, true);
});
test('raw-content request yields bounded raw evidence rather than discarding it', () => {
    const normalized = normalizeSearch({ results: [{ url: 'https://example.com', title: 'Page', content: 'Snippet', raw_content: 'Detailed article' }] }, 'q');
    const bounded = budgetEvidence(normalized, 2000);
    assert.equal(bounded.sources[0].content, 'Detailed article'); assert.equal(bounded.sources[0].raw_content, undefined);
});

test('free plan blocks paid discovery/research even with per-request confirmation until opt-in', async () => {
    let enabled = false; const calls = [];
    const api = createTavilyClient({ getHeaders: () => ({}), getSettings: () => structuredClone(TAVILY_DEFAULTS), fetchImpl: async (path, init) => {
        calls.push(path);
        if (path.endsWith('/capabilities')) return reply({ operations: ['search','map','crawl','research'], configured: true, policy: { expensive_enabled: enabled } });
        if (path.endsWith('/preferences')) { enabled = JSON.parse(init.body).expensive_enabled; return reply({ expensive_enabled: enabled }); }
        return reply({ request_id: 'task', status: 'pending', results: [] });
    } });
    await assert.rejects(api.createResearch('q', { confirmed: true }), e => e.code === 'EXPENSIVE_DISABLED');
    await assert.rejects(api.crawl('https://example.com', { confirmed: true }), e => e.code === 'EXPENSIVE_DISABLED');
    assert.ok(!calls.some(p => p.endsWith('/research') || p.endsWith('/crawl')));
    await api.setExpensiveEnabled(true);
    await api.createResearch('q', { confirmed: true });
    assert.equal(calls.filter(p => p.endsWith('/research')).length, 1);
    await api.setExpensiveEnabled(false);
    await assert.rejects(api.map('https://example.com', { confirmed: true }), e => e.code === 'EXPENSIVE_DISABLED');
});
test('free defaults pin basic search with no auto upgrade or generated answer', async () => {
    const f = fixture(async () => reply(result)); await f.api.search('q');
    const body = JSON.parse(f.calls.at(-1).init.body);
    assert.equal(body.search_depth, 'basic'); assert.equal(body.max_results, 5);
    assert.equal(body.auto_parameters, false); assert.equal(body.include_answer, false); assert.equal(body.include_raw_content, false);
    assert.equal(TAVILY_DEFAULTS.toolMaxUrls, 3);
});
test('saved extraction chunks cannot leak without a focus query', async () => {
    const settings = structuredClone(TAVILY_DEFAULTS); settings.extract.query = ''; settings.extract.chunks_per_source = 3;
    const f = fixture(async () => reply({ results: [] }), settings);
    await f.api.extract(['https://example.com']);
    const body = JSON.parse(f.calls.at(-1).init.body); assert.equal(body.query, undefined); assert.equal(body.chunks_per_source, undefined);
});

test('results from a previous chat do not update the current evidence viewer', async () => {
    let scope = 'chat-a', finish;
    const api = createTavilyClient({ getHeaders: () => ({}), getSettings: () => TAVILY_DEFAULTS, getScope: () => scope,
        fetchImpl: async path => path.endsWith('/capabilities') ? reply({operations:['search']}) : new Promise(resolve => {finish = resolve;}) });
    const seen = []; api.subscribeResults(r => seen.push(r));
    const pending = api.search('q');
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
    scope = 'chat-b'; finish(reply(result));
    await pending; assert.equal(seen.length, 0);
    api.clearResults(); assert.equal(seen[0].sources.length, 0);
});
test('server oversized response is rejected before body buffering', async () => {
    const f = fixture(async () => new Response('{}', {headers:{'content-length':String(9*1024*1024)}}));
    await assert.rejects(f.api.search('q'), e => e.code === 'RESPONSE_TOO_LARGE');
});
test('abort before paid request does not call search transport', async () => {
    const controller = new AbortController(); controller.abort(); let paid = 0;
    const f = fixture(async (_path, init) => { if(init.signal.aborted) throw new DOMException('Aborted','AbortError'); paid++; return reply(result); });
    await assert.rejects(f.api.search('q', {signal:controller.signal}), e => e.code === 'CANCELLED');
    assert.equal(paid, 0);
});
