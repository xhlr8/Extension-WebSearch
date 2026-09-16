/** Minimal DOM fixture: no browser, dependencies, parsing, or external calls. */
export class Element {
    constructor(tag, document) {
        this.tagName = tag.toUpperCase();
        this.ownerDocument = document;
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.className = '';
        this._text = '';
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.validationMessage = '';
        this.classList = { toggle: (name, enabled) => {
            const names = new Set(this.className.split(' ').filter(Boolean));
            enabled ? names.add(name) : names.delete(name);
            this.className = [...names].join(' ');
        } };
    }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    set innerHTML(_) { throw new Error('Unsafe HTML insertion is forbidden.'); }
    set outerHTML(_) { throw new Error('Unsafe HTML insertion is forbidden.'); }
    insertAdjacentHTML() { throw new Error('Unsafe HTML insertion is forbidden.'); }
    append(...nodes) {
        for (const node of nodes) {
            if (!(node instanceof Element)) throw new Error('Fixture expects DOM elements.');
            node.remove();
            this.children.push(node);
            node.parentNode = this;
        }
    }
    replaceChildren(...nodes) {
        for (const child of this.children) child.parentNode = null;
        this.children = [];
        this.append(...nodes);
    }
    remove() {
        if (!this.parentNode) return;
        const parent = this.parentNode;
        parent.children = parent.children.filter(node => node !== this);
        this.parentNode = null;
    }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(name, callback) {
        if (!this.listeners.has(name)) this.listeners.set(name, []);
        this.listeners.get(name).push(callback);
    }
    dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); }
    effectivelyDisabled() { return this.disabled || (this.parentNode ? this.parentNode.effectivelyDisabled() : false); }
    click() {
        if (this.effectivelyDisabled()) return;
        if (this.tagName === 'INPUT' && this.type === 'checkbox') { this.checked = !this.checked; this.dispatchEvent({ type: 'change' }); }
        this.dispatchEvent({ type: 'click' });
        if (this.tagName === 'A') this.ownerDocument.downloads.push({ href: this.href, download: this.download });
    }
    setCustomValidity(message) { this.validationMessage = message; }
    reportValidity() {
        if (this.effectivelyDisabled()) return true;
        if (this.validationMessage) return false;
        if (this.type === 'number' && this.value !== '') {
            const number = Number(this.value);
            return Number.isFinite(number) && number >= Number(this.min) && number <= Number(this.max) && Number.isInteger(number);
        }
        return true;
    }
    querySelectorAll(selector) {
        const tags = selector.split(',').map(tag => tag.trim().toUpperCase());
        return descendants(this).filter(node => tags.includes(node.tagName));
    }
}
export function descendants(root) { return root.children.flatMap(node => [node, ...descendants(node)]); }
export function makeDom() {
    const revoked = [];
    const blobs = [];
    const document = {
        createElement(tag) { return new Element(tag, document); },
        downloads: [],
        defaultView: { Blob, URL: {
            createObjectURL(blob) { blobs.push(blob); return 'blob:offline-' + blobs.length; },
            revokeObjectURL(url) { revoked.push(url); },
        } },
    };
    return { document, container: document.createElement('div'), revoked, blobs };
}
export function control(root, label) {
    const nodes = descendants(root);
    const labelNode = nodes.find(node => node.tagName === 'LABEL' && node.textContent === label);
    if (!labelNode) throw new Error('No label: ' + label);
    const input = nodes.find(node => node.id === labelNode.htmlFor);
    if (!input) throw new Error('No control for label: ' + label);
    return input;
}
export function button(root, title) {
    const result = descendants(root).find(node => node.tagName === 'BUTTON' && node.textContent === title);
    if (!result) throw new Error('No button: ' + title);
    return result;
}
export function change(input, value) {
    if (input.type === 'checkbox') input.checked = value;
    else input.value = String(value);
    input.dispatchEvent({ type: 'change' });
}
export async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
