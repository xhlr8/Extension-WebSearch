import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

// Execute top-level extension initialization only; jQuery's ready callback is held,
// so no requests, settings mutations, DOM changes or chat operations are performed.
test('extension links and registers its generation hook without removed Extras APIs', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const callbacks = [];
    const globals = {
        console, URL, Map, Set, AbortSignal, AbortController, structuredClone, TextEncoder,
        window: {}, document: {},
        SillyTavern: { getContext: () => ({}) },
        jQuery: fn => callbacks.push(fn),
    };
    const context = createContext(globals);
    const imports = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)];
    const stubs = new Map();
    for (const [, names, specifier] of imports) {
        assert.notEqual(specifier, '../../../textgen-settings.js', 'Optional Text Completion module must not be a static import');
        if (specifier.startsWith('./')) continue;
        const keys = names.split(',').map(x => x.trim()).filter(Boolean);
        // Validate fixture also excludes APIs this fork intentionally removed.
        assert.ok(!keys.some(k => ['doExtrasFetch', 'getApiUrl', 'modules'].includes(k)));
        const values = Object.fromEntries(keys.map(k => [k,
            k === 'extension_settings' ? {} : k === 'extension_prompt_types' ? { IN_PROMPT: 0 } : k === 'SECRET_KEYS' || k === 'secret_state' ? {} : () => {},
        ]));
        stubs.set(specifier, new SyntheticModule(keys, function () { for (const key of keys) this.setExport(key, values[key]); }, { context }));
    }
    const files = new Map();
    async function local(specifier) {
        if (files.has(specifier)) return files.get(specifier);
        const text = await readFile(new URL('../' + specifier.slice(2), import.meta.url), 'utf8');
        const module = new SourceTextModule(text, { context, identifier: specifier, initializeImportMeta(meta) { meta.url = 'https://fixture.invalid/scripts/extensions/third-party/Extension-WebSearch/' + specifier.slice(2); } });
        files.set(specifier, module);
        await module.link(async child => {
            if (child.startsWith('./')) return local(child);
            throw new Error('Unexpected nested import: ' + child);
        });
        return module;
    }
    const module = new SourceTextModule(source, { context });
    await module.link(async specifier => specifier.startsWith('./') ? local(specifier) : stubs.get(specifier));
    await module.evaluate();
    assert.equal(typeof globals.window.WebSearch_Intercept, 'function');
    assert.equal(callbacks.length, 1);
});
