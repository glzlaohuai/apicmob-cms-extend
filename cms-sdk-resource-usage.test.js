'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('./src/features/sdk-resource-replace');
const usage = require('./src/features/sdk-resource-usage');

const source = { id: 'def-old', resource: 'banner', remark: 'family-A', resource_ver: '', status: 'active' };
const target = { ...source, id: 'def-new', resource_ver: '01' };
const envelope = (list, count = list.length) => ({ code: 200, count, result: { list: structuredClone(list) } });

function fixture(options = {}) {
    const apps = [{ id: 'app-1', name: 'App' }, { id: 'app-2', name: 'App' }];
    const configs = [1, 2, 3, 4].map((type, index) => ({ id: 'config-' + type,
        supply_app_id: apps[index % 2].id, name: 'Config', type, status: type === 2 ? 'suspend' : 'active', product_mode: 0 }));
    const rows = new Map();
    for (const config of configs) {
        for (const channel of ['resource', 'resource2']) {
            rows.set(`${config.id}/${channel}`, [{ id: `${config.id}-${channel}-old`, config_id: config.id,
                resource_id: source.id, resource_resource: source.resource, resource_remark: source.remark,
                resource_resource_ver: source.resource_ver, status: 'active', weight: channel === 'resource' ? 37 : 63 },
            { id: `${config.id}-${channel}-other`, config_id: config.id, resource_id: 'other-def',
                resource_resource: 'banner2', resource_remark: 'family-A', resource_resource_ver: '', status: 'active', weight: 11 }]);
        }
    }
    const calls = [];
    let serial = 0;
    const definitions = structuredClone([source, target, { ...target, id: 'wrong-extra', remark: 'family-B' }]);
    const request = async (path, { params, data } = {}) => {
        calls.push({ path, params, data });
        if (options.before) await options.before(path, params, data, { configs, rows, definitions });
        if (options.failRead?.(path, params)) throw new Error('read failed');
        if (path === '/sdk/resource/index') return envelope(definitions);
        if (path === '/sdk/resource/app_index') return envelope(apps);
        if (path === '/sdk/config/all') return envelope(options.foreignList && params.supply_app_id === 'app-1'
            ? [configs[1]] : configs.filter((row) => row.supply_app_id === params.supply_app_id), 0);
        if (path === '/sdk/config/detail') return { result: structuredClone(configs.find((row) => row.id === params.id)) };
        if (path === '/sdk/config/version/select') return envelope([
            { id: 'ver-1', version: '3.5.1', release_version: '5.5.2.5', activity: 12 },
            { id: 'ver-2', version: '3.5.0', release_version: '5.5.2.5', activity: 0 },
            { id: 'ver-3', version: '3.4.4', release_version: '5.5.2.4', activity: '2' }
        ]);
        const match = path.match(/^\/sdk\/config\/(resource2?)\/(.+)$/);
        assert.ok(match, path);
        const [, channel, action] = match;
        const key = `${params?.config_id || data?.config_id}/${channel}`;
        if (action === 'index') return envelope(rows.get(key));
        if (action === 'add/index') {
            if (options.noCandidate === params.config_id) return envelope([], 100);
            return envelope([target], 100);
        }
        if (action === 'add/duplication') return envelope(options.duplicate ? [{ id: 'warning' }] : []);
        if (action === 'delete') {
            for (const [name, list] of rows) rows.set(name, list.filter((row) => row.id !== data.id));
        } else if (action === 'add') {
            if (options.failAdd?.(data.config_id, channel)) throw new Error('network failure');
            const configId = data.config_id;
            assert.deepEqual(data.resource_id, [target.id]);
            rows.get(key).push({ id: `new-${++serial}`, config_id: configId, resource_id: target.id,
                resource_resource: target.resource, resource_remark: target.remark, resource_resource_ver: target.resource_ver,
                status: 'active', weight: 100 });
        } else if (action === 'update') {
            for (const list of rows.values()) {
                const row = list.find((row) => row.id === data.id);
                if (row) row.weight = data.weight;
            }
        } else assert.fail(path);
        return { code: 200 };
    };
    return { apps, configs, rows, definitions, request, calls,
        mutations: () => calls.filter(({ data, path }) => data && !path.endsWith('/duplication')) };
}

test('candidates require exact resource and additional info, exclude the source ID, and retain raw versions', () => {
    const candidates = [source, target, { ...target, id: 'wrong', remark: 'family-a' },
        { ...target, id: 'prefix', resource: 'banner2' }, { ...target, id: 'space', remark: 'family-A ' }];
    assert.deepEqual(core.matchingResources(candidates, source), [target]);
    assert.deepEqual(core.matchingResources(candidates, { resource_id: source.id,
        resource_resource: source.resource, resource_remark: source.remark }), [target]);
    assert.equal(core.matchingResources([{ ...target, remark: '' }], { ...source, remark: null }).length, 1);
    assert.equal(core.matchingResources(candidates, { ...source, remark: '' }).length, 0);
});

test('finds exact definition references across Apps and both channels with all four config types', async () => {
    const api = fixture();
    const read = await usage.readUsage(api.request, source, core);
    assert.equal(read.inventoryComplete, false);
    assert.deepEqual(read.issues, []);
    assert.equal(read.entries.length, 4);
    assert.deepEqual(new Set(read.entries.map((entry) => entry.config.type)), new Set([1, 2, 3, 4]));
    assert.ok(read.entries.every((entry) => entry.references.length === 2));
    assert.ok(read.entries.every((entry) => entry.references.every((ref) => ref.binding.resource_id === source.id)));
    const active = read.entries.find((entry) => entry.config.type === 3);
    assert.deepEqual(active.versions.map((row) => [row.release_version, row.version, row.activity]),
        [['5.5.2.5', '3.5.1', 12], ['5.5.2.4', '3.4.4', '2']]);
    assert.ok(read.entries.filter((entry) => [1, 4].includes(entry.config.type)).every((entry) => entry.versionState === 'na'));
    assert.equal(api.calls.filter(({ path }) => path === '/sdk/config/version/select').length, 2);
    assert.deepEqual(api.mutations(), []);
});

test('keeps partial binding and version errors visible and makes affected references unavailable', async () => {
    const api = fixture({ failRead: (path, params) => (path.endsWith('/resource2/index') && params.config_id === 'config-1')
        || (path.endsWith('/version/select') && params.config_id === 'config-3') });
    const read = await usage.readUsage(api.request, source, core);
    assert.equal(read.issues.length, 2);
    const partial = read.entries.find((entry) => entry.config.id === 'config-1');
    assert.equal(partial.references.length, 1);
    assert.match(usage.unavailable(partial, source), /辅料2.*read failed/);
    const versions = read.entries.find((entry) => entry.config.id === 'config-3');
    assert.equal(versions.versionState, 'error');
    assert.match(usage.unavailable(versions, source), /活跃版本.*read failed/);
});

test('failed App reads and mismatched config ownership never become a clean empty inventory', async () => {
    for (const options of [
        { failRead: (path, params) => path === '/sdk/config/all' && params.supply_app_id === 'app-1' },
        { foreignList: true }
    ]) {
        const api = fixture(options);
        const read = await usage.readUsage(api.request, source, core);
        assert.equal(read.inventoryComplete, false);
        assert.equal(read.issues.length, 1);
        if (options.foreignList) assert.match(read.issues[0], /其他 App/);
        assert.deepEqual(api.mutations(), []);
    }
});

test('stops cancelled reference reads and detects malformed lists and pagination', async () => {
    const api = fixture();
    await assert.rejects(usage.readUsage(api.request, source, core, () => false), /取消/);
    await assert.rejects(usage.readUsage(async () => ({ result: {} }), source, core), /无效/);
    const read = await usage.readUsage(async (path, options) => {
        if (path.endsWith('/resource/index') && options.params.config_id) return envelope([], 2);
        return api.request(path, options);
    }, source, core);
    assert.equal(read.issues.length, 4);
    assert.ok(read.entries.every((entry) => usage.unavailable(entry, source)));
});

test('replaces only selected configs, including both channels, and preserves status, weights and other bindings', async () => {
    const api = fixture();
    const { entries } = await usage.readUsage(api.request, source, core);
    const original = structuredClone([...api.rows]);
    const configs = structuredClone(api.configs);
    const selected = entries.filter((entry) => ['config-2', 'config-4'].includes(entry.config.id));
    const outcome = await usage.replaceBatch(api.request, selected, source, target, core, () => true);
    assert.equal(outcome.stopped, false);
    assert.ok(outcome.results.every((result) => result.status === 'success' && result.completed.length === 2));
    for (const [key, rows] of api.rows) {
        const before = original.find(([name]) => name === key)[1];
        if (key.startsWith('config-2/') || key.startsWith('config-4/')) {
            assert.deepEqual(rows.find((row) => row.resource_id === 'other-def'), before[1]);
            const added = rows.find((row) => row.resource_id === target.id);
            assert.equal(added.weight, before[0].weight);
            assert.ok(!rows.some((row) => row.resource_id === source.id));
        } else assert.deepEqual(rows, before);
    }
    assert.deepEqual(api.configs, configs);
    const preflightCalls = api.calls.slice(0, api.calls.findIndex(({ path }) => path.endsWith('/delete')));
    assert.ok(preflightCalls.some(({ path, params }) => path.endsWith('/add/index') && params.config_id === 'config-4'));
    assert.ok(api.mutations().every(({ path }) => /^\/sdk\/config\/resource2?\/(add|delete|update)$/.test(path)));
});

test('any preflight failure prevents all writes, even when an earlier config passed', async () => {
    const api = fixture({ noCandidate: 'config-2' });
    const { entries } = await usage.readUsage(api.request, source, core);
    const selected = ['config-1', 'config-2'].map((id) => entries.find((entry) => entry.config.id === id));
    const outcome = await usage.replaceBatch(api.request, selected, source, target, core, () => true);
    assert.equal(outcome.stopped, true);
    assert.equal(outcome.started, false);
    assert.deepEqual(outcome.results.map((row) => row.status), ['pending', 'failed']);
    assert.deepEqual(api.mutations(), []);
});

test('stale extra info, suspended target, changed source bindings and changed App ownership prevent mutation', async () => {
    for (const change of [
        (api) => { api.definitions[1].remark = 'different'; },
        (api) => { api.definitions[1].status = 'suspend'; },
        (api) => { api.rows.get('config-1/resource')[0].weight = 40; },
        (api) => { api.configs[0].supply_app_id = 'foreign'; },
        (api) => { api.configs[0].status = 'suspend'; }
    ]) {
        const api = fixture();
        const { entries } = await usage.readUsage(api.request, source, core);
        const targetSnapshot = { ...target };
        change(api);
        const outcome = await usage.replaceBatch(api.request, [entries.find((entry) => entry.config.id === 'config-1')],
            source, targetSnapshot, core, () => true);
        assert.equal(outcome.stopped, true);
        assert.deepEqual(api.mutations(), []);
    }
});

test('a partial second-channel failure stops the batch, retains completed IDs and reads back without retry', async () => {
    const api = fixture({ failAdd: (configId, channel) => configId === 'config-2' && channel === 'resource2' });
    const { entries } = await usage.readUsage(api.request, source, core);
    const selected = ['config-1', 'config-2', 'config-3'].map((id) => entries.find((entry) => entry.config.id === id));
    const outcome = await usage.replaceBatch(api.request, selected, source, target, core, () => true);
    assert.deepEqual(outcome.results.map((row) => row.status), ['success', 'partial', 'pending']);
    assert.equal(outcome.results[1].completed.length, 1);
    assert.match(outcome.results[1].message, /新增目标辅料阶段/);
    assert.match(outcome.results[1].message, /旧绑定已不在，目标未绑定.*未自动重试/);
    assert.equal(api.calls.filter(({ path, data }) => path === '/sdk/config/resource2/add' && data.config_id === 'config-2').length, 1);
    assert.ok(!api.mutations().some(({ data }) => data.config_id === 'config-3' || data.id?.startsWith('config-3')));
});

test('a failed weight restoration reports the new binding ID and actual weight without retrying', async () => {
    const api = fixture({ before: (path) => { if (path.endsWith('/update')) throw new Error('weight failed'); } });
    const { entries } = await usage.readUsage(api.request, source, core);
    const outcome = await usage.replaceBatch(api.request, [entries.find((entry) => entry.config.id === 'config-1')],
        source, target, core, () => true);
    assert.equal(outcome.results[0].status, 'partial');
    assert.match(outcome.results[0].message, /恢复原权重阶段.*目标已绑定（ID new-1，权重 100）/);
    assert.equal(api.calls.filter(({ path }) => path.endsWith('/update')).length, 1);
    assert.equal(api.calls.filter(({ path }) => path.endsWith('/delete')).length, 1);
});

test('navigation or disabling prevents the next delete while an in-progress binding finishes', async () => {
    let enabled = true;
    const api = fixture({ before: (path) => { if (path === '/sdk/config/resource/add') enabled = false; } });
    const { entries } = await usage.readUsage(api.request, source, core);
    const selected = ['config-1', 'config-2'].map((id) => entries.find((entry) => entry.config.id === id));
    const outcome = await usage.replaceBatch(api.request, selected, source, target, core, () => enabled);
    assert.deepEqual(outcome.results.map((row) => row.status), ['partial', 'pending']);
    assert.equal(api.rows.get('config-1/resource').find((row) => row.resource_id === target.id).weight, 37);
    assert.equal(api.rows.get('config-1/resource2')[0].resource_id, source.id);
    assert.equal(api.calls.filter(({ path }) => path.endsWith('/delete')).length, 1);
});

test('resource entry is appended without losing native distribution actions and is restored on disable', () => {
    const native = () => ['应用分布'];
    const column = { property: 'xbc_id', width: '150', slots: { default: native } };
    const columns = [column, ...['resource', 'remark', 'resource_ver'].map((property) => ({ property }))];
    const vm = { isActive: true, handleOpenLinkApplyDrawer() {} };
    const element = { getClientRects: () => [1] };
    element.__vue__ = { $parent: vm, getTableColumn: () => ({ fullColumn: columns }), refreshColumn() {} };
    const win = { location: { hash: '#/sdk/config/resources' }, document: { querySelectorAll: () => [element] }, console };
    let enabled = true;
    let sync;
    usage.boot(win, { isEnabled: () => enabled, watch: (callback) => { sync = callback; } }, core);
    const h = (tag, props, children) => ({ tag, props, children });
    sync();
    sync();
    assert.equal(column.width, 250);
    assert.deepEqual(column.slots.default({ row: {} }, h), ['应用分布']);
    const actions = column.slots.default({ row: source }, h);
    assert.equal(actions.length, 2);
    assert.equal(actions[0], '应用分布');
    assert.deepEqual(actions[1].children, ['引用配置']);
    enabled = false;
    sync();
    assert.equal(column.slots.default, native);
    assert.equal(column.width, '150');
});

function dialogHarness(request) {
    class Element {
        constructor(tag, value = '') {
            this.tag = tag;
            this.value = value;
            this.children = [];
            this.style = {};
            this.dataset = {};
            this.listeners = {};
        }
        set textContent(value) { this.value = value; this.children = []; }
        get textContent() { return this.value + this.children.map((child) => child.textContent).join(''); }
        append(...nodes) { nodes.forEach((node) => { node.parent = this; this.children.push(node); }); }
        replaceChildren(...nodes) { this.children = []; this.value = ''; this.append(...nodes); }
        setAttribute(name, value) { this[name] = value; }
        addEventListener(name, callback) { this.listeners[name] = callback; }
        showModal() { this.open = true; }
        close() { this.open = false; this.listeners.close?.(); }
        remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
        all() { return this.children.flatMap((child) => [child, ...child.all()]); }
        querySelectorAll() { return this.all().filter((child) => child.tag === 'input' && child.dataset.choice); }
    }
    const body = new Element('body');
    const column = { property: 'xbc_id', width: 150, slots: { default: () => [] } };
    const vm = { isActive: true, handleOpenLinkApplyDrawer() {} };
    const table = { $parent: vm, refreshColumn() {},
        getTableColumn: () => ({ fullColumn: [column, ...['resource', 'remark', 'resource_ver'].map((property) => ({ property }))] }) };
    const win = { console, location: { hash: '#/sdk/config/resources' }, document: {
        body, querySelectorAll: () => [{ __vue__: table, getClientRects: () => [1] }],
        createElement: (tag) => new Element(tag), createTextNode: (text) => new Element('#text', text)
    } };
    let sync;
    usage.boot(win, { isEnabled: () => true, watch: (callback) => { sync = callback; } }, { ...core, createRequest: () => request });
    sync();
    const h = (tag, props, children) => ({ tag, props, children });
    column.slots.default({ row: source }, h)[0].props.on.click({ stopPropagation() {} });
    const panel = body.children[0];
    const find = (predicate) => panel.all().find(predicate);
    return { win, panel, sync, find, button: (text) => find((el) => el.tag === 'button' && el.textContent.startsWith(text)) };
}

test('dialog locks duplicate submissions and close attempts, then retains partial results after navigation', async () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let deleting;
    const enteredDelete = new Promise((resolve) => { deleting = resolve; });
    const api = fixture({ before: async (path) => {
        if (path.endsWith('/delete')) { deleting(); await held; }
    } });
    const ui = dialogHarness(api.request);
    await new Promise(setImmediate);
    const submit = ui.button('一键替换');
    assert.equal(submit.disabled, true);
    const config = ui.find((el) => el.dataset.choice === 'config');
    config.checked = true;
    config.onchange();
    assert.equal(submit.disabled, true);
    ui.find((el) => el.dataset.choice === 'target' && el.dataset.unavailable === 'false').onchange();
    assert.equal(submit.disabled, false);
    const execution = submit.onclick();
    await enteredDelete;
    assert.equal(submit.disabled, true);
    assert.equal(ui.button('关闭').disabled, true);
    assert.ok(ui.panel.querySelectorAll().every((input) => input.disabled));
    await submit.onclick();
    ui.button('关闭').onclick();
    let prevented = false;
    ui.panel.listeners.cancel({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(ui.panel.open, true);
    ui.win.location.hash = '#/sdk/config/overview';
    ui.sync();
    release();
    await execution;
    assert.equal(api.calls.filter(({ path }) => path.endsWith('/delete')).length, 1);
    assert.equal(ui.panel.open, true);
    assert.match(ui.panel.textContent, /部分完成/);
    assert.match(ui.panel.textContent, /页面或功能开关已变化/);
    assert.equal(ui.button('关闭').disabled, false);
    ui.button('关闭').onclick();
    assert.equal(ui.panel.open, false);
});
