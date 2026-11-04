'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('./src/features/module-apply-template.js');

const SOURCE = fs.readFileSync(require.resolve('./src/features/module-apply-template.js'), 'utf8');
const ROUTE = '#/system/custom-configuration/module-edit';
const PENDING_KEY = 'apicmob-apply-template::pending';
const REPORT_KEY = 'apicmob-apply-template::report';
const OLD_ID = 'module-old';
const NEW_ID = 'module-new';
const PARENT_ID = 'config-zYFvRiZJTQ';
const NAME = '安卓开发测试专用_测试 100% %2F + &';
const SDK_TYPE = 'sdk_overview';
const H5_TYPE = 'SdkH5ManageLinkConfiguration';
const copy = (value) => JSON.parse(JSON.stringify(value));
const field = (key, type, value, extra) => Object.assign({
    id: `id-${key}`, export: key, name: key, type, field_value: value
}, extra);
const success = (result) => ({ code: 200, result });

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.parentElement = null;
        this.listeners = new Map();
        this.attributes = {};
        this.style = {};
        this.value = '';
        this.disabled = false;
        this.className = '';
        this.id = '';
        this._html = '';
    }

    set innerHTML(value) {
        this._html = String(value);
        this.children.forEach((child) => { child.parentElement = null; });
        this.children = [];
        // Only selectors and events are needed here; visual layout is checked in a browser.
        for (const match of this._html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
            const child = new FakeElement(match[1]);
            for (const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
                child.attributes[attr[1]] = attr[2] || '';
            }
            child.id = child.attributes.id || '';
            child.className = child.attributes.class || '';
            child.value = child.attributes.value || '';
            child.disabled = Object.hasOwn(child.attributes, 'disabled');
            this.appendChild(child);
        }
    }

    get innerHTML() { return this._html; }
    get classList() { return { contains: (name) => this.className.split(/\s+/).includes(name) }; }

    appendChild(child) {
        child.remove();
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (this.parentElement) {
            const siblings = this.parentElement.children;
            siblings.splice(siblings.indexOf(this), 1);
            this.parentElement = null;
        }
    }

    matches(selector) {
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        const attr = selector.match(/^\[([\w-]+)(\*?=)"([^"]*)"\]$/);
        if (attr) {
            const value = attr[1] === 'class' ? this.className : this.attributes[attr[1]];
            return attr[2] === '*=' ? String(value || '').includes(attr[3]) : value === attr[3];
        }
        return this.tagName === selector;
    }

    querySelectorAll(selector) {
        const result = [];
        for (const child of this.children) {
            if (child.matches(selector)) result.push(child);
            result.push(...child.querySelectorAll(selector));
        }
        return result;
    }

    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(name, handler) {
        const handlers = this.listeners.get(name) || [];
        handlers.push(handler);
        this.listeners.set(name, handlers);
    }
    focus() {}
    click() { return this.emit('click'); }
    async emit(name) {
        if (name === 'click' && this.disabled) return;
        for (const handler of this.listeners.get(name) || []) {
            await handler({ target: this, preventDefault() {}, stopPropagation() {} });
        }
        await new Promise((resolve) => setImmediate(resolve));
    }
}

function createHarness(options = {}) {
    const type = options.type === undefined ? SDK_TYPE : options.type;
    const detail = Object.assign({
        id: OLD_ID,
        name: NAME,
        module_config_template_id: 'template-old',
        field_list: [field('count', 'number', 0), field('enabled', 'boolean', false)]
    }, options.detail);
    const params = new URLSearchParams({ id: OLD_ID, name: options.routeName === undefined ? NAME : options.routeName });
    if (type) {
        params.set('type', type);
        if (!options.missingParent) params.set('delid', PARENT_ID);
    }
    const location = { hostname: 'cms.apicmob.com', hash: `${ROUTE}?${params}`, reload() {} };
    const originalHash = location.hash;
    const document = new FakeElement('document');
    document.readyState = 'complete';
    document.cookie = '';
    document.createElement = (tag) => new FakeElement(tag);
    document.getElementById = (id) => document.querySelector(`#${id}`);
    document.head = document.appendChild(new FakeElement('head'));
    document.body = document.appendChild(new FakeElement('body'));
    const toolbar = document.body.appendChild(new FakeElement('div'));
    toolbar.className = 'appic-scope-manage-body_top_right-test';
    const requests = [];
    const storage = new Map();
    const timers = [];
    const intervals = [];
    const downloads = [];
    const opened = [];
    const alerts = [];
    const state = { created: false, deleted: false, pendingWrites: 0, sdkQueries: 0 };
    const parentRow = () => ({
        id: PARENT_ID,
        lid: 'test-lid',
        module_config_id: state.created ? NEW_ID : OLD_ID,
        module_config_name: detail.name
    });
    class FakeXHR {
        constructor(body, id = NEW_ID) {
            this.raw = JSON.stringify(body);
            this.responseURL = `https://cmsapi.apicmob.com/api/cms2/system/module_config/detail?id=${encodeURIComponent(id)}`;
        }
        setRequestHeader() {}
        get responseText() { return this.raw; }
        get response() { return this.raw; }
    }
    class TestURL extends URL {
        static createObjectURL(blob) {
            downloads.push(blob);
            return `blob:test-${downloads.length}`;
        }
        static revokeObjectURL() {}
    }
    const window = { document, addEventListener() {}, open: (...args) => opened.push(args) };
    const context = {
        window, document, location, XMLHttpRequest: FakeXHR,
        URL: TestURL, URLSearchParams, Blob,
        history: { pushState() {}, replaceState() {} },
        navigator: { clipboard: { writeText: async () => {} } },
        console: { warn() {}, error() {} },
        alert: (message) => alerts.push(message),
        setTimeout: (callback, delay) => timers.push({ callback, delay }),
        setInterval: (callback) => intervals.push(callback),
        sessionStorage: {
            getItem: (key) => storage.get(key) || null,
            setItem(key, value) {
                if (key === PENDING_KEY) state.pendingWrites += 1;
                if (options.failStorage && options.failStorage(key, state)) throw new Error('quota exceeded');
                storage.set(key, value);
            },
            removeItem: (key) => storage.delete(key)
        },
        fetch: async (url, init) => {
            const parsed = new URL(url);
            const request = {
                path: parsed.pathname.replace(/^\/api/, ''),
                host: parsed.host,
                params: Object.fromEntries(parsed.searchParams),
                method: init.method,
                data: init.body === undefined ? null : JSON.parse(init.body),
                credentials: init.credentials,
                headers: init.headers
            };
            requests.push(request);
            let body = options.respond && await options.respond(request, state);
            if (body === undefined) {
                switch (request.path) {
                case '/cms2/system/config_template/all':
                    body = success({ list: [{ id: 'template-old', name: '旧模板' }, { id: 'template-new', name: '新模板' }] });
                    break;
                case '/cms2/system/module_config/detail': body = success(copy(detail)); break;
                case '/cms2/system/config_template/module/index':
                    body = success({ list: options.templateFields || [field('count', 'number', '')] });
                    break;
                case '/cms2/sdk/config/detail':
                    state.sdkQueries += 1;
                    body = success(parentRow());
                    break;
                case '/cms2/sdk/h5/link/all': body = success({ list: [parentRow()] }); break;
                case '/cms2/sdk/config/module_config/delete':
                case '/cms2/sdk/h5/module_config/delete':
                    state.deleted = true;
                    body = success({});
                    break;
                case '/cms2/sdk/config/module_config/add':
                case '/cms2/sdk/h5/module_config/add':
                case '/cms2/system/module_config/add':
                    state.created = true;
                    body = success({});
                    break;
                case '/cms2/system/module_config/index':
                    body = success({ list: [
                        { id: OLD_ID, name: detail.name, sys_key_entry_id: 'resource-id' },
                        ...(state.created ? [{ id: NEW_ID, name: detail.name }] : [])
                    ] });
                    break;
                default: throw new Error(`Unexpected API request: ${request.path}`);
                }
            }
            return { status: 200, ok: true, json: async () => body };
        }
    };
    context.module = { exports: {} };
    vm.runInNewContext(SOURCE, context);
    context.module.exports.boot(options.runtime);
    const modal = () => document.getElementById('apicmob-apply-template-modal');
    const button = (label) => {
        const found = modal().querySelector('.aat-ft').children.find((child) => child.textContent === label);
        assert.ok(found, `Missing button: ${label}`);
        return found;
    };
    return {
        document, location, originalHash, requests, storage, timers, downloads, opened, alerts, state,
        xhr: (body, id) => new FakeXHR(body, id),
        tick: () => intervals.forEach((callback) => callback()),
        html: () => modal().querySelector('.aat-bd').innerHTML,
        button,
        open: () => document.getElementById('apicmob-apply-template-btn').click(),
        async preview() {
            await this.open();
            const select = modal().querySelector('#aat-tpl');
            assert.ok(select);
            select.value = 'template-new';
            await select.emit('change');
            await button('预览变更').click();
        },
        async confirmation() {
            await this.preview();
            await button('下一步：确认并执行').click();
        },
        async execute() {
            if (type) {
                await this.confirmation();
                const input = modal().querySelector('#aat-confirm');
                assert.ok(input);
                input.value = type === H5_TYPE ? 'test-lid' : PARENT_ID;
                await input.emit('input');
                await button('解绑并重建').click();
            } else {
                await this.preview();
                await button('执行').click();
            }
        }
    };
}

const writes = (harness) => harness.requests.filter((request) => request.method === 'POST');
const pending = (harness) => JSON.parse(harness.storage.get(PENDING_KEY));
function assertNoNavigation(harness) {
    assert.equal(harness.location.hash, harness.originalHash);
    assert.equal(harness.timers.some((timer) => timer.delay === 60), false);
    assert.equal(harness.storage.has(REPORT_KEY), false);
}

test('SDK workflow keeps the name and separates parent and module IDs', async () => {
    const harness = createHarness();
    await harness.execute();
    assert.deepEqual(writes(harness).map(({ path, data }) => ({ path, data })), [
        { path: '/cms2/sdk/config/module_config/delete', data: { id: PARENT_ID } },
        { path: '/cms2/sdk/config/module_config/add', data: {
            id: PARENT_ID, name: NAME, module_config_template_id: 'template-new', copy_id: ''
        } }
    ]);
    assert.equal(harness.state.sdkQueries, 3);
    for (const request of harness.requests.filter((request) => request.path.startsWith('/cms2/sdk/'))) {
        assert.equal(request.host, 'cms-sdk-api.apicmob.com');
        assert.equal(request.credentials, 'include');
    }
    const query = new URLSearchParams(harness.location.hash.split('?')[1]);
    assert.deepEqual(Object.fromEntries(query), { id: NEW_ID, name: NAME, delid: PARENT_ID, type: SDK_TYPE });
    assert.equal(pending(harness).moduleId, NEW_ID);
    assert.equal(pending(harness).newName, NAME);
    assert.deepEqual(pending(harness).oldFieldList.map((node) => node.field_value), [0, false]);
    assert.equal(harness.downloads.length, 1);
    assert.equal(JSON.parse(await harness.downloads[0].text()).id, OLD_ID);
    assert.match(harness.opened[0][0], new RegExp(`id=${OLD_ID}$`));
});

test('SDK lookup works when config/all rejects a missing supply_app_id with code 204', async () => {
    const harness = createHarness({ respond(request, state) {
        if (request.path === '/cms2/sdk/config/all' && !request.params.supply_app_id) {
            return { code: 204, msg: '参数错误！' };
        }
        if (request.path === '/cms2/sdk/config/detail') {
            assert.deepEqual(request.params, { id: PARENT_ID });
            return success({
                id: PARENT_ID, supply_app_id: 'app-id', module_config_id: state.created ? NEW_ID : OLD_ID
            });
        }
    } });
    await harness.confirmation();
    assert.ok(harness.document.getElementById('aat-confirm'), harness.html());
    const input = harness.document.getElementById('aat-confirm');
    input.value = PARENT_ID;
    await input.emit('input');
    await harness.button('解绑并重建').click();
    assert.deepEqual(harness.requests.filter((request) => request.path === '/cms2/sdk/config/detail')
        .map((request) => request.params.id), [PARENT_ID, PARENT_ID, PARENT_ID]);
    assert.equal(harness.requests.some((request) => request.path === '/cms2/sdk/config/all'), false);
    assert.equal(pending(harness).moduleId, NEW_ID);
});

for (const type of [H5_TYPE, '']) {
    test(`${type || 'standalone'} keeps the original name and attachment behavior`, async () => {
        const harness = createHarness({ type });
        await harness.execute();
        const mutations = writes(harness);
        assert.equal(mutations.at(-1).data.name, NAME);
        assert.equal(mutations.at(-1).data.module_config_template_id, 'template-new');
        assert.equal(pending(harness).newName, NAME);
        const query = new URLSearchParams(harness.location.hash.split('?')[1]);
        assert.equal(query.get('name'), NAME);
        if (type) {
            assert.equal(mutations[0].data.id, PARENT_ID);
            assert.equal(query.get('delid'), PARENT_ID);
            assert.equal(query.get('type'), type);
        } else {
            assert.equal(mutations.length, 1);
            assert.equal(mutations[0].path, '/cms2/system/module_config/add');
            assert.equal(mutations[0].data.sys_key_entry_id, 'resource-id');
            assert.equal(query.has('delid'), false);
            assert.equal(query.has('type'), false);
        }
    });
}

test('template selection removes renaming and continues to reject the current template', async () => {
    const harness = createHarness();
    await harness.open();
    assert.doesNotMatch(harness.html(), /aat-name|新模组名称/);
    assert.match(harness.html(), /value="template-old" disabled/);
    assert.equal(harness.button('预览变更').disabled, true);
    const select = harness.document.getElementById('aat-tpl');
    select.value = 'template-old';
    await select.emit('change');
    assert.equal(harness.button('预览变更').disabled, true);
});

test('name comes from saved detail, falling back to the URL with exactly one decode', async () => {
    const detailName = createHarness({ routeName: 'outdated URL name' });
    await detailName.execute();
    assert.equal(writes(detailName).at(-1).data.name, NAME);
    const fallback = createHarness({ detail: { name: '' } });
    await fallback.execute();
    assert.equal(writes(fallback).at(-1).data.name, NAME);
    assert.equal(fallback.alerts.length, 0);
});

test('missing names, missing parent IDs, and unsupported types stop before mutations', async () => {
    for (const options of [
        { detail: { name: '' }, routeName: '' },
        { missingParent: true },
        { type: 'sdk_integration' }
    ]) {
        const harness = createHarness(options);
        await harness.open();
        assert.match(harness.html(), /无法取得原配置名称|没有关联配置 id|暂不支持/);
        assert.equal(writes(harness).length, 0);
        assertNoNavigation(harness);
    }
});

test('SDK execution requires typing the parent configuration ID', async () => {
    const harness = createHarness();
    await harness.confirmation();
    const input = harness.document.getElementById('aat-confirm');
    const go = harness.button('解绑并重建');
    assert.equal(go.disabled, true);
    input.value = OLD_ID;
    await input.emit('input');
    await go.click();
    assert.equal(writes(harness).length, 0);
    input.value = PARENT_ID;
    await input.emit('input');
    assert.equal(go.disabled, false);
});

test('repeated clicks and closing the modal cannot interrupt an active rebuild', async () => {
    let release;
    let started;
    const rebuilding = new Promise((resolve) => { started = resolve; });
    const hold = new Promise((resolve) => { release = resolve; });
    const harness = createHarness({ respond(request) {
        if (request.path === '/cms2/sdk/config/module_config/add') {
            started();
            return hold;
        }
    } });
    await harness.confirmation();
    const input = harness.document.getElementById('aat-confirm');
    input.value = PARENT_ID;
    await input.emit('input');
    const go = harness.button('解绑并重建');
    const running = go.click();
    await rebuilding;
    try {
        await go.click();
        await harness.open();
        await harness.document.getElementById('apicmob-apply-template-modal').querySelector('.aat-close').click();
        assert.match(harness.html(), /正在按模板绑定新模组/);
        harness.tick();
        assert.equal(harness.document.getElementById('apicmob-apply-template-btn').disabled, true);
        assert.equal(writes(harness).length, 2);
    } finally {
        release();
        await running;
    }
    assert.equal(pending(harness).moduleId, NEW_ID);
});

test('mismatched or missing SDK associations prevent confirmation', async () => {
    for (const row of [{}, { id: 'another-config', module_config_id: OLD_ID }, { id: PARENT_ID, module_config_id: 'unrelated-module' }]) {
        const harness = createHarness({ respond(request) {
            if (request.path === '/cms2/sdk/config/detail') return success(row);
        } });
        await harness.confirmation();
        assert.match(harness.html(), /找不到|关联模组与页面不一致/);
        assert.equal(writes(harness).length, 0);
        assert.equal(harness.downloads.length, 0);
        assertNoNavigation(harness);
    }
});

test('SDK association is checked again immediately before unbinding', async () => {
    const harness = createHarness({ respond(request, state) {
        if (request.path === '/cms2/sdk/config/detail' && state.sdkQueries > 0) {
            return success({ id: PARENT_ID, module_config_id: 'changed-in-another-tab' });
        }
    } });
    await harness.execute();
    assert.match(harness.html(), /关联模组与页面不一致/);
    assert.equal(writes(harness).length, 0);
    assertNoNavigation(harness);
});

test('SDK detail, deletion, binding and lookup failures stop at their respective stages', async () => {
    for (const phase of ['list', 'delete', 'add', 'lookup']) {
        const harness = createHarness({ respond(request, state) {
            if ((phase === 'list' && request.path === '/cms2/sdk/config/detail')
                || (phase === 'delete' && request.path.endsWith('/module_config/delete'))
                || (phase === 'add' && request.path.endsWith('/module_config/add'))
                || (phase === 'lookup' && state.created && request.path === '/cms2/sdk/config/detail')) {
                return { code: 500, msg: `failed-${phase}` };
            }
        } });
        if (phase === 'list') await harness.confirmation();
        else await harness.execute();
        assert.match(harness.html(), new RegExp(`failed-${phase}`));
        assert.equal(writes(harness).length, { list: 0, delete: 1, add: 2, lookup: 2 }[phase]);
        assertNoNavigation(harness);
        if (phase !== 'list') {
            const before = harness.downloads.length;
            await harness.button('重新下载备份').click();
            assert.equal(harness.downloads.length, before + 1);
        }
        if (phase === 'add') assert.match(harness.html(), /旧模组已解绑，新模组绑定未确认成功/);
        if (phase === 'lookup') assert.match(harness.html(), /自动迁移尚未完成/);
    }
});

test('missing or stale new module IDs do not trigger navigation', async () => {
    for (const id of [null, OLD_ID]) {
        const harness = createHarness({ respond(request, state) {
            if (state.created && request.path === '/cms2/sdk/config/detail') {
                return success({ id: PARENT_ID, module_config_id: id });
            }
        } });
        await harness.execute();
        assert.match(harness.html(), /没能查到它的 id|关联仍是旧模组/);
        assert.equal(writes(harness).length, 2);
        assert.equal(pending(harness).moduleId, '');
        assertNoNavigation(harness);
    }
});

test('storage failure before mutations stops all three workflows', async () => {
    for (const type of [SDK_TYPE, H5_TYPE, '']) {
        const harness = createHarness({ type, failStorage: (key) => key === PENDING_KEY });
        await harness.execute();
        assert.match(harness.html(), /无法暂存旧配置/);
        assert.equal(writes(harness).length, 0);
        assertNoNavigation(harness);
    }
});

test('storage failure after creation keeps the backup and does not navigate', async () => {
    const harness = createHarness({ failStorage: (key, state) => key === PENDING_KEY && state.pendingWrites === 2 });
    await harness.execute();
    assert.match(harness.html(), /迁移数据暂存失败/);
    assert.equal(writes(harness).length, 2);
    assert.equal(pending(harness).moduleId, '');
    assertNoNavigation(harness);
    await harness.button('重新下载备份').click();
    assert.equal(harness.downloads.length, 2);
});

test('only the new module response is migrated, and values remain unsaved', async () => {
    const harness = createHarness();
    await harness.execute();
    const raw = success({ name: NAME, field_list: [field('count', 'number', ''), field('enabled', 'boolean', '')] });
    const wrongModule = harness.xhr(raw, `${NEW_ID}-other`);
    assert.equal(wrongModule.responseText, JSON.stringify(raw));
    assert.equal(harness.storage.has(PENDING_KEY), true);
    const failed = harness.xhr(Object.assign(copy(raw), { code: 500 }));
    assert.equal(JSON.parse(failed.responseText).result.field_list[0].field_value, '');
    assert.equal(harness.storage.has(PENDING_KEY), true);
    const xhr = harness.xhr(raw);
    const merged = JSON.parse(xhr.responseText);
    assert.deepEqual(merged.result.field_list.map((node) => node.field_value), [0, false]);
    assert.equal(xhr.response, xhr.responseText);
    assert.equal(harness.storage.has(PENDING_KEY), false);
    const report = JSON.parse(harness.storage.get(REPORT_KEY));
    assert.equal(report.moduleName, NAME);
    assert.equal(report.report.stats.values, 2);
    harness.tick();
    const panel = harness.document.getElementById('apicmob-apply-template-panel');
    assert.ok(panel);
    assert.match(panel.innerHTML, /结构已更新，迁移值尚未保存/);
    assert.match(panel.innerHTML, /请核对后点击右上角「保存」/);
    assert.equal(writes(harness).length, 2);
    assert.equal(harness.requests.some((request) => request.path.endsWith('/module_config/update')), false);
});

test('runtime switches remove idle UI and restore a single entry without extra polling', async () => {
    let enabled = true;
    const watchers = [];
    const harness = createHarness({ runtime: {
        isEnabled: () => enabled,
        watch: (callback) => watchers.push(callback)
    } });
    await harness.open();
    assert.ok(harness.document.getElementById('apicmob-apply-template-modal'));
    enabled = false;
    watchers.forEach((callback) => callback());
    assert.equal(harness.document.getElementById('apicmob-apply-template-modal'), null);
    assert.equal(harness.document.getElementById('apicmob-apply-template-btn'), null);
    enabled = true;
    watchers.forEach((callback) => callback());
    watchers.forEach((callback) => callback());
    assert.equal(harness.document.querySelectorAll('#apicmob-apply-template-btn').length, 1);
    assert.equal(watchers.length, 1);
    assert.equal(writes(harness).length, 0);
});

test('disabling during migration preserves values and cached XHR responses after pending is consumed', async () => {
    let enabled = true;
    const harness = createHarness({ runtime: { isEnabled: () => enabled, watch() {} } });
    await harness.execute();
    enabled = false;
    const body = success({ field_list: [field('count', 'number', ''), field('enabled', 'boolean', '')] });
    const xhr = harness.xhr(body);
    const firstRead = xhr.responseText;
    assert.deepEqual(JSON.parse(firstRead).result.field_list.map((node) => node.field_value), [0, false]);
    assert.equal(harness.storage.has(PENDING_KEY), false);
    assert.equal(xhr.responseText, firstRead);
    assert.equal(xhr.response, firstRead);
    assert.equal(harness.storage.has(REPORT_KEY), true);
    assert.equal(harness.xhr(body).responseText, JSON.stringify(body));
});

test('disabling preserves recovery controls after a failed rebuild', async () => {
    let enabled = true;
    const watchers = [];
    const harness = createHarness({
        runtime: { isEnabled: () => enabled, watch: (callback) => watchers.push(callback) },
        respond: (request) => request.path === '/cms2/sdk/config/module_config/add'
            ? { code: 500, msg: 'Binding failed' } : undefined
    });
    await harness.execute();
    assert.equal(harness.state.deleted, true);
    enabled = false;
    watchers.forEach((callback) => callback());
    assert.ok(harness.document.getElementById('apicmob-apply-template-modal'));
    const count = harness.downloads.length;
    await harness.button('重新下载备份').click();
    assert.equal(harness.downloads.length, count + 1);
    await harness.button('关闭').click();
    assert.equal(harness.document.getElementById('apicmob-apply-template-modal'), null);
});

test('expired pending migration is not injected', async () => {
    const harness = createHarness();
    await harness.execute();
    const record = pending(harness);
    record.ts = Date.now() - 6 * 60 * 1000;
    harness.storage.set(PENDING_KEY, JSON.stringify(record));
    const body = success({ field_list: [field('count', 'number', '')] });
    assert.equal(harness.xhr(body).responseText, JSON.stringify(body));
    assert.equal(harness.storage.has(PENDING_KEY), false);
    assert.equal(harness.storage.has(REPORT_KEY), false);
});

test('migration retains false and zero, matches nested fields, and reports structural changes', () => {
    const oldFields = [
        field('count', 'number', 0), field('enabled', 'boolean', false),
        field('group', 'object', null, { children: [field('old-key', 'string', 'saved', { name: 'same name' })] }),
        field('changed', 'string', '123'), field('removed', 'string', 'old')
    ];
    const newFields = [
        field('count', 'number', '', { id: 'server-count' }), field('enabled', 'boolean', ''),
        field('group', 'object', null, { children: [field('new-key', 'string', '', { name: 'same name', id: 'server-child' })] }),
        field('changed', 'number', ''), field('added', 'string', '', { preset: 'default', mandatory: 1 })
    ];
    const before = copy(oldFields);
    const report = core.migrateValues(oldFields, newFields);
    assert.deepEqual(report.stats, { values: 3, rows: 0 });
    assert.equal(newFields[0].field_value, 0);
    assert.equal(newFields[0].id, 'server-count');
    assert.equal(newFields[1].field_value, false);
    assert.equal(newFields[2].children[0].field_value, 'saved');
    assert.equal(newFields[2].children[0].id, 'server-child');
    assert.equal(newFields[3].field_value, '');
    assert.equal(newFields[4].field_value, '');
    assert.equal(newFields[4].preset, 'default');
    assert.deepEqual(report.added.map((node) => node.export), ['added']);
    assert.deepEqual(report.removed.map((node) => node.export), ['removed']);
    assert.deepEqual(report.typeChanged.map((node) => [node.oldType, node.type]), [['string', 'number']]);
    assert.deepEqual(oldFields, before);
});

test('nested arrays use the new server row templates while preserving old row values', () => {
    const rowTemplate = [
        field('value', 'number', 'preset', { id: 'server-value' }),
        field('added', 'string', 'preset', { preset: 'fallback' }),
        field('object', 'object', null, { children: [field('flag', 'boolean', 'preset')] }),
        field('tags', 'object_array', null, { template_object_array: [field('label', 'string', '', { id: 'server-label' })] })
    ];
    const oldRows = [
        [field('value', 'number', 0),
            field('object', 'object', null, { children: [field('flag', 'boolean', false)] }),
            field('tags', 'object_array', null, { children_object_array: [[field('label', 'string', 'tag')]] })],
        [field('value', 'number', 2), field('tags', 'object_array', null, { children_object_array: [] })]
    ];
    const oldFields = [field('rows', 'object_array', null, {
        template_object_array: copy(rowTemplate), children_object_array: oldRows
    })];
    const newFields = [field('rows', 'object_array', null, {
        template_object_array: copy(rowTemplate), children_object_array: []
    })];
    const report = core.migrateValues(oldFields, newFields);
    const rows = newFields[0].children_object_array;
    assert.deepEqual(report.stats, { values: 4, rows: 3 });
    assert.equal(rows.length, 2);
    assert.equal(rows[0][0].field_value, 0);
    assert.equal(rows[1][0].field_value, 2);
    assert.equal(rows[0][0].id, 'server-value');
    assert.equal(rows[0][1].field_value, '');
    assert.equal(rows[0][1].preset, 'fallback');
    assert.equal(rows[0][2].children[0].field_value, false);
    assert.equal(rows[0][3].children_object_array[0][0].field_value, 'tag');
    assert.equal(rows[0][3].children_object_array[0][0].id, 'server-label');
    assert.deepEqual(rows[1][3].children_object_array, []);
    assert.deepEqual(newFields[0].template_object_array, rowTemplate);
    assert.notEqual(rows[0][0], rows[1][0]);
});

test('preview uses template array children and matches export paths within the same parent', () => {
    const oldFields = [
        field('rows', 'object_array', null, { template_object_array: [field('shared', 'number', '')] }),
        field('group', 'object', null, { children: [field('other', 'number', 10)] })
    ];
    const template = [
        field('rows', 'object_array', null, { children: [field('shared', 'number', ''), field('added', 'string', '')] }),
        field('group', 'object', null, { children: [field('shared', 'number', '')] })
    ];
    const diff = core.diffSkeleton(oldFields, 'module', template, 'template');
    assert.deepEqual(diff.migrated.map((node) => node.exPath), ['/rows/shared']);
    assert.deepEqual(diff.added.map((node) => node.exPath), ['/rows/added', '/group/shared']);
    assert.deepEqual(diff.removed.map((node) => node.exPath), ['/group/other']);
});
