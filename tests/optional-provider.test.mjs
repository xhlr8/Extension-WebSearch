import test from 'node:test';
import assert from 'node:assert/strict';
import { createKoboldSettingsReader } from '../optional-provider.mjs';

test('construction does not load optional Text Completion module', () => {
    let calls = 0;
    createKoboldSettingsReader(() => { calls++; throw new Error('missing module'); });
    assert.equal(calls, 0);
});
test('missing optional module fails gracefully and only loads once', async () => {
    let calls = 0;
    const getUrl = createKoboldSettingsReader(async () => { calls++; throw new Error('404'); });
    assert.equal(await getUrl(), null);
    assert.equal(await getUrl(), null);
    assert.equal(calls, 1);
});
test('standard SillyTavern reads current Kobold settings without caching the URL', async () => {
    const settings = { textgen_types: { KOBOLDCPP: 'koboldcpp' }, textgenerationwebui_settings: {server_urls: {koboldcpp: 'http://localhost:5001'}} };
    const getUrl = createKoboldSettingsReader(async () => settings);
    assert.equal(await getUrl(), 'http://localhost:5001');
    settings.textgenerationwebui_settings.server_urls.koboldcpp = 'http://localhost:5002';
    assert.equal(await getUrl(), 'http://localhost:5002');
});
test('missing optional exports or empty URL remain unavailable', async () => {
    for (const settings of [null, {}, {textgen_types:{KOBOLDCPP:'koboldcpp'}}, {textgen_types:{KOBOLDCPP:'koboldcpp'},textgenerationwebui_settings:{server_urls:{koboldcpp:''}}}]) {
        assert.equal(await createKoboldSettingsReader(async()=>settings)(), null);
    }
});
