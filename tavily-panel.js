/**
 * Isolated, dependency-free Tavily Plus workbench.
 * The host owns transport, credentials, cache, token budgets and stylesheet loading.
 * No provider text is interpreted as HTML, and no paid operation runs on mount.
 */
export const COMPANION_INSTALL_URL = 'https://github.com/xhlr8/SillyTavern-Tavily-Companion';
export const MAX_MONITOR_MS = 10 * 60 * 1000;
// Country values mirror the companion / Tavily Search enum; no runtime dependency.
export const SEARCH_COUNTRIES = Object.freeze(["afghanistan","albania","algeria","andorra","angola","argentina","armenia","australia","austria","azerbaijan","bahamas","bahrain","bangladesh","barbados","belarus","belgium","belize","benin","bhutan","bolivia","bosnia and herzegovina","botswana","brazil","brunei","bulgaria","burkina faso","burundi","cambodia","cameroon","canada","cape verde","central african republic","chad","chile","china","colombia","comoros","congo","costa rica","croatia","cuba","cyprus","czech republic","denmark","djibouti","dominican republic","ecuador","egypt","el salvador","equatorial guinea","eritrea","estonia","ethiopia","fiji","finland","france","gabon","gambia","georgia","germany","ghana","greece","guatemala","guinea","haiti","honduras","hungary","iceland","india","indonesia","iran","iraq","ireland","israel","italy","jamaica","japan","jordan","kazakhstan","kenya","kuwait","kyrgyzstan","latvia","lebanon","lesotho","liberia","libya","liechtenstein","lithuania","luxembourg","madagascar","malawi","malaysia","maldives","mali","malta","mauritania","mauritius","mexico","moldova","monaco","mongolia","montenegro","morocco","mozambique","myanmar","namibia","nepal","netherlands","new zealand","nicaragua","niger","nigeria","north korea","north macedonia","norway","oman","pakistan","panama","papua new guinea","paraguay","peru","philippines","poland","portugal","qatar","romania","russia","rwanda","saudi arabia","senegal","serbia","singapore","slovakia","slovenia","somalia","south africa","south korea","south sudan","spain","sri lanka","sudan","sweden","switzerland","syria","taiwan","tajikistan","tanzania","thailand","togo","trinidad and tobago","tunisia","turkey","turkmenistan","uganda","ukraine","united arab emirates","united kingdom","united states","uruguay","uzbekistan","venezuela","vietnam","yemen","zambia","zimbabwe"]);
export const SEARCH_DEFAULTS = Object.freeze({
    search_depth: 'basic', chunks_per_source: 3, max_results: 5, topic: 'general',
    include_answer: false, include_raw_content: false, include_usage: true,
    language: 'en', filter_by_language: false, auto_parameters: false,
    include_images: false, include_image_descriptions: false, include_favicon: false,
    safe_search: false, include_domains_mode: 'boost',
    exact_match: false, include_published_date: true, filter_by_published_date: false,
});
export const EXTRACT_DEFAULTS = Object.freeze({
    extract_depth: 'basic', format: 'markdown', timeout: 30, include_usage: true,
});
export const SEARCH_PRESETS = Object.freeze({
    free: Object.freeze({ search_depth: 'basic', max_results: 5, chunks_per_source: 3, topic: 'general', time_range: '', start_date: '', end_date: '', filter_by_published_date: false, auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false, include_image_descriptions: false, include_favicon: false }),
    quick: Object.freeze({ search_depth: 'basic', topic: 'general', time_range: '', start_date: '', end_date: '', filter_by_published_date: false, auto_parameters: false }),
    detailed: Object.freeze({ search_depth: 'advanced', chunks_per_source: 3, topic: 'general', time_range: '', start_date: '', end_date: '', filter_by_published_date: false, auto_parameters: false }),
    news: Object.freeze({ search_depth: 'basic', topic: 'news', time_range: 'week', start_date: '', end_date: '', country: '', auto_parameters: false }),
});

function choice(value, choices, label) {
    if (!choices.includes(value)) throw new Error(label + ' has an unsupported value.');
    return value;
}

export function boundedInteger(value, min, max, label = 'Value') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new Error(label + ' must be a whole number from ' + min + ' to ' + max + '.');
    }
    return value;
}

function boolean(value, label) {
    if (typeof value !== 'boolean') throw new Error(label + ' must be true or false, not text.');
    return value;
}

export function safeHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value.trim());
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export function parseUrls(value, max = 20) {
    if (typeof value !== 'string') throw new Error('Enter one HTTP(S) URL per line.');
    const lines = value.split(/\s+/).filter(Boolean);
    if (!lines.length) throw new Error('Enter at least one HTTP(S) URL.');
    const urls = [...new Set(lines.map(line => {
        const url = safeHttpUrl(line);
        if (!url) throw new Error('Only absolute HTTP(S) URLs without credentials are allowed: ' + line);
        return url;
    }))];
    if (urls.length > max) throw new Error('Use at most ' + max + ' URLs per request.');
    return urls;
}

export function parseDomains(value, max) {
    if (!Array.isArray(value) && typeof value !== 'string') throw new Error('Domains must be a list or text.');
    const list = Array.isArray(value) ? value : value.split(/[\s,]+/);
    const domains = [...new Set(list.filter(item => item !== '').map(item => {
        if (typeof item !== 'string') throw new Error('Domains must be text.');
        const domain = item.trim().toLowerCase();
        if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) {
            throw new Error('Use bare domains, such as example.com (not URLs or wildcards).');
        }
        return domain;
    }))];
    if (domains.length > max) throw new Error('At most ' + max + ' domains are allowed here.');
    return domains;
}

function dateValue(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(label + ' must be YYYY-MM-DD.');
    const date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(label + ' is not a valid date.');
    return value;
}

/** Validate types rather than coercing persisted strings into booleans/numbers. */
export function buildSearchOptions(config = {}) {
    const values = { ...SEARCH_DEFAULTS, ...config };
    const out = {
        search_depth: choice(values.search_depth, ['basic', 'advanced', 'fast', 'ultra-fast'], 'Search depth'),
        max_results: boundedInteger(values.max_results, 1, 20, 'Max results'),
        topic: choice(values.topic, ['general', 'news', 'finance'], 'Topic'),
        include_answer: choice(values.include_answer, [false, true, 'basic', 'advanced'], 'Answer'),
        include_raw_content: choice(values.include_raw_content, [false, true, 'markdown', 'text'], 'Raw content'),
    };
    boundedInteger(values.chunks_per_source, 1, 3, 'Chunks per source');
    if (out.search_depth !== 'ultra-fast') out.chunks_per_source = values.chunks_per_source;
    for (const key of ['include_usage', 'auto_parameters', 'filter_by_language', 'include_images', 'include_image_descriptions', 'include_favicon', 'safe_search', 'exact_match', 'include_published_date', 'filter_by_published_date']) {
        out[key] = boolean(values[key], key);
    }
    if (!out.include_images) out.include_image_descriptions = false;
    if (['fast', 'ultra-fast'].includes(out.search_depth)) delete out.safe_search;
    if (typeof values.language !== 'string' || !/^[a-z]{2,3}(?:-[a-zA-Z]{2,8})?$/.test(values.language)) {
        throw new Error('Language must be a code such as en, fr or pt-BR.');
    }
    out.language = values.language;
    if (values.country) {
        choice(values.country, SEARCH_COUNTRIES, 'Country');
        if (out.topic !== 'general') throw new Error('Country is available only for the general topic; clear it or change topic.');
        out.country = values.country.trim();
    }
    if (values.time_range) out.time_range = choice(values.time_range, ['day', 'week', 'month', 'year'], 'Time range');
    if (values.start_date) out.start_date = dateValue(values.start_date, 'Start date');
    if (values.end_date) out.end_date = dateValue(values.end_date, 'End date');
    if (out.time_range && (out.start_date || out.end_date)) throw new Error('Choose a relative time range OR explicit dates, not both.');
    if (out.start_date && out.end_date && out.start_date > out.end_date) throw new Error('Start date must not be after end date.');
    if (out.filter_by_published_date && !(out.time_range || out.start_date || out.end_date)) throw new Error('Published-date filtering requires a relative range or explicit dates.');
    if (out.filter_by_published_date && !out.include_published_date) throw new Error('Published-date filtering requires Include published dates.');
    const include = parseDomains(values.include_domains ?? [], 300);
    const exclude = parseDomains(values.exclude_domains ?? [], 150);
    if (include.some(domain => exclude.some(blocked => domain === blocked || domain.endsWith('.' + blocked)))) throw new Error('Included domains must not also be excluded.');
    const domainMode = choice(values.include_domains_mode, ['boost', 'filter'], 'Domain mode');
    if (include.length) { out.include_domains = include; out.include_domains_mode = domainMode; }
    if (exclude.length) out.exclude_domains = exclude;
    return out;
}

export function buildExtractOptions(config = {}) {
    const values = { ...EXTRACT_DEFAULTS, ...config };
    const out = {
        extract_depth: choice(values.extract_depth, ['basic', 'advanced'], 'Extraction depth'),
        format: choice(values.format, ['markdown', 'text'], 'Extraction format'),
        timeout: boundedInteger(values.timeout, 1, 60, 'Extraction timeout'),
        include_usage: boolean(values.include_usage, 'Include usage'),
    };
    const query = values.query ?? '';
    if (typeof query !== 'string' || query.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(query)) throw new Error('Extraction focus query must be text of at most 4,000 characters.');
    if (query.trim()) {
        out.query = query.trim();
        out.chunks_per_source = boundedInteger(values.chunks_per_source ?? 3, 1, 5, 'Extraction chunks per source');
    }
    return out;
}

/** One raw regex per line; compile only to validate syntax, never run on provider text. */
export function parsePathPatterns(value) {
    if (!Array.isArray(value) && typeof value !== 'string') throw new Error('Path filters must be a list or one regex per line.');
    const rows = Array.isArray(value) ? value : value.split(/\r?\n/);
    const patterns = [...new Set(rows.filter(row => row !== '').map(row => {
        if (typeof row !== 'string' || !row.trim() || row.length > 500 || /[\u0000-\u001f]/u.test(row)) throw new Error('Each path regex must contain 1–500 characters without control characters.');
        const pattern = row.trim();
        try { new RegExp(pattern); } catch { throw new Error('Invalid path regex: ' + pattern); }
        return pattern;
    }))];
    if (patterns.length > 50) throw new Error('Use at most 50 path regexes per list.');
    return patterns;
}

export function buildResearchOptions(config = {}) {
    const out = {
        model: choice(config.model ?? 'mini', ['mini', 'pro', 'auto'], 'Research mode'),
        output_length: choice(config.output_length ?? 'standard', ['short', 'standard', 'long'], 'Report length'),
        citation_format: choice(config.citation_format ?? 'numbered', ['numbered', 'mla', 'apa', 'chicago'], 'Citation format'),
    };
    const include = parseDomains(config.include_domains ?? [], 20);
    const exclude = parseDomains(config.exclude_domains ?? [], 20);
    if (include.some(domain => exclude.some(blocked => domain === blocked || domain.endsWith('.' + blocked)))) throw new Error('Research included domains must not also be excluded.');
    if (include.length) out.include_domains = include;
    if (exclude.length) out.exclude_domains = exclude;
    if (config.output_schema != null) {
        const schema = parseResearchSchema(textValue(config.output_schema));
        if (schema !== undefined) out.output_schema = schema;
    }
    return out;
}

export function buildTraversalOptions(config = {}) {
    if (config.instructions && (typeof config.instructions !== 'string' || config.instructions.length > 4000)) throw new Error('Discovery instructions must be at most 4,000 characters.');
    const out = {
        limit: boundedInteger(config.limit ?? 10, 1, 50, 'Page cap'),
        max_depth: boundedInteger(config.max_depth ?? 1, 1, 3, 'Depth'),
        max_breadth: boundedInteger(config.max_breadth ?? 10, 1, 20, 'Breadth'),
        allow_external: false,
        ...(typeof config.instructions === 'string' && config.instructions.trim() ? { instructions: config.instructions.trim() } : {}),
    };
    for (const key of ['select_paths', 'exclude_paths']) {
        const patterns = parsePathPatterns(config[key] ?? []);
        if (patterns.length) out[key] = patterns;
    }
    return out;
}

/** Validate the bounded Tavily output_schema subset, not arbitrary executable JSON. */
export function parseResearchSchema(value) {
    if (typeof value !== 'string') throw new Error('Output schema must be JSON text.');
    if (!value.trim()) return undefined;
    if (value.length > 16384 || new TextEncoder().encode(value).length > 16384) throw new Error('Output schema JSON must fit within 16 KiB.');
    let schema;
    try { schema = JSON.parse(value); }
    catch { throw new Error('Output schema must be valid JSON; leave blank for a normal report.'); }
    const object = node => node !== null && typeof node === 'object' && !Array.isArray(node);
    const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
    let count = 0;
    function validate(node, depth, root = false, item = false) {
        if (!object(node) || depth > 8 || ++count > 256) throw new Error('Output schema must contain objects with at most 8 nesting levels and 256 schema nodes.');
        const allowed = root ? ['type', 'properties', 'required'] : ['type', 'description', 'properties', 'required', 'items'];
        if (Object.keys(node).some(key => !allowed.includes(key))) throw new Error('Output schema contains unsupported keywords. Use type, properties, required, description and array items only.');
        if (root) {
            if (node.type !== undefined && node.type !== 'object') throw new Error('Output schema root type must be object.');
        } else {
            choice(node.type, ['object', 'string', 'integer', 'number', 'array'], 'Output schema field type');
            if ((!item || node.description !== undefined) && !text(node.description, 2000)) throw new Error('Each output schema property needs a description (1–2,000 characters).');
        }
        if (root || node.type === 'object') {
            if (!object(node.properties) || !Object.keys(node.properties).length || Object.keys(node.properties).length > 100) throw new Error('Each schema object needs 1–100 properties.');
            for (const [key, child] of Object.entries(node.properties)) {
                if (!text(key, 100) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Output schema property name is invalid.');
                validate(child, depth + 1);
            }
            if (node.required !== undefined && (!Array.isArray(node.required) || node.required.length < 1 || node.required.length > 100 || node.required.some(key => typeof key !== 'string' || !Object.hasOwn(node.properties, key)) || new Set(node.required).size !== node.required.length)) throw new Error('Schema required must list unique names present in properties.');
        } else if (node.properties !== undefined || node.required !== undefined) throw new Error('Only schema objects may define properties or required.');
        if (node.type === 'array') validate(node.items, depth + 1, false, true);
        else if (node.items !== undefined) throw new Error('Only schema arrays may define items.');
    }
    validate(schema, 0, true);
    return schema;
}

export function textValue(value) {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function resultDocuments(result) {
    const rows = Array.isArray(result?.results) ? result.results : Array.isArray(result?.sources) ? result.sources : [];
    return rows.map(row => {
        const source = typeof row === 'string' ? { url: row } : row || {};
        return {
            title: textValue(source.title || source.url || 'Untitled source'),
            url: safeHttpUrl(source.url),
            content: textValue(source.raw_content ?? source.content ?? ''),
            source,
        };
    }).filter(row => row.url);
}

export function researchMarkdown(report) {
    const body = textValue(report?.content ?? report?.report ?? report?.text);
    const sources = Array.isArray(report?.sources) ? report.sources : [];
    const citations = sources.map((source, index) => {
        const row = typeof source === 'string' ? { url: source } : source || {};
        const url = safeHttpUrl(row.url);
        if (!url) return '';
        const label = textValue(row.title || 'Source ' + (index + 1)).replace(/[\\[\]\r\n]/g, ' ');
        return '- [' + label + '](<' + url.replace(/</g, '%3C').replace(/>/g, '%3E') + '>)';
    }).filter(Boolean);
    return body + (citations.length ? '\n\n## Sources\n\n' + citations.join('\n') : '');
}

function abortError(message = 'Stopped locally.') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function abortable(promise, signal) {
    if (signal.aborted) {
        Promise.resolve(promise).catch(() => {}); // Consume a late transport rejection after local cancellation.
        return Promise.reject(signal.reason || abortError());
    }
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason || abortError());
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason || abortError()); return; }
        const abort = () => { clearTimeout(timer); reject(signal.reason || abortError()); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
        signal.addEventListener('abort', abort, { once: true });
    });
}

/** Hard deadline also bounds a hung adapter; stopping polling is NOT provider cancellation. */
export async function pollResearch(getResearch, id, {
    signal, onUpdate = () => {}, intervalMs = 3000, timeoutMs = MAX_MONITOR_MS,
} = {}) {
    boundedInteger(timeoutMs, 1, MAX_MONITOR_MS, 'Monitoring duration');
    boundedInteger(intervalMs, 0, MAX_MONITOR_MS, 'Polling interval');
    const controller = new AbortController();
    const stop = () => controller.abort(signal?.reason || abortError());
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Monitoring reached its time limit. The provider may still be working and charging; resume monitoring with the request ID.')), timeoutMs);
    try {
        while (!controller.signal.aborted) {
            const result = await abortable(Promise.resolve().then(() => {
                if (controller.signal.aborted) throw controller.signal.reason || abortError();
                return getResearch(id, { signal: controller.signal });
            }), controller.signal);
            if (controller.signal.aborted) throw controller.signal.reason || abortError();
            onUpdate(result);
            const status = String(result?.status || '').toLowerCase();
            if (['completed', 'complete', 'done', 'succeeded', 'success'].includes(status)) return result;
            if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) throw new Error('Research ' + status + ': ' + textValue(result?.error || result?.message || 'No additional details.'));
            await delay(intervalMs, controller.signal);
        }
        throw controller.signal.reason || abortError();
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
    }
}

let panelNumber = 0;
const mounted = new WeakMap();

/**
 * @returns {Promise<{element: HTMLElement, refreshCapabilities: Function, destroy: Function}>}
 * Host must load tavily-panel.css. Optional api.subscribeResults(callback) returns a
 * synchronous disposer and publishes normalized search envelopes without making requests.
 * api.setExpensiveEnabled(boolean) updates server-session policy; the panel then
 * verifies it with api.capabilities(true). Only policy.expensive_enabled === true
 * permits new Map/Crawl/Research tasks; this opt-in is never persisted in settings.
 * The host scopes published evidence to the current chat. destroy() unsubscribes,
 * aborts local work and removes only this panel.
 */
export async function mountTavilyPanel({ container, settings, onChange = () => {}, api = {}, importDocuments } = {}) {
    if (!container?.ownerDocument || typeof container.append !== 'function') throw new TypeError('container must be a DOM element.');
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('settings must be the persistent Tavily settings object.');
    mounted.get(container)?.destroy();
    const doc = container.ownerDocument;
    const prefix = 'tavily-plus-' + (++panelNumber) + '-';
    let fieldNumber = 0;
    let destroyed = false;
    let capabilities = null;
    let capabilityPending = false;
    let policyPending = false;
    const gates = [];
    const controllers = new Map();
    const searchBindings = [];
    const urlsToRevoke = new Set();
    const revokeTimers = new Set();
    let unsubscribeResults = null;

    function el(tag, className, text) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = textValue(text);
        return node;
    }
    function link(url, title) {
        const href = safeHttpUrl(url);
        if (!href) return el('span', 'tp-muted', title || 'Invalid source URL omitted');
        const node = el('a', '', title || href);
        node.href = href;
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
        return node;
    }
    function note(parent, text) {
        const node = el('p', 'tp-note', text);
        parent.append(node);
        return node;
    }
    function status(parent) {
        const node = el('p', 'tp-status');
        node.setAttribute('role', 'status');
        node.setAttribute('aria-live', 'polite');
        node.setAttribute('aria-atomic', 'true');
        parent.append(node);
        return node;
    }
    function say(node, message, error = false) {
        if (destroyed) return;
        node.textContent = textValue(message);
        node.classList.toggle('tp-error', error);
    }
    function save() {
        try { Promise.resolve(onChange()).catch(error => say(globalStatus, 'Could not save settings: ' + error.message, true)); }
        catch (error) { say(globalStatus, 'Could not save settings: ' + error.message, true); }
    }
    function config(section, defaults = {}) { return { ...defaults, ...(settings[section] || {}) }; }
    function setConfig(section, key, value) {
        if (!section) settings[key] = value;
        else {
            if (!settings[section] || typeof settings[section] !== 'object' || Array.isArray(settings[section])) settings[section] = {};
            settings[section][key] = value;
        }
        save();
    }
    function operation(name) {
        if (!capabilities || capabilities.version !== 1 || capabilities.configured !== true || settings.useCompanion === false) return false;
        if (typeof api[name] !== 'function') return false;
        if (['map', 'crawl', 'createResearch'].includes(name) && (policyPending || capabilities.policy?.expensive_enabled !== true)) return false;
        const aliases = {
            createResearch: ['createResearch', 'research', 'research.create'],
            getResearch: ['getResearch', 'research', 'research.get', 'research.status'],
            forgetResearch: ['forgetResearch', 'research', 'research.forget'],
        };
        return (aliases[name] || [name]).some(op => capabilities.operations.includes(op));
    }
    function gate(node, allowed) { gates.push({ node, allowed }); return node; }
    function updateGates() {
        if (destroyed) return;
        for (const { node, allowed } of gates) node.disabled = !allowed();
        expensiveToggle.checked = capabilities?.policy?.expensive_enabled === true;
    }
    function button(parent, title, action, allowed = () => true) {
        const node = gate(el('button', 'menu_button tp-button', title), allowed);
        node.type = 'button';
        node.addEventListener('click', () => {
            if (!node.disabled && !destroyed) Promise.resolve().then(action).catch(error => say(globalStatus, error?.message || error, true));
        });
        parent.append(node);
        return node;
    }
    function group(parent, title, op) {
        const details = el('details', 'tp-section');
        details.append(el('summary', '', title));
        const content = el('div', 'tp-section-body');
        const fieldset = el('fieldset', 'tp-fields');
        const legend = el('legend', 'tp-sr-only', title + ' controls');
        fieldset.append(legend);
        if (op) gate(fieldset, () => operation(op));
        content.append(fieldset);
        details.append(content);
        parent.append(details);
        return { details, content, fieldset, status: status(content), output: el('div', 'tp-output') };
    }
    function field(parent, label, {
        type = 'text', value = '', choices, min, max, maxLength, hint, section, key, parse, onEdit, rows = 3, arraySeparator = ', ',
    } = {}) {
        const wrap = el('div', type === 'checkbox' ? 'tp-field tp-check' : 'tp-field');
        const id = prefix + (++fieldNumber);
        const labelNode = el('label', '', label);
        labelNode.htmlFor = id;
        const input = el(choices ? 'select' : type === 'textarea' ? 'textarea' : 'input', type === 'checkbox' ? '' : 'text_pole');
        input.id = id;
        if (choices) {
            for (const [optionValue, title] of choices) {
                const option = el('option', '', title);
                option.value = String(optionValue);
                input.append(option);
            }
        } else if (type === 'textarea') input.rows = rows;
        else input.type = type;
        if (type === 'checkbox') input.checked = value === true;
        else input.value = Array.isArray(value) ? value.join(arraySeparator) : String(value ?? '');
        if (min !== undefined) input.min = String(min);
        if (max !== undefined) input.max = String(max);
        if (maxLength !== undefined) input.maxLength = maxLength;
        if (type === 'number') input.step = '1';
        wrap.append(labelNode, input);
        if (hint) {
            const help = el('small', 'tp-note', hint);
            help.id = id + '-help';
            input.setAttribute('aria-describedby', help.id);
            wrap.append(help);
        }
        const binding = { input, section, key, type, value };
        input.addEventListener('change', () => {
            try {
                let next = type === 'checkbox' ? input.checked : input.value;
                if (type === 'number') {
                    if (!input.value.trim()) throw new Error(label + ' is required.');
                    next = boundedInteger(Number(input.value), min, max, label);
                }
                if (parse) next = parse(next);
                input.setCustomValidity('');
                if (key) setConfig(section, key, next);
                onEdit?.(next);
                if (section === 'search' && searchPreset) searchPreset.value = 'custom';
                updateGates();
            } catch (error) {
                input.setCustomValidity(error.message);
                input.reportValidity();
            }
        });
        parent.append(wrap);
        if (section === 'search') searchBindings.push(binding);
        return input;
    }
    function invalidateConsentOnEdits(parent, confirmation) {
        for (const input of parent.querySelectorAll('input, select, textarea')) {
            if (input === confirmation) continue;
            const invalidate = () => { confirmation.checked = false; };
            input.addEventListener('input', invalidate);
            input.addEventListener('change', invalidate);
        }
    }
    function valid(parent) {
        return [...parent.querySelectorAll('input, select, textarea')].every(input => input.disabled || input.reportValidity());
    }
    async function run(name, target, action) {
        if (controllers.has(name) || destroyed) return;
        const controller = new AbortController();
        controllers.set(name, controller);
        updateGates();
        try { await action(controller.signal); }
        catch (error) {
            const stopped = controller.signal.aborted || error?.name === 'AbortError';
            say(target, stopped
                ? name === 'research' ? 'Monitoring stopped locally. The provider may continue running and charging; this does not cancel the research task.' : 'Stopped locally. Work already accepted by the provider may still incur credits.'
                : [error?.message || textValue(error), error?.code ? 'Code: ' + error.code : '', error?.request_id ? 'Request: ' + error.request_id : '', error?.retry_after != null ? 'Retry after: ' + textValue(error.retry_after) : ''].filter(Boolean).join(' · '), !stopped);
        } finally {
            if (controllers.get(name) === controller) controllers.delete(name);
            updateGates();
        }
    }
    function stopButton(parent, name, title = 'Stop local request') {
        return button(parent, title, () => controllers.get(name)?.abort(abortError()), () => controllers.has(name));
    }
    async function call(name, args, signal) {
        if (signal.aborted) throw signal.reason || abortError();
        if (!operation(name)) throw new Error('The companion does not currently support ' + name + ', or is not configured/enabled.');
        const result = await abortable(Promise.resolve().then(() => {
            if (signal.aborted) throw signal.reason || abortError();
            // Recheck after the microtask boundary: a simultaneous policy disable wins.
            if (!operation(name)) throw new Error('This operation is no longer enabled by the current session policy.');
            return api[name](...args);
        }), signal);
        if (signal.aborted) throw signal.reason || abortError();
        return result;
    }
    function badges(parent, result, count) {
        const row = el('div', 'tp-badges');
        if (count !== undefined) row.append(el('span', 'tp-badge', count + ' sources'));
        if (result?.request_id) row.append(el('span', 'tp-badge', 'Request: ' + textValue(result.request_id)));
        if (result?.usage != null) row.append(el('span', 'tp-badge', 'Usage / cost: ' + textValue(result.usage)));
        if (result?.cached === true || result?.cache_hit === true || result?.cache?.hit === true) row.append(el('span', 'tp-badge', 'Cached'));
        parent.append(row);
    }
    function preview(parent, content, label = 'Content preview') {
        if (!content) return;
        const details = el('details', 'tp-preview');
        details.append(el('summary', '', label), el('pre', 'tp-text', content));
        parent.append(details);
    }
    function sourceCard(parent, item) {
        const card = el('article', 'tp-source');
        card.append(link(item.url, item.title));
        const meta = [item.source?.id != null ? 'Source ' + item.source.id : '', item.source?.published_date, typeof item.source?.score === 'number' ? 'Relevance score ' + item.source.score : ''].filter(Boolean);
        if (meta.length) card.append(el('small', 'tp-note', meta.join(' · ')));
        preview(card, item.content);
        if (safeHttpUrl(item.source?.favicon)) card.append(link(item.source.favicon, 'Favicon link (not loaded automatically)'));
        if (Array.isArray(item.source?.images)) {
            for (const image of item.source.images) {
                const url = typeof image === 'string' ? image : image?.url;
                if (safeHttpUrl(url)) card.append(link(url, 'Image link (not loaded automatically)'));
            }
        }
        parent.append(card);
        return card;
    }
    function failures(parent, result) {
        if (Array.isArray(result?.failed_results) && result.failed_results.length) preview(parent, textValue(result.failed_results), result.failed_results.length + ' failed URLs');
    }

    const root = el('details', 'tavily-plus');
    const heading = el('summary', 'tp-heading', 'Tavily Plus');
    root.append(heading);
    const body = el('div', 'tp-body');
    root.append(body);
    container.append(root);
    const globalStatus = status(body);
    const capabilityStatus = status(body);
    const install = el('p', 'tp-note');
    install.append(el('span', '', 'Enhanced controls need the configured server companion. Install or update: '), link(COMPANION_INSTALL_URL, 'SillyTavern Tavily Companion'), el('span', '', '. Existing legacy search and other providers are unaffected.'));
    body.append(install);
    field(body, 'Use Tavily companion enhancements', { type: 'checkbox', value: settings.useCompanion !== false, key: 'useCompanion' });
    field(body, 'URL reader', { value: settings.reader || 'tavily', key: 'reader', choices: [['tavily', 'Tavily extraction'], ['html', 'Existing HTML reader']], parse: value => choice(value, ['tavily', 'html'], 'Reader') });
    field(body, 'Model URL-read limit', { type: 'number', min: 1, max: 20, value: settings.toolMaxUrls ?? 3, key: 'toolMaxUrls', hint: 'Default 3 URLs per model URL-read call saves extraction credits. Manual Read URLs batches still allow up to 20 URLs; this limit does not enable automatic scraping.' });
    note(body, 'Free plan: 1,000 free monthly credits. Basic search uses 1 credit; advanced search uses 2 credits. Research mini estimates 4–110 credits and pro 15–250 credits per task, which can consume a large part of the monthly allowance. These are estimates, not a spending cap.');
    const policyStatus = status(body);
    const expensiveToggle = field(body, 'Enable Map/Crawl and Research for this session', {
        type: 'checkbox', value: false,
        hint: 'Disabled by default. Session opt-in comes only from server capability policy, never saved UI preferences; it does not survive a server restart. Unlock first, then confirm each new request separately. Disabling does not cancel existing provider tasks or charges.',
        onEdit: enabled => { void setExpensivePolicy(enabled); },
    });
    gate(expensiveToggle, () => !policyPending && !capabilityPending && capabilities?.version === 1 && capabilities.configured === true && typeof api.setExpensiveEnabled === 'function');
    note(body, 'No automatic page scraping is enabled by this panel. The Free-plan preset changes search/extraction defaults only; it does not unlock paid discovery or research.');
    async function setExpensivePolicy(enabled) {
        if (destroyed || policyPending || capabilityPending || capabilities?.version !== 1 || capabilities.configured !== true || typeof api.setExpensiveEnabled !== 'function') return;
        policyPending = true;
        // Fail closed while the preference is in flight, including network failures.
        if (capabilities) capabilities = { ...capabilities, policy: { ...capabilities.policy, expensive_enabled: false } };
        traversalConfirm.checked = false;
        researchConfirm.checked = false;
        updateGates();
        say(policyStatus, enabled ? 'Requesting session unlock… No paid request is being made.' : 'Disabling new Map/Crawl and Research requests…');
        try {
            const result = await api.setExpensiveEnabled(enabled);
            if (destroyed) return;
            if (typeof result?.expensive_enabled !== 'boolean') throw new Error('Invalid session preference response.');
            await refreshCapabilities(true);
            if (destroyed) return;
            if (!capabilities) throw new Error('Could not verify session policy. Refresh capability before trying again.');
            say(policyStatus, capabilities.policy?.expensive_enabled === true ? 'Session unlocked. Each Map/Crawl or Research submission still requires fresh credit confirmation.' : 'New Map/Crawl and Research requests are disabled. Existing research can still be monitored or forgotten.');
        } catch (error) {
            say(policyStatus, 'Session preference update failed: ' + (error?.message || textValue(error)) + ' New expensive requests remain disabled until capability policy is verified.', true);
        } finally {
            policyPending = false;
            updateGates();
        }
    }
    note(body, 'The legacy 2,000-character prompt budget is separate. The parent Web Search settings manage the current character budget (default 8,000), token limits and prompt injection; this workbench does not change them.');
    const capabilityActions = el('div', 'tp-actions');
    body.append(capabilityActions);
    button(capabilityActions, 'Refresh capability', () => refreshCapabilities(), () => !capabilityPending && !policyPending);
    button(capabilityActions, 'Refresh usage', () => run('usage', globalStatus, async signal => {
        say(globalStatus, 'Fetching usage…');
        const result = await call('usage', [{ signal }], signal);
        say(globalStatus, 'Usage: ' + textValue(result));
    }), () => operation('usage') && !controllers.has('usage'));

    let searchPreset;
    const search = group(body, 'Search', 'search');
    search.details.open = true;
    const searchConfig = config('search', SEARCH_DEFAULTS);
    const query = field(search.fieldset, 'Search query', { type: 'textarea', rows: 2, maxLength: 2000 });
    searchPreset = field(search.fieldset, 'Search preset', {
        value: 'custom', choices: [['free', 'Free-plan · basic, 5 results'], ['quick', 'Quick · basic'], ['detailed', 'Detailed · advanced'], ['news', 'News · past week'], ['custom', 'Custom']],
        onEdit: preset => {
            if (preset === 'custom') return;
            choice(preset, Object.keys(SEARCH_PRESETS), 'Search preset');
            if (!settings.search || typeof settings.search !== 'object' || Array.isArray(settings.search)) settings.search = {};
            Object.assign(settings.search, config('search', SEARCH_DEFAULTS), SEARCH_PRESETS[preset]);
            if (preset === 'free') {
                if (!settings.extract || typeof settings.extract !== 'object' || Array.isArray(settings.extract)) settings.extract = {};
                settings.extract.extract_depth = 'basic';
                extractDepth.value = 'basic';
                extractDepth.setCustomValidity('');
                traversalConfirm.checked = false;
            }
            for (const binding of searchBindings) {
                const value = settings.search[binding.key];
                if (binding.type === 'checkbox') binding.input.checked = value === true;
                else binding.input.value = Array.isArray(value) ? value.join(', ') : String(value ?? '');
                binding.input.setCustomValidity('');
            }
            save();
        },
    });
    const advanced = el('details', 'tp-advanced');
    advanced.append(el('summary', '', 'Advanced search controls'));
    const searchGrid = el('div', 'tp-grid');
    advanced.append(searchGrid);
    search.fieldset.append(advanced);
    const sf = (label, key, options = {}) => field(searchGrid, label, { section: 'search', key, value: searchConfig[key] ?? '', ...options });
    sf('Search depth', 'search_depth', { choices: [['basic', 'Basic'], ['advanced', 'Advanced'], ['fast', 'Fast'], ['ultra-fast', 'Ultra-fast']] });
    sf('Topic', 'topic', { choices: [['general', 'General'], ['news', 'News'], ['finance', 'Finance']] });
    sf('Max results', 'max_results', { type: 'number', min: 1, max: 20 });
    const chunks = sf('Chunks per source', 'chunks_per_source', { type: 'number', min: 1, max: 3, hint: 'Available for basic, fast and advanced; omitted for ultra-fast.' });
    gate(chunks, () => operation('search') && config('search', SEARCH_DEFAULTS).search_depth !== 'ultra-fast');
    sf('Relative date range', 'time_range', { choices: [['', 'Any time'], ['day', 'Past day'], ['week', 'Past week'], ['month', 'Past month'], ['year', 'Past year']], hint: 'Use a relative range OR explicit dates, not both.' });
    sf('Start date', 'start_date', { type: 'date' });
    sf('End date', 'end_date', { type: 'date' });
    sf('Include published dates', 'include_published_date', { type: 'checkbox' });
    sf('Filter by published date', 'filter_by_published_date', { type: 'checkbox', hint: 'Requires a date window and Include published dates.' });
    sf('Exact-match search', 'exact_match', { type: 'checkbox' });
    sf('Include domains', 'include_domains', { type: 'textarea', rows: 2, parse: value => parseDomains(value, 300), hint: 'Comma/space-separated bare domains; maximum 300.' });
    sf('Exclude domains', 'exclude_domains', { type: 'textarea', rows: 2, parse: value => parseDomains(value, 150), hint: 'Comma/space-separated bare domains; maximum 150.' });
    sf('Domain matching', 'include_domains_mode', { choices: [['boost', 'Boost preferred domains'], ['filter', 'Strict domain filter']] });
    sf('Preferred language', 'language', { hint: 'Language code, e.g. en, fr or pt-BR.' });
    sf('Strict language filtering', 'filter_by_language', { type: 'checkbox' });
    sf('Country (optional)', 'country', { choices: [['', 'No country preference'], ...SEARCH_COUNTRIES.map(country => [country, country.replace(/\b[a-z]/g, letter => letter.toUpperCase())])], hint: 'Supported country names; general topic only.' });
    sf('Include answer', 'include_answer', { choices: [['false', 'No answer'], ['true', 'Yes (provider default)'], ['basic', 'Basic answer'], ['advanced', 'Advanced answer']], parse: value => value === 'false' ? false : value === 'true' ? true : choice(value, ['basic', 'advanced'], 'Answer') });
    sf('Include raw content', 'include_raw_content', { choices: [['false', 'No raw content'], ['true', 'Yes (provider default)'], ['markdown', 'Markdown'], ['text', 'Plain text']], parse: value => value === 'false' ? false : value === 'true' ? true : choice(value, ['markdown', 'text'], 'Raw content') });
    for (const [key, label] of [
        ['safe_search', 'Safe search'], ['include_images', 'Include image links'],
        ['include_image_descriptions', 'Image descriptions'], ['include_favicon', 'Include favicon URL'],
        ['auto_parameters', 'Automatic provider parameters'], ['include_usage', 'Include usage metadata'],
    ]) {
        const input = sf(label, key, { type: 'checkbox' });
        if (key === 'include_image_descriptions') gate(input, () => operation('search') && config('search', SEARCH_DEFAULTS).include_images === true);
        if (key === 'safe_search') gate(input, () => operation('search') && !['fast', 'ultra-fast'].includes(config('search', SEARCH_DEFAULTS).search_depth));
    }
    note(search.fieldset, 'Search and extraction may consume credits. Advanced depth / automatic parameters can increase usage. Safe search is unavailable for fast/ultra-fast depth. Images and favicons are never loaded automatically here.');
    const searchActions = el('div', 'tp-actions');
    search.content.append(searchActions, search.output);
    note(search.content, 'Latest search evidence: workbench, model-tool and automatic searches appear here when the host provides result updates, including cached results. Updates only render evidence; they never start requests or import documents.');
    function renderSearch(result) {
        if (destroyed || !result || typeof result !== 'object' || !Array.isArray(result.sources)) return;
        search.output.replaceChildren();
        if (result.query) note(search.output, 'Query: ' + textValue(result.query));
        if (result.warning) note(search.output, textValue(result.warning));
        const sources = resultDocuments(result);
        badges(search.output, result, sources.length);
        if (result.answer != null) preview(search.output, textValue(result.answer), 'Answer (provider text)');
        if (result.text) preview(search.output, result.text, 'Formatted search text');
        for (const source of sources) sourceCard(search.output, source);
        const imageUrls = new Set();
        // Description-bearing entries take precedence; URL-only images remain a legacy fallback.
        const images = [...(Array.isArray(result.image_details) ? result.image_details : []), ...(Array.isArray(result.images) ? result.images : [])];
        for (const image of images) {
            const url = safeHttpUrl(typeof image === 'string' ? image : image?.url);
            if (!url || imageUrls.has(url)) continue;
            imageUrls.add(url);
            search.output.append(link(url, typeof image?.description === 'string' && image.description.trim() ? image.description : 'Image link (not loaded automatically)'));
        }
        say(search.status, 'Search evidence updated: ' + sources.length + ' sources' + (result.cached === true ? ' · cached' : '') + '.');
    }
    button(searchActions, 'Run search', () => run('search', search.status, async signal => {
        if (!valid(search.fieldset)) return;
        if (!query.value.trim() || query.value.length > 2000) throw new Error('Enter a search query of 1–2,000 characters.');
        const options = buildSearchOptions(config('search'));
        say(search.status, 'Searching…');
        const result = await call('search', [query.value.trim(), { ...options, signal }], signal);
        // Also render the direct response: subscribeResults is optional and may not publish.
        renderSearch(result);
    }), () => operation('search') && !controllers.has('search'));
    stopButton(searchActions, 'search');

    const read = group(body, 'Read URLs', 'extract');
    note(read.fieldset, 'This explicit workbench action uses Tavily Extract, regardless of the chat URL-reader preference above. Up to 20 URLs per request.');
    const readUrls = field(read.fieldset, 'URLs to read (one per line)', { type: 'textarea' });
    const extractConfig = config('extract', EXTRACT_DEFAULTS);
    const extractGrid = el('div', 'tp-grid');
    read.fieldset.append(extractGrid);
    const extractDepth = field(extractGrid, 'Extraction depth', { section: 'extract', key: 'extract_depth', value: extractConfig.extract_depth, choices: [['basic', 'Basic'], ['advanced', 'Advanced']] });
    field(extractGrid, 'Extraction format', { section: 'extract', key: 'format', value: extractConfig.format, choices: [['markdown', 'Markdown'], ['text', 'Plain text']] });
    field(extractGrid, 'Extraction focus query (optional)', { section: 'extract', key: 'query', value: extractConfig.query ?? '', type: 'textarea', rows: 2, maxLength: 4000, hint: 'Focus extraction on a topic. Blank sends neither query nor chunks; also used by Extract selected.' });
    const extractChunks = field(extractGrid, 'Extraction chunks per source', { section: 'extract', key: 'chunks_per_source', value: extractConfig.chunks_per_source ?? 3, type: 'number', min: 1, max: 5, hint: 'Sent only when an extraction focus query is present; not used for Crawl.' });
    gate(extractChunks, () => operation('extract') && typeof settings.extract?.query === 'string' && settings.extract.query.trim().length > 0);
    field(extractGrid, 'Extraction timeout (seconds)', { section: 'extract', key: 'timeout', value: extractConfig.timeout, type: 'number', min: 1, max: 60 });
    field(extractGrid, 'Include extraction usage', { section: 'extract', key: 'include_usage', value: extractConfig.include_usage, type: 'checkbox' });
    const readActions = el('div', 'tp-actions');
    read.content.append(readActions, read.output);
    button(readActions, 'Extract URLs', () => run('extract', read.status, async signal => {
        if (!valid(read.fieldset)) return;
        const urls = parseUrls(readUrls.value);
        const options = buildExtractOptions(config('extract'));
        say(read.status, 'Extracting URLs…');
        const result = await call('extract', [urls, { ...options, signal }], signal);
        read.output.replaceChildren();
        const rows = resultDocuments(result);
        badges(read.output, result, rows.length);
        rows.forEach(row => sourceCard(read.output, row));
        failures(read.output, result);
        say(read.status, 'Extraction complete: ' + rows.length + ' readable URLs; ' + (result.failed_results?.length || 0) + ' failures.');
    }), () => operation('extract') && !controllers.has('extract'));
    stopButton(readActions, 'extract');

    const traversal = group(body, 'Map / Crawl');
    gate(traversal.fieldset, () => operation('map') || operation('crawl'));
    note(traversal.content, 'Map/Crawl creation is disabled until you explicitly enable the session-only opt-in above, then confirm each request. Existing result previews and selected-document actions remain available.');
    const traverseConfig = config('traversal', { method: 'map', limit: 10, max_depth: 1, max_breadth: 10 });
    const method = field(traversal.fieldset, 'Discovery method', { value: traverseConfig.method, section: 'traversal', key: 'method', choices: [['map', 'Map · discover URLs'], ['crawl', 'Crawl · discover and extract content']], onEdit: () => { traversalConfirm.checked = false; } });
    const site = field(traversal.fieldset, 'Website URL', { type: 'url' });
    const traversalGrid = el('div', 'tp-grid');
    traversal.fieldset.append(traversalGrid);
    field(traversalGrid, 'Page cap', { section: 'traversal', key: 'limit', value: traverseConfig.limit, type: 'number', min: 1, max: 50 });
    field(traversalGrid, 'Depth', { section: 'traversal', key: 'max_depth', value: traverseConfig.max_depth, type: 'number', min: 1, max: 3 });
    field(traversalGrid, 'Breadth', { section: 'traversal', key: 'max_breadth', value: traverseConfig.max_breadth, type: 'number', min: 1, max: 20 });
    field(traversal.fieldset, 'Discovery instructions (optional)', { section: 'traversal', key: 'instructions', value: traverseConfig.instructions || '', type: 'textarea', rows: 2, maxLength: 4000 });
    const pathFilters = el('details', 'tp-advanced');
    pathFilters.append(el('summary', '', 'Advanced · path regex filters'));
    traversal.fieldset.append(pathFilters);
    for (const [key, label] of [['select_paths', 'Select path regexes'], ['exclude_paths', 'Exclude path regexes']]) {
        field(pathFilters, label, { section: 'traversal', key, value: traverseConfig[key] ?? [], type: 'textarea', rows: 3, arraySeparator: '\n', parse: parsePathPatterns, hint: 'One raw regex per line, no /regex/ delimiters. Up to 50 patterns, 500 characters each; e.g. ^/docs/ or ^/blog/.' });
    }
    note(traversal.fieldset, 'Paid operation: Map discovers URLs; Crawl also extracts content. The caps bound discovery, not a guaranteed credit price. External links are always disabled. Crawl uses the extraction depth/format/usage settings under Read URLs. Selecting Map URLs and extracting them is a separate paid action.');
    const traversalConfirm = field(traversal.fieldset, 'I confirm this Map / Crawl request may spend credits', { type: 'checkbox' });
    invalidateConsentOnEdits(traversal.fieldset, traversalConfirm);
    invalidateConsentOnEdits(read.fieldset, traversalConfirm);
    const traversalActions = el('div', 'tp-actions');
    traversal.content.append(traversalActions, traversal.output);
    let traversalRows = [];
    const selected = new Set();
    const selectedRows = () => traversalRows.filter((_, index) => selected.has(index));
    function renderTraversal(result) {
        traversal.output.replaceChildren();
        badges(traversal.output, result, traversalRows.length);
        note(traversal.output, 'Select individual results below. Only selected documents with content can be imported.');
        traversalRows.forEach((row, index) => {
            const card = sourceCard(traversal.output, row);
            const checkbox = field(card, 'Select ' + row.title, { type: 'checkbox', value: selected.has(index), onEdit: checked => { checked ? selected.add(index) : selected.delete(index); } });
            checkbox.setAttribute('aria-label', 'Select ' + row.title);
        });
        failures(traversal.output, result);
        updateGates();
    }
    button(traversalActions, 'Run Map / Crawl', () => run('traversal', traversal.status, async signal => {
        if (!valid(traversal.fieldset)) return;
        if (!traversalConfirm.checked) throw new Error('Confirm the paid Map / Crawl request first.');
        const url = parseUrls(site.value, 1)[0];
        const selectedMethod = choice(method.value, ['map', 'crawl'], 'Discovery method');
        const options = buildTraversalOptions(config('traversal'));
        if (selectedMethod === 'crawl') {
            if (!valid(read.fieldset)) return;
            const extraction = buildExtractOptions(config('extract'));
            Object.assign(options, { extract_depth: extraction.extract_depth, format: extraction.format, include_usage: extraction.include_usage });
        }
        traversalConfirm.checked = false;
        say(traversal.status, 'Running ' + selectedMethod + ' with page cap ' + options.limit + '…');
        const result = await call(selectedMethod, [url, { ...options, confirmed: true, signal }], signal);
        traversalRows = resultDocuments(result).slice(0, options.limit);
        selected.clear();
        renderTraversal(result);
        say(traversal.status, selectedMethod + ' complete: ' + traversalRows.length + ' results. Select URLs/documents for the next action.');
    }), () => operation(method.value) && !controllers.has('traversal'));
    stopButton(traversalActions, 'traversal');
    button(traversalActions, 'Extract selected', () => run('traversal', traversal.status, async signal => {
        if (!valid(read.fieldset)) return;
        const rows = selectedRows();
        if (!rows.length) throw new Error('Select at least one URL.');
        const options = buildExtractOptions(config('extract'));
        const allFailures = [];
        const requests = [];
        for (let offset = 0; offset < rows.length; offset += 20) {
            say(traversal.status, 'Extracting selected URLs ' + (offset + 1) + '–' + Math.min(offset + 20, rows.length) + ' of ' + rows.length + '…');
            const result = await call('extract', [rows.slice(offset, offset + 20).map(row => row.url), { ...options, signal }], signal);
            requests.push({ request_id: result.request_id, usage: result.usage, cached: result.cached });
            allFailures.push(...(result.failed_results || []));
            for (const extracted of resultDocuments(result)) {
                const existing = traversalRows.find(row => row.url === extracted.url);
                if (existing) Object.assign(existing, extracted);
            }
            renderTraversal({ failed_results: allFailures });
            for (const request of requests) badges(traversal.output, request);
        }
        say(traversal.status, 'Selected extraction complete; ' + allFailures.length + ' failures. Review previews before importing.');
    }), () => operation('extract') && selectedRows().length > 0 && !controllers.has('traversal'));
    button(traversalActions, 'Import selected to Data Bank', () => run('import', traversal.status, async () => {
        const rows = selectedRows().filter(row => row.content.trim());
        if (!rows.length) throw new Error('Select documents with extracted content first.');
        await importDocuments(rows.map(({ title, url, content }) => ({ title, url, content })));
        say(traversal.status, 'Imported ' + rows.length + ' documents to Data Bank.');
    }), () => typeof importDocuments === 'function' && selectedRows().some(row => row.content.trim()) && !controllers.has('traversal') && !controllers.has('import'));
    if (typeof importDocuments !== 'function') note(traversal.content, 'Data Bank import is unavailable: the host did not provide an importDocuments callback.');

    const research = group(body, 'Research · async status polling');
    gate(research.fieldset, () => operation('createResearch'));
    note(research.content, 'New research is locked until the session-only opt-in above is enabled. Existing task monitoring and forgetting do not require unlocking.');
    const researchConfig = config('research', { model: 'mini', output_length: 'standard', citation_format: 'numbered' });
    const researchInput = field(research.fieldset, 'Research question / instructions', { type: 'textarea', rows: 4, maxLength: 12000 });
    const researchGrid = el('div', 'tp-grid');
    research.fieldset.append(researchGrid);
    const researchModel = field(researchGrid, 'Research mode', { section: 'research', key: 'model', value: researchConfig.model, choices: [['mini', 'Mini'], ['pro', 'Pro'], ['auto', 'Auto · provider chooses']] });
    const researchLength = field(researchGrid, 'Report length', { section: 'research', key: 'output_length', value: researchConfig.output_length, choices: [['short', 'Short'], ['standard', 'Standard'], ['long', 'Long']] });
    field(researchGrid, 'Research citation format', { section: 'research', key: 'citation_format', value: researchConfig.citation_format, choices: [['numbered', 'Numbered'], ['mla', 'MLA'], ['apa', 'APA'], ['chicago', 'Chicago']] });
    field(researchGrid, 'Research include domains', { section: 'research', key: 'include_domains', value: researchConfig.include_domains ?? [], type: 'textarea', rows: 2, parse: value => parseDomains(value, 20), hint: 'Up to 20 comma/space-separated bare domains.' });
    field(researchGrid, 'Research exclude domains', { section: 'research', key: 'exclude_domains', value: researchConfig.exclude_domains ?? [], type: 'textarea', rows: 2, parse: value => parseDomains(value, 20), hint: 'Up to 20 bare domains; must not exclude an included domain.' });
    const schemaDetails = el('details', 'tp-advanced');
    schemaDetails.append(el('summary', '', 'Advanced · structured output schema (optional)'));
    research.fieldset.append(schemaDetails);
    const researchSchema = field(schemaDetails, 'Research output schema (optional JSON)', {
        type: 'textarea', rows: 6, maxLength: 16384, value: researchConfig.output_schema == null ? '' : textValue(researchConfig.output_schema),
        hint: 'Blank means a normal report. Up to 16 KiB of JSON: an object with properties; each property needs a supported type and description. No HTML or code is executed.',
        parse: parseResearchSchema,
        onEdit: schema => {
            if (!settings.research || typeof settings.research !== 'object' || Array.isArray(settings.research)) settings.research = {};
            if (schema === undefined) delete settings.research.output_schema;
            else settings.research.output_schema = schema;
            save();
        },
    });
    preview(schemaDetails, JSON.stringify({ properties: { summary: { type: 'string', description: 'Summary of the research findings' } }, required: ['summary'] }, null, 2), 'Example output schema');
    note(research.fieldset, 'Research costs credits. Current documentation estimates: mini 4–110 credits; pro 15–250 credits. Auto may choose either model. A single report could consume a large part of the 1,000-credit free monthly allowance. These are estimates, not price guarantees or a spending cap.');
    const researchConfirm = field(research.fieldset, 'I confirm this research submission may spend credits', { type: 'checkbox' });
    note(research.content, 'Research is asynchronous status polling, not token streaming. Status and any available content update after each poll. Monitoring is limited to 10 minutes per start and can be resumed with a request ID. Stop monitoring cancels only local polling: the provider may continue running and charging. No provider cancellation is promised.');
    const requestId = field(research.content, 'Research request ID (resume explicitly)', { value: researchConfig.request_id || '', hint: 'Saved locally after submission. No automatic polling on mount.' });
    invalidateConsentOnEdits(research.fieldset, researchConfirm);
    const researchActions = el('div', 'tp-actions');
    research.content.append(researchActions, research.output);
    let finalReport = null;
    function renderResearch(result) {
        research.output.replaceChildren();
        const sources = resultDocuments({ sources: result.sources });
        badges(research.output, result, sources.length);
        if (result.content != null || result.report != null || result.text != null) {
            research.output.append(el('pre', 'tp-text', textValue(result.content ?? result.report ?? result.text)));
        }
        for (const source of sources) sourceCard(research.output, source);
        say(research.status, 'Research status (polled): ' + textValue(result.status || 'status unknown') + (result.progress != null ? ' · ' + textValue(result.progress) : '') + (result.request_id ? ' · Request ' + textValue(result.request_id) : ''));
    }
    async function monitor(id, signal) {
        say(research.status, 'Polling research status for ' + id + ' (not token streaming)…');
        const result = await pollResearch((currentId, options) => call('getResearch', [currentId, options], options.signal), id, { signal, onUpdate: renderResearch });
        finalReport = { ...result, request_id: result.request_id || id };
        renderResearch(finalReport);
        updateGates();
    }
    button(researchActions, 'Start research', () => run('research', research.status, async signal => {
        if (!valid(research.fieldset)) return;
        if (!researchInput.value.trim() || researchInput.value.length > 12000) throw new Error('Enter a research question of 1–12,000 characters.');
        if (!researchConfirm.checked) throw new Error('Confirm the credit cost for each research submission.');
        const options = buildResearchOptions({ ...config('research'), model: researchModel.value, output_length: researchLength.value, output_schema: parseResearchSchema(researchSchema.value) });
        researchConfirm.checked = false;
        finalReport = null;
        updateGates();
        say(research.status, 'Submitting research…');
        const result = await call('createResearch', [researchInput.value.trim(), { ...options, confirmed: true, signal }], signal);
        if (!result?.request_id || typeof result.request_id !== 'string') throw new Error('Provider did not return a research request ID. Check provider usage before submitting again.');
        requestId.value = result.request_id;
        setConfig('research', 'request_id', result.request_id);
        renderResearch(result);
        if (operation('getResearch')) await monitor(result.request_id, signal);
        else say(research.status, 'Research submitted: ' + result.request_id + '. This companion cannot monitor research; the provider may continue charging.');
    }), () => operation('createResearch') && !controllers.has('research'));
    button(researchActions, 'Resume monitoring', () => run('research', research.status, async signal => {
        const id = requestId.value.trim();
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Enter a research request ID: 1–128 letters, numbers, underscores or hyphens.');
        finalReport = null;
        updateGates();
        setConfig('research', 'request_id', id);
        await monitor(id, signal);
    }), () => operation('getResearch') && !controllers.has('research'));
    stopButton(researchActions, 'research', 'Stop monitoring');
    button(researchActions, 'Forget saved request', () => run('research', research.status, async signal => {
        const id = requestId.value.trim();
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Enter a valid research request ID to forget.');
        if (typeof api.forgetResearch === 'function') await abortable(Promise.resolve().then(() => api.forgetResearch(id)), signal);
        requestId.value = '';
        setConfig('research', 'request_id', '');
        finalReport = null;
        research.output.replaceChildren();
        say(research.status, 'Forgot the local request reference. This does not cancel provider work or charges.');
    }), () => !controllers.has('research'));
    button(researchActions, 'Download Markdown', () => {
        const urlApi = doc.defaultView?.URL || URL;
        const BlobClass = doc.defaultView?.Blob || Blob;
        const url = urlApi.createObjectURL(new BlobClass([researchMarkdown(finalReport)], { type: 'text/markdown;charset=utf-8' }));
        urlsToRevoke.add(url);
        const anchor = el('a');
        anchor.href = url;
        anchor.download = 'tavily-research-' + String(finalReport.request_id || 'report').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) + '.md';
        body.append(anchor);
        try { anchor.click(); } finally {
            anchor.remove();
            const timer = setTimeout(() => { urlApi.revokeObjectURL(url); urlsToRevoke.delete(url); revokeTimers.delete(timer); }, 1000);
            revokeTimers.add(timer);
        }
    }, () => finalReport !== null && !controllers.has('research'));
    button(researchActions, 'Import report to Data Bank', () => run('report-import', research.status, async () => {
        const content = researchMarkdown(finalReport);
        if (!content.trim()) throw new Error('The research report is empty.');
        await importDocuments([{ title: 'Tavily research ' + (finalReport.request_id || ''), url: '', content }]);
        say(research.status, 'Imported research report including valid source citations to Data Bank.');
    }), () => finalReport !== null && typeof importDocuments === 'function' && !controllers.has('report-import') && !controllers.has('research'));
    if (typeof importDocuments !== 'function') note(research.content, 'Report import is unavailable until the host supplies Data Bank integration.');

    async function refreshCapabilities(force = true) {
        if (destroyed || capabilityPending) return;
        capabilityPending = true;
        capabilities = null;
        updateGates();
        say(capabilityStatus, 'Detecting Tavily companion capabilities…');
        try {
            if (typeof api.capabilities !== 'function') throw new Error('Companion capability API is unavailable.');
            const result = await api.capabilities(force);
            if (destroyed) return;
            if (!result || result.version !== 1 || !Array.isArray(result.operations)) throw new Error('Unsupported or absent companion capability response (version 1 required).');
            capabilities = result;
            if (result.policy?.expensive_enabled !== true) { traversalConfirm.checked = false; researchConfirm.checked = false; }
            say(policyStatus, result.policy?.expensive_enabled === true ? 'Session policy: new Map/Crawl and Research requests unlocked; per-request consent still required.' : 'Session policy: new Map/Crawl and Research requests disabled. Unlock explicitly for this server session; monitoring existing tasks remains available.');
            install.hidden = result.configured === true;
            say(capabilityStatus, 'Companion v1 · ' + (result.configured === true ? 'configured' : 'API key not configured') + ' · Operations: ' + (result.operations.join(', ') || 'none') + (result.limits ? ' · Limits: ' + textValue(result.limits) : ''), result.configured !== true);
        } catch (error) {
            if (destroyed) return;
            capabilities = null;
            install.hidden = false;
            say(capabilityStatus, 'Enhanced Tavily controls unavailable: ' + (error?.message || textValue(error)) + ' Legacy search is unaffected.', true);
        } finally {
            capabilityPending = false;
            updateGates();
        }
    }
    const handle = {
        element: root,
        refreshCapabilities,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            const disposeResults = unsubscribeResults;
            unsubscribeResults = null;
            try { disposeResults?.(); } catch { /* A host cleanup failure must not prevent local cleanup. */ }
            for (const controller of controllers.values()) controller.abort(abortError());
            controllers.clear();
            for (const timer of revokeTimers) clearTimeout(timer);
            const urlApi = doc.defaultView?.URL || URL;
            for (const url of urlsToRevoke) urlApi.revokeObjectURL(url);
            urlsToRevoke.clear();
            root.remove();
            if (mounted.get(container) === handle) mounted.delete(container);
        },
    };
    mounted.set(container, handle);
    if (typeof api.subscribeResults === 'function') {
        try {
            const disposer = api.subscribeResults(result => {
                if (destroyed) return;
                try { renderSearch(result); }
                catch (error) { say(search.status, 'Could not display search evidence: ' + (error?.message || textValue(error)), true); }
            });
            if (typeof disposer === 'function') unsubscribeResults = disposer;
            else say(globalStatus, 'Search result subscription did not provide a cleanup function. The host should return a disposer.', true);
        } catch (error) {
            say(globalStatus, 'Search result updates unavailable: ' + (error?.message || textValue(error)) + '. Workbench search remains available.', true);
        }
    }
    updateGates();
    await refreshCapabilities(false);
    return handle;
}
