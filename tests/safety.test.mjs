import test from 'node:test';
import assert from 'node:assert/strict';
import { projectToolResult, readResponseBounded, responseBlobBounded } from '../web-safety.mjs';

const normalize = budget => Math.max(256, Math.min(100000, Number(budget) || 8000));
const bounded = (input, budget = 8000) => {
    const result = projectToolResult(input, budget);
    const serialized = JSON.stringify(result);
    assert.ok(serialized.length <= normalize(budget), serialized.length + ' > ' + normalize(budget));
    assert.equal(typeof result.text, 'string');
    assert.match(result.text, /untrusted.*not instructions/);
    assert.ok(Array.isArray(result.sources));
    assert.ok(Array.isArray(result.failed_results));
    assert.equal(typeof result.truncated, 'boolean');
    assert.deepEqual(JSON.parse(serialized), result);
    for (const source of result.sources) {
        assert.equal(typeof source.title, 'string');
        assert.ok(source.title.length <= 180);
        assert.match(source.url, /^https?:\/\//);
        assert.equal(source.content, undefined);
        assert.equal(source.raw_content, undefined);
    }
    return result;
};
const source = (content = 'A short supported fact.', extra = {}) => ({ id: 1, title: 'Example', url: 'https://example.com/article', content, ...extra });
const errorCode = code => error => {
    assert.equal(error.code, code);
    assert.ok(error.message.length < 100);
    assert.doesNotMatch(error.message, /private-secret/);
    assert.equal(error.cause, undefined);
    return true;
};

// The suite never calls fetch or a live service. Responses and streams are local.
test('complete rich evidence preserves titles, URLs and IDs without duplicate excerpts', () => {
    const text = '[1] A short supported fact.';
    const input = { text, sources: [source()], request_id: 'request-1', failed_results: [], skipped_urls: [] };
    const before = structuredClone(input);
    const result = bounded(input);
    assert.equal(result.truncated, false);
    assert.equal(result.sources[0].title, 'Example');
    assert.equal(result.sources[0].url, 'https://example.com/article');
    assert.equal(result.sources[0].id, 1);
    assert.equal(result.request_id, 'request-1');
    assert.equal(JSON.stringify(result).split('A short supported fact.').length - 1, 1);
    assert.deepEqual(input, before);
    assert.deepEqual(projectToolResult(input), result);
});

test('rich source-only and legacy inputs get the same envelope and citation headers', () => {
    const legacy = bounded([{ link: 'https://example.com/legacy', text: 'Legacy evidence.' }]);
    const rich = bounded({ sources: [source()] });
    assert.deepEqual(Object.keys(legacy), Object.keys(rich));
    assert.match(legacy.text, /\[1\] Legacy evidence\./);
    assert.equal(legacy.sources[0].url, 'https://example.com/legacy');
    assert.equal(legacy.truncated, false);
    assert.equal(rich.truncated, false);
    assert.match(bounded({ sources: [source(undefined, { content: undefined, raw_content: 'Raw evidence' })] }).text, /Raw evidence/);
});

test('massive sources, images, metadata and failure strings cannot escape whole-object budgets', () => {
    const huge = 'private-secret'.repeat(80000);
    const images = Array.from({ length: 20 }, (_, i) => ({ url: 'https://example.com/image/' + i, description: 'x'.repeat(1000), metadata: huge }));
    const input = {
        text: 'Evidence '.repeat(150000),
        sources: Array.from({ length: 20 }, (_, i) => source(huge, { id: i + 1, url: 'https://example.com/' + i,
            title: huge, published_date: huge, score: Infinity, images, raw_content: huge, metadata: { huge } })),
        images, image_details: images, usage: { data: huge }, request_id: huge,
        failed_results: Array.from({ length: 2000 }, () => ({ url: 'https://example.com/failed', error: huge, raw: huge })),
        skipped_urls: Array(10000).fill('https://example.com/skipped'),
    };
    for (const budget of [256, 1000, 8000]) {
        const result = bounded(input, budget);
        assert.equal(result.truncated, true);
        assert.ok(result.sources.length > 0);
        assert.ok(result.failed_results.length <= 4);
        assert.ok(result.failed_results.every(item => item.message.length <= 160));
        for (const key of ['images', 'image_details', 'usage', 'raw_content', 'metadata']) assert.equal(result[key], undefined);
        for (const s of result.sources) assert.deepEqual(Object.keys(s).filter(key => !['id', 'title', 'url', 'published_date', 'score'].includes(key)), []);
    }
    assert.equal(bounded({ failed_results: huge }, 256).truncated, true);
});

test('million-character quotes, slashes, controls and Unicode use serialized length', () => {
    const escaped = ('"\\\n\t\u0000\u001f漢字🙂\ud800x\udc00').repeat(100000);
    for (const budget of [256, 257, 1000, 8000, 99999, 100000]) {
        for (const input of [{ text: escaped, sources: [source(escaped)] }, { sources: [source(escaped)] }, [{ link: 'https://example.com/', text: escaped }]]) {
            assert.equal(bounded(input, budget).truncated, true);
        }
    }
});

test('generated mixed escape cases stay bounded deterministically across tiny budgets', () => {
    let seed = 123456789;
    const random = n => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % n; };
    const chars = ['a', '"', '\\', '\n', '\u0000', '🙂', '漢', '\ud800', '\udc00'];
    for (let i = 0; i < 250; i++) {
        const text = Array.from({ length: 10 + random(600) }, () => chars[random(chars.length)]).join('');
        const input = { text: i % 2 ? text : '', sources: Array.from({ length: random(10) }, (_, n) => source(text, { id: n + 1, title: text, url: 'https://example.com/' + n })),
            request_id: text, failed_results: [text], skipped_urls: ['https://example.com/skipped'] };
        const budget = 256 + random(2000);
        assert.deepEqual(bounded(input, budget), projectToolResult(input, budget));
    }
});

test('budget normalization clamps zero, negative, fractional, infinite and string values', () => {
    const input = { text: 'x'.repeat(200000) };
    for (const budget of [undefined, null, 0, -5, 1, 255, 256.8, 1000, '1000', 'bad', '', NaN, Infinity, -Infinity, 1000000, true, false]) {
        const result = bounded(input, budget);
        assert.equal(result.truncated, true);
    }
});

test('tiny budgets retain a traceable whole URL and title whenever they fit', () => {
    for (const url of ['https://example.com/article', 'https://example.com/' + 'x'.repeat(60)]) {
        const result = bounded({ sources: [source('evidence '.repeat(10000), { url, title: 'Title' })] }, 256);
        assert.equal(result.sources.length, 1);
        assert.equal(result.sources[0].url, url);
        assert.equal(result.sources[0].title, 'Title');
        assert.equal(result.truncated, true);
    }
});

test('URL policy rejects unsafe protocols, credentials and local/reserved network forms', () => {
    const unsafe = ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/x', '//example.com/x',
        'http://localhost', 'http://localhost.', 'http://127.0.0.1', 'http://2130706433', 'http://0x7f000001',
        'http://10.0.0.1', 'http://172.16.0.1', 'http://192.168.1.1', 'http://169.254.1.1', 'http://100.64.0.1',
        'http://224.0.0.1', 'http://198.18.0.1', 'http://203.0.113.1', 'http://[::1]', 'http://[::ffff:127.0.0.1]',
        'http://foo.internal', 'http://foo.local', 'http://foo.onion', 'http://foo.localhost',
        'https://user:secret@example.com', 'https://example.com:444', 'https://exam\nple.com/',
        'https://example.com/' + 'a'.repeat(2100)];
    for (const url of unsafe) {
        const result = bounded({ sources: [source('Do not expose this unsupported evidence.', { url })],
            failed_results: [{ url, message: 'Failed' }], skipped_urls: [url] });
        assert.deepEqual(result.sources, [], url);
        assert.equal(result.failed_results[0].url, undefined, url);
        assert.equal(result.skipped_urls, undefined, url);
        assert.equal(result.truncated, true, url);
    }
    for (const url of ['https://example.com/a?q=1#citation', 'http://8.8.8.8/', 'https://例え.jp/', 'https://example.com:443/']) {
        assert.equal(bounded({ sources: [source('Fact', { url })] }).sources[0].url, new URL(url).href);
    }
});

test('malicious objects and arrays are not stringified or coerced as metadata', () => {
    const poison = { toString() { throw new Error('coercion'); }, valueOf() { throw new Error('coercion'); }, toJSON() { throw new Error('serialization'); } };
    poison.circular = poison;
    const input = { text: poison, request_id: poison, usage: poison, images: poison,
        sources: [source(poison, { id: poison, title: poison, published_date: [poison], score: poison, images: poison })],
        failed_results: [{ message: poison, url: poison }], skipped_urls: [poison] };
    const result = bounded(input, 8000);
    assert.equal(result.request_id, undefined);
    assert.equal(result.sources[0].score, undefined);
    assert.equal(result.sources[0].published_date, undefined);
    assert.equal(result.truncated, true);
    assert.ok(JSON.stringify(projectToolResult(input, poison)).length <= 8000);
});

test('request IDs, source IDs, dates and scores have narrow bounds', () => {
    const result = bounded({ request_id: 'r'.repeat(1000), sources: [source('Fact', {
        id: 1e100, published_date: 'd'.repeat(1000000), score: -10,
    })] });
    assert.equal(result.request_id.length, 80);
    assert.equal(result.sources[0].id, 1000000);
    assert.equal(result.sources[0].published_date.length, 40);
    assert.equal(result.sources[0].score, 0);
    assert.equal(result.truncated, true);
    assert.equal(bounded({ sources: [source('Fact', { score: 10 })] }).sources[0].score, 1);
});

test('truncation is truthful for complete, clipped, skipped and upstream-truncated inputs', () => {
    for (const input of [{}, { text: 'Fact' }, { sources: [source()] }, { failed_results: ['Failure'] }]) assert.equal(bounded(input).truncated, false);
    for (const input of [
        { text: 'x'.repeat(10000) }, { truncated: true }, { sources: [source('Fact', { truncated: true })] },
        { sources: [source('Fact', { title: 'x'.repeat(181) })] }, { sources: [source('Fact', { url: 'file:///x' })] },
        { sources: [source('missing source evidence')], text: 'A different summary' },
        { failed_results: Array(5).fill('Failed') },
    ]) assert.equal(bounded(input).truncated, true);
});

test('source and diagnostics arrays are capped without reading their unbounded tails', () => {
    const sources = Array.from({ length: 32 }, (_, i) => source('Fact', { id: i + 1, url: 'https://example.com/' + i }));
    Object.defineProperty(sources, 32, { get() { throw new Error('unbounded source traversal'); } });
    sources.length = 1000000;
    const failed_results = Array(4).fill('Failure');
    Object.defineProperty(failed_results, 4, { get() { throw new Error('unbounded diagnostics traversal'); } });
    failed_results.length = 1000000;
    const result = bounded({ sources, failed_results }, 100000);
    assert.equal(result.sources.length, 32);
    assert.equal(result.failed_results.length, 4);
    assert.equal(result.truncated, true);
});

function fixture(chunks = [], headers = {}) {
    const stats = { acquired: 0, reads: 0, cancelled: 0, released: 0, bodyCancelled: 0 };
    const reader = {
        async read() { stats.reads++; return chunks.length ? { done: false, value: chunks.shift() } : { done: true }; },
        cancel() { stats.cancelled++; return Promise.resolve(); },
        releaseLock() { stats.released++; },
    };
    const response = { headers: new Headers(headers), body: {
        getReader() { stats.acquired++; return reader; },
        cancel() { stats.bodyCancelled++; return Promise.resolve(); },
    } };
    return { response, reader, stats };
}

test('unknown-length chunks read exactly to the byte limit and release the lock', async () => {
    const { response, stats } = fixture([new Uint8Array([1, 2]), new Uint8Array(0), new Uint8Array([3, 4])]);
    const bytes = await readResponseBounded(response, { maxBytes: 4 });
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual([...bytes], [1, 2, 3, 4]);
    assert.equal(stats.reads, 4);
    assert.equal(stats.released, 1);
    assert.equal(stats.cancelled, 0);
});

test('unknown or underreported lengths reject before collecting an oversized chunk or reading more', async () => {
    for (const headers of [{}, { 'content-length': '1' }, { 'content-length': 'invalid' }]) {
        const { response, stats } = fixture([new Uint8Array([1]), new Uint8Array(1000000), new Uint8Array([3])], headers);
        await assert.rejects(readResponseBounded(response, { maxBytes: 2 }), errorCode('RESPONSE_TOO_LARGE'));
        assert.equal(stats.reads, 2);
        assert.equal(stats.cancelled, 1);
        assert.equal(stats.released, 1);
    }
});

test('huge Content-Length rejects without acquiring a reader or reading the body', async () => {
    for (const length of ['8388609', '9'.repeat(1000), '000000100000000']) {
        const { response, stats } = fixture([], { 'content-length': length });
        await assert.rejects(readResponseBounded(response), errorCode('RESPONSE_TOO_LARGE'));
        assert.equal(stats.acquired, 0);
        assert.equal(stats.reads, 0);
        assert.equal(stats.bodyCancelled, 1);
    }
});

test('already-aborted signals cancel without reading and do not leak abort reason', async () => {
    const { response, stats } = fixture([new Uint8Array([1])]);
    const controller = new AbortController(); controller.abort('private-secret');
    await assert.rejects(readResponseBounded(response, { signal: controller.signal }), errorCode('CANCELLED'));
    assert.equal(stats.acquired, 0);
    assert.equal(stats.reads, 0);
    assert.equal(stats.bodyCancelled, 1);
});

test('abort races a permanently hung reader and cancellation without waiting for either', { timeout: 1000 }, async () => {
    const { response, reader, stats } = fixture();
    reader.read = () => { stats.reads++; return new Promise(() => {}); };
    reader.cancel = () => { stats.cancelled++; return new Promise(() => {}); };
    const controller = new AbortController();
    const reading = readResponseBounded(response, { signal: controller.signal });
    const rejection = assert.rejects(reading, errorCode('CANCELLED'));
    controller.abort(new Error('private-secret'));
    await rejection;
    assert.equal(stats.reads, 1);
    assert.equal(stats.cancelled, 1);
    assert.equal(stats.released, 1);
});

test('abort during native stream read cancels and unlocks the response', { timeout: 1000 }, async () => {
    let cancelled = 0;
    const response = new Response(new ReadableStream({ pull() {}, cancel() { cancelled++; } }));
    const controller = new AbortController();
    const reading = readResponseBounded(response, { signal: controller.signal });
    const rejection = assert.rejects(reading, errorCode('CANCELLED'));
    controller.abort(); await rejection;
    assert.equal(cancelled, 1);
    assert.equal(response.body.locked, false);
});

test('abort listeners are removed on success and stream errors, which leak no content', async () => {
    for (const fail of [false, true]) {
        const { response, reader, stats } = fixture([new Uint8Array([1])]);
        if (fail) reader.read = () => Promise.reject(new Error('private-secret'.repeat(10000)));
        const controller = new AbortController();
        const listeners = new Set();
        const signal = {
            get aborted() { return controller.signal.aborted; },
            addEventListener(type, fn, options) { listeners.add(fn); controller.signal.addEventListener(type, fn, options); },
            removeEventListener(type, fn) { listeners.delete(fn); controller.signal.removeEventListener(type, fn); },
        };
        if (fail) await assert.rejects(readResponseBounded(response, { signal }), errorCode('RESPONSE_READ_FAILED'));
        else assert.deepEqual([...(await readResponseBounded(response, { signal }))], [1]);
        assert.equal(listeners.size, 0);
        assert.equal(stats.released, 1);
        assert.equal(stats.cancelled, fail ? 1 : 0);
    }
});

test('native fetch AbortError is normalized even without an explicit signal', async () => {
    const { response, reader, stats } = fixture();
    reader.read = () => Promise.reject(new DOMException('private-secret', 'AbortError'));
    await assert.rejects(readResponseBounded(response), errorCode('CANCELLED'));
    assert.equal(stats.cancelled, 1);
    assert.equal(stats.released, 1);
});

test('cleanup failures never replace bounded size/cancellation errors', async () => {
    const { response, reader } = fixture([new Uint8Array(10)]);
    reader.cancel = () => Promise.reject(new Error('private-secret'));
    reader.releaseLock = () => { throw new Error('private-secret'); };
    await assert.rejects(readResponseBounded(response, { maxBytes: 1 }), errorCode('RESPONSE_TOO_LARGE'));
});

test('null and empty native response bodies return zero bytes and unlock', async () => {
    assert.deepEqual(await readResponseBounded(new Response(null)), new Uint8Array(0));
    const empty = new Response(new ReadableStream({ start(controller) { controller.close(); } }));
    assert.deepEqual(await readResponseBounded(empty), new Uint8Array(0));
    assert.equal(empty.body.locked, false);
    const bytes = await readResponseBounded(new Response('é🙂'), { maxBytes: 6 });
    assert.equal(bytes.byteLength, 6);
    await assert.rejects(readResponseBounded(new Response('é🙂'), { maxBytes: 5 }), errorCode('RESPONSE_TOO_LARGE'));
});

test('invalid byte limits are rejected and unsupported body types never fall back to blob', async () => {
    for (const maxBytes of [0, -1, NaN, Infinity, -Infinity, '100', null, {}]) {
        const { response, stats } = fixture();
        await assert.rejects(readResponseBounded(response, { maxBytes }), /positive finite/);
        assert.equal(stats.acquired, 0);
    }
    const response = { headers: new Headers(), body: {}, blob() { throw new Error('unbounded fallback'); } };
    await assert.rejects(readResponseBounded(response), errorCode('RESPONSE_READ_FAILED'));
    await assert.rejects(readResponseBounded(fixture(['not bytes']).response), errorCode('RESPONSE_READ_FAILED'));
    assert.equal((await readResponseBounded(new Response(null), { maxBytes: 0.5 })).byteLength, 0);
    await assert.rejects(readResponseBounded(new Response('x'), { maxBytes: 0.5 }), errorCode('RESPONSE_TOO_LARGE'));
});

test('stream accumulation handles chunk views and many tiny chunks without retaining backing buffers', async () => {
    let index = 0;
    const backing = new Uint8Array(4096);
    const response = new Response(new ReadableStream({
        pull(controller) {
            if (index === 20000) { controller.close(); return; }
            backing[5] = index++ % 251;
            controller.enqueue(backing.subarray(5, 6));
        },
    }, { highWaterMark: 0 }));
    const bytes = await readResponseBounded(response, { maxBytes: 20000 });
    assert.equal(bytes.length, 20000);
    for (let i = 0; i < bytes.length; i++) assert.equal(bytes[i], i % 251);
    assert.equal(response.body.locked, false);
});

test('Blob uses bounded bytes and a sanitized MIME type without parameters', async () => {
    const blob = await responseBlobBounded(new Response('hello', { headers: { 'content-type': 'Text/HTML; charset=utf-8' } }), { maxBytes: 5 });
    assert.ok(blob instanceof Blob);
    assert.equal(blob.type, 'text/html');
    assert.equal(blob.size, 5);
    assert.equal(await blob.text(), 'hello');
    for (const value of [null, 'x'.repeat(1000), 'text/html\r\nX-Evil: yes', 'text/🙂', 'not a type']) {
        const { response } = fixture();
        response.headers = { get: key => key === 'content-type' ? value : null };
        assert.equal((await responseBlobBounded(response)).type, 'application/octet-stream');
    }
    await assert.rejects(responseBlobBounded(new Response('too large'), { maxBytes: 1 }), errorCode('RESPONSE_TOO_LARGE'));
});
