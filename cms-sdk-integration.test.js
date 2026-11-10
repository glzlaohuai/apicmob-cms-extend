'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const integration = require('./src/features/sdk-integration.js');
const flush = () => new Promise((resolve) => setImmediate(resolve));

const channels = [
    { id: 'default', cohort_id: '', module_config_id: 'module', module_config_json: { request_limit_switch: 0, request_period: 30, request_limit: 1 } },
    { id: 'directed', cohort_id: 'cohort', cohort_name: '瑞安-定向us(麦芽）', module_config_id: '', module_config_json: {} }
];

test('channel controls match the supplied default and directed channel response', () => {
    assert.deepEqual(channels.map(integration.channelControl), [
        { name: '默认渠道', status: '关闭', values: 'request_period=30，request_limit=1' },
        { name: '瑞安-定向us(麦芽）', status: '未配置模组', values: '' }
    ]);
});

test('enabled, missing and unknown switches remain distinct and preserve zero limits', () => {
    const channel = { id: 'unnamed', cohort_id: 'cohort', module_config_id: 'module' };
    assert.equal(integration.channelControl(channel).status, '未配置开关');
    assert.equal(integration.channelControl(channel).name, 'unnamed');
    channel.module_config_json = { request_limit_switch: 1, request_period: 0, request_limit: 0 };
    assert.equal(integration.channelControl(channel).status, '开启');
    assert.equal(integration.channelControl(channel).values, 'request_period=0，request_limit=0');
    for (const value of [null, false, '0', 2]) {
        channel.module_config_json.request_limit_switch = value;
        assert.equal(integration.channelControl(channel).status, `未知值：${JSON.stringify(value)}`);
    }
});

test('default module names append the channel once and preserve manual changes', () => {
    const vm = { headerMessage: { supply_placement_name: 'test', supply_placement_placement_id: '1792704791349911' },
        params: channels[0], addModuleConfig: { name: 'test_1792704791349911' } };
    integration.defaultModuleName(vm);
    integration.defaultModuleName(vm);
    assert.equal(vm.addModuleConfig.name, 'test_1792704791349911_默认渠道');
    vm.addModuleConfig.name = '手动修改';
    integration.defaultModuleName(vm);
    assert.equal(vm.addModuleConfig.name, '手动修改');
    vm.params = channels[1];
    vm.addModuleConfig.name = 'test_1792704791349911';
    integration.defaultModuleName(vm);
    assert.equal(vm.addModuleConfig.name, 'test_1792704791349911_瑞安-定向us(麦芽）');
    vm.params = { id: 'channel-id', cohort_id: 'unnamed' };
    vm.addModuleConfig.name = 'test_1792704791349911';
    integration.defaultModuleName(vm);
    assert.equal(vm.addModuleConfig.name, 'test_1792704791349911_channel-id');
});

function queueHarness() {
    const calls = [];
    const snapshots = [];
    const queue = integration.createQueue((id, signal) => new Promise((resolve, reject) => {
        calls.push({ id, signal, resolve, reject });
    }), (entries) => snapshots.push(entries), AbortController);
    return { queue, calls, snapshots, latest: () => snapshots.at(-1) };
}

test('queue deduplicates IDs and never exceeds four in-flight requests', async () => {
    const h = queueHarness();
    h.queue.begin(['a', 'b', 'c', 'd', 'e', 'a', 'f']);
    await flush();
    assert.equal(h.calls.length, 4);
    assert.equal(h.latest().size, 6);
    h.calls[0].resolve(channels);
    await flush();
    assert.equal(h.calls.length, 5);
    assert.deepEqual(h.latest().get('a'), { status: 'ready', channels });
    h.calls[1].resolve([]);
    await flush();
    assert.equal(h.calls.length, 6);
    h.calls.slice(2).forEach((call) => call.resolve([]));
    await flush();
    assert.equal([...h.latest().values()].every((entry) => entry.status === 'ready'), true);
});

test('new pages abort old requests, drop pending work and ignore late results', async () => {
    const h = queueHarness();
    h.queue.begin(['old1', 'old2', 'old3', 'old4', 'old5']);
    await flush();
    h.queue.begin(['new']);
    await flush();
    assert.equal(h.calls.length, 4);
    assert.equal(h.calls.every((call) => call.signal.aborted), true);
    h.calls[0].resolve(channels);
    await flush();
    assert.equal(h.calls.length, 5);
    assert.equal(h.calls[4].id, 'new');
    assert.deepEqual([...h.latest().keys()], ['new']);
    h.calls[4].resolve([]);
    h.calls.slice(1, 4).forEach((call) => call.reject(new Error('old failure')));
    await flush();
    assert.deepEqual([...h.latest()], [['new', { status: 'ready', channels: [] }]]);
    h.queue.begin(['new']);
    await flush();
    assert.equal(h.calls.length, 6, 'returning to the same integration rereads its configuration');
    h.queue.cancel();
    assert.equal(h.calls[5].signal.aborted, true);
    const count = h.snapshots.length;
    h.calls[5].resolve(channels);
    await flush();
    assert.equal(h.snapshots.length, count, 'disabled or departed pages receive no result updates');
});

test('failed rows retry independently and duplicate retry clicks are ignored', async () => {
    const h = queueHarness();
    h.queue.begin(['a', 'b']);
    await flush();
    h.calls[0].reject(new Error('network failed'));
    h.calls[1].resolve(channels);
    await flush();
    assert.equal(h.latest().get('a').status, 'error');
    h.queue.retry('a');
    h.queue.retry('a');
    h.queue.retry('missing');
    await flush();
    assert.equal(h.calls.length, 3);
    assert.equal(h.latest().get('b').status, 'ready');
    h.calls[2].resolve([]);
    await flush();
    assert.deepEqual(h.latest().get('a'), { status: 'ready', channels: [] });
});

function apiHarness() {
    const calls = [];
    function Xhr() {}
    Xhr.prototype.setRequestHeader = function () {};
    const win = { XMLHttpRequest: Xhr, document: { cookie: 'appic_cms_main_version=8.3.0' }, fetch: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ code: 200, result: channels }) };
    } };
    return { win, calls, request: integration.createApi(win) };
}

test('API performs authenticated read-only requests and reuses the actual CMS version', async () => {
    const h = apiHarness();
    assert.deepEqual(await h.request('id with space'), channels);
    assert.equal(new URL(h.calls[0].url).searchParams.get('id'), 'id with space');
    assert.equal(h.calls[0].options.credentials, 'include');
    assert.equal(h.calls[0].options.method, undefined);
    assert.equal(h.calls[0].options.headers['x-token'], '8.3.0');
    new h.win.XMLHttpRequest().setRequestHeader('X-Token', '8.4.0');
    await h.request('id');
    assert.equal(h.calls[1].options.headers['x-token'], '8.4.0');
});

test('API distinguishes HTTP, login, business, invalid JSON and malformed data failures', async () => {
    const h = apiHarness();
    const cases = [
        [{ ok: false, status: 503 }, /HTTP 503/],
        [{ ok: true, json: async () => ({ code: 401 }) }, /登录态/],
        [{ ok: true, json: async () => ({ code: 500, msg: '业务错误' }) }, /业务错误/],
        [{ ok: true, json: async () => ({ code: 200, result: {} }) }, /数据格式/],
        [{ ok: true, json: async () => { throw new Error('invalid JSON'); } }, /invalid JSON/]
    ];
    for (const [response, expected] of cases) {
        h.win.fetch = async () => response;
        await assert.rejects(h.request('id'), expected);
    }
});

function makeWatched(vm) {
    const watchers = new Set();
    vm.$watch = (get, callback) => {
        const watcher = { get, callback, value: get() };
        watchers.add(watcher);
        return () => watchers.delete(watcher);
    };
    vm.notify = () => watchers.forEach((watcher) => {
        const next = watcher.get();
        if (next !== watcher.value) {
            watcher.value = next;
            watcher.callback(next);
        }
    });
    vm.watchers = watchers;
    return vm;
}

function bootHarness(vm) {
    const { win, calls } = apiHarness();
    const elements = new Map();
    const ticks = [];
    const observers = [];
    let enabled = true;
    elements.set('app', { __vue__: { $children: [vm] } });
    Object.assign(win.document, {
        readyState: 'complete', body: {},
        getElementById: (id) => elements.get(id),
        createElement: () => { const element = { remove: () => elements.delete(element.id) }; return element; },
        head: { appendChild: (element) => elements.set(element.id, element) }
    });
    win.location = { hash: '#/sdk/integration/overview' };
    win.Vue = { observable: (value) => value };
    win.AbortController = AbortController;
    win.console = console;
    win.MutationObserver = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() { this.connected = true; }
        disconnect() { this.connected = false; }
    };
    return {
        win, calls, observers,
        runtime: { isEnabled: () => enabled, watch: (tick) => ticks.push(tick) },
        tick: () => ticks.forEach((tick) => tick()),
        setEnabled: (value) => { enabled = value; }
    };
}

test('overview lifecycle preserves native columns, rereads queries and removes disabled UI', async () => {
    const native = { property: 'supply_placement_name', slots: { default() {} }, editRender: {} };
    let columns = [native];
    const table = {
        getTableColumn: () => ({ collectColumn: columns.slice() }),
        loadColumn: (next) => { columns = next.map((column) => column.property ? column : { ...column, property: column.field }); return Promise.resolve(); }
    };
    const page = makeWatched({
        $options: { name: 'sdk-integration-overview' },
        refWrapper: { $refs: { refTable: table } },
        tabledata: [{ id: 'one' }, { id: 'one' }, { id: 'two' }],
        loadings: { isTableLoading: false }
    });
    const h = bootHarness(page);
    integration.bootOverview(h.win, h.runtime);
    await flush();
    h.tick();
    assert.equal(h.calls.length, 2);
    assert.equal(columns.length, 2);
    assert.equal(columns[0], native, 'native slots and edit state retain their original column');
    page.loadings.isTableLoading = true;
    page.notify();
    h.tick();
    assert.equal(h.calls.length, 2);
    page.tabledata = [{ id: 'three' }];
    page.loadings.isTableLoading = false;
    page.notify();
    await flush();
    assert.equal(h.calls.length, 3);
    assert.equal(new URL(h.calls[2].url).searchParams.get('id'), 'three');
    h.win.location.hash = '#/sdk/integration/overview/details?id=three';
    h.tick();
    assert.deepEqual(columns, [native]);
    assert.equal(page.watchers.size, 0);
    assert.equal(h.observers[0].connected, false);
    h.win.location.hash = '#/sdk/integration/overview';
    h.tick();
    await flush();
    assert.equal(h.calls.length, 4);
    h.setEnabled(false);
    h.tick();
    assert.deepEqual(columns, [native]);
    assert.equal(h.observers[0].connected, false);
    h.setEnabled(true);
    h.tick();
    await flush();
    assert.equal(h.calls.length, 5);
    assert.equal(columns.length, 2);
});

test('naming watches dialog openings, handles reused channels and detaches when disabled', () => {
    const vm = makeWatched({
        $options: { name: 'ChannelModule' }, params: channels[0],
        headerMessage: { supply_placement_name: 'test', supply_placement_placement_id: '1792704791349911' },
        addModuleConfig: { name: '' }, addModuleVisible: false
    });
    const h = bootHarness(vm);
    integration.bootNaming(h.win, h.runtime);
    const open = () => { vm.addModuleConfig.name = 'test_1792704791349911'; vm.addModuleVisible = true; vm.notify(); };
    const close = () => { vm.addModuleVisible = false; vm.notify(); };
    open();
    assert.equal(vm.addModuleConfig.name, 'test_1792704791349911_默认渠道');
    vm.addModuleConfig.name = 'custom';
    h.tick();
    assert.equal(vm.addModuleConfig.name, 'custom');
    close();
    vm.params = channels[1];
    open();
    assert.equal(vm.addModuleConfig.name, 'test_1792704791349911_瑞安-定向us(麦芽）');
    close();
    h.setEnabled(false);
    h.tick();
    assert.equal(vm.watchers.size, 0);
    open();
    assert.equal(vm.addModuleConfig.name, 'test_1792704791349911');
    vm.addModuleConfig.name = 'custom while disabled';
    h.setEnabled(true);
    h.tick();
    assert.equal(vm.addModuleConfig.name, 'custom while disabled');
    h.win.location.hash = '#/dashboard';
    h.tick();
    assert.equal(vm.watchers.size, 0);
    assert.equal(h.observers[0].connected, false);
});
