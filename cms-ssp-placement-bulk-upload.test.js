'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('./src/features/ssp-placement-bulk-upload.js');

const TYPE_LIST = [
    { id: 'type-banner', name: 'Banner' },
    { id: 'type-interstitial', name: 'Interstitial' },
    { id: 'type-incentivized', name: 'Incentivized' },
    { id: 'type-native', name: 'Native' },
    { id: 'type-splash', name: 'Splash' }
];

class FakeElement {
    constructor(tagName, options) {
        const opts = options || {};
        this.tagName = String(tagName || 'div').toUpperCase();
        this.className = opts.className || '';
        this.textContent = opts.textContent || '';
        this.children = [];
        this.parentElement = null;
        this.id = '';
        this.type = '';
        this.hidden = false;
        this._innerHTML = '';
    }

    set innerHTML(value) {
        this._innerHTML = String(value);
        this.textContent = this._innerHTML.replace(/<[^>]*>/g, '');
    }

    get innerHTML() {
        return this._innerHTML;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    append() {
        Array.from(arguments).forEach((child) => this.appendChild(child));
    }

    insertAdjacentElement(position, child) {
        assert.equal(position, 'afterend');
        const siblings = this.parentElement.children;
        child.parentElement = this.parentElement;
        siblings.splice(siblings.indexOf(this) + 1, 0, child);
        return child;
    }

    remove() {
        if (!this.parentElement) {
            return;
        }
        const siblings = this.parentElement.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentElement = null;
    }

    addEventListener() {}

    getClientRects() {
        return this.hidden ? [] : [{}];
    }

    matches(selector) {
        if (selector === '.appic-sp-show-row') {
            return this.className.split(/\s+/).includes('appic-sp-show-row');
        }
        if (selector === 'button.el-button') {
            return this.tagName === 'BUTTON' && this.className.split(/\s+/).includes('el-button');
        }
        if (selector === 'button') {
            return this.tagName === 'BUTTON';
        }
        if (selector === '.appic-table-toolbar' || selector === '.vxe-toolbar') {
            return this.className.split(/\s+/).includes(selector.slice(1));
        }
        return false;
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (current.matches(selector)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    querySelectorAll(selector) {
        const selectors = selector.split(',').map((item) => item.trim());
        const output = [];
        const visit = (node) => {
            node.children.forEach((child) => {
                if (selectors.some((item) => child.matches(item))) {
                    output.push(child);
                }
                visit(child);
            });
        };
        visit(this);
        return output;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
}

function createInjectionHarness(options) {
    const opts = options || {};
    const documentElement = new FakeElement('html');
    const head = documentElement.appendChild(new FakeElement('head'));
    const body = documentElement.appendChild(new FakeElement('body'));
    const panel = body.appendChild(new FakeElement('section', {
        className: 'appic-sp-show-row',
        textContent: '应用 广告位名称 结算模式'
    }));
    const toolbar = panel.appendChild(new FakeElement('div', { className: 'appic-table-toolbar' }));
    toolbar.appendChild(new FakeElement('button', {
        className: 'el-button',
        textContent: opts.nativeActionLabel || '查询'
    }));

    const document = {
        readyState: 'complete',
        documentElement,
        head,
        body,
        cookie: '',
        createElement: (tagName) => new FakeElement(tagName),
        addEventListener() {},
        querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
        getElementById(id) {
            let found = null;
            const visit = (node) => {
                if (node.id === id) {
                    found = node;
                    return;
                }
                node.children.forEach((child) => {
                    if (!found) {
                        visit(child);
                    }
                });
            };
            visit(documentElement);
            return found;
        }
    };
    const win = {
        document,
        location: {
            hostname: 'cms.apicmob.com',
            hash: '#/ssp/media-details?id=publisher-1&interface=sdk'
        },
        history: {
            pushState() {},
            replaceState() {}
        },
        addEventListener() {},
        setInterval() { return 1; },
        setTimeout(callback) { callback(); return 1; },
        clearTimeout() {},
        alert() {}
    };
    return { document, panel, toolbar, win };
}

function validMatrix() {
    return [
        core.HEADERS,
        ['Home', 'banner', 'cpm', 2.5, '', ''],
        ['Open', 'interstitial', 'bidding', '', 1, 8],
        ['Reward', 'incentivized', 'bidding', '', 2, 10],
        ['Feed', 'native', 'cpm', 1, '', ''],
        ['Launch', 'splash', 'cpm', 3, '', '']
    ];
}

test('injects the bulk upload button when the native add button is unavailable', () => {
    const harness = createInjectionHarness({ nativeActionLabel: '查询' });

    core.boot(harness.win);

    assert.ok(harness.document.getElementById('apicmob-placement-bulk-upload-btn'));
});

test('exports the feature without injecting UI until explicitly started', () => {
    const harness = createInjectionHarness({ nativeActionLabel: '新增' });
    const source = fs.readFileSync(require.resolve('./src/features/ssp-placement-bulk-upload.js'), 'utf8');
    const context = {
        module: { exports: {} },
        window: harness.win,
        URL,
        URLSearchParams,
        console
    };

    vm.runInNewContext(source, context);

    assert.equal(harness.document.getElementById('apicmob-placement-bulk-upload-btn'), null);
    context.module.exports.boot(harness.win);
    assert.ok(harness.document.getElementById('apicmob-placement-bulk-upload-btn'));
});

test('runtime switch removes and restores the bulk entry without duplicate UI or polling', () => {
    const harness = createInjectionHarness({ nativeActionLabel: '新增' });
    let enabled = true;
    const watchers = [];
    let intervalCount = 0;
    harness.win.setInterval = () => { intervalCount += 1; };
    core.boot(harness.win, { isEnabled: () => enabled, watch: (callback) => watchers.push(callback) });
    assert.ok(harness.document.getElementById('apicmob-placement-bulk-upload-btn'));
    enabled = false;
    watchers.forEach((callback) => callback());
    assert.equal(harness.document.getElementById('apicmob-placement-bulk-upload-btn'), null);
    enabled = true;
    watchers.forEach((callback) => callback());
    watchers.forEach((callback) => callback());
    assert.equal(harness.toolbar.children.filter((child) => child.id === 'apicmob-placement-bulk-upload-btn').length, 1);
    assert.equal(intervalCount, 0);
    assert.equal(watchers.length, 1);
});

test('normalizes all supported types and applies initial default sizes', () => {
    const rows = core.normalizeRows(validMatrix(), { prefix: 'Loklok', appName: 'Fallback' });

    assert.deepEqual(rows.map((row) => [row.type, row.width, row.height]), [
        ['banner', 320, 50],
        ['interstitial', 9, 16],
        ['incentivized', 9, 16],
        ['native', 9, 16],
        ['splash', 9, 16]
    ]);
});

test('parses positive integer sizes with common separators and rejects malformed sizes', () => {
    for (const value of ['320x50', '320X50', ' 320 × 50 ', '320*50']) {
        assert.deepEqual(core.parseSize(value), { width: 320, height: 50 });
    }
    for (const value of ['', null, 320, '320', '320x', 'x50', '0x50', '-1x50',
        '320x0', '320x-1', '1.5x50', '320:50', '320x50px', '1e3x50',
        '9007199254740992x50', '320x9007199254740992']) {
        assert.equal(core.parseSize(value), null, String(value));
    }
});

test('uses configured sizes for blank cells and Excel sizes for overrides', () => {
    const typeConfig = {
        banner: { width: 728, height: 90 },
        interstitial: { width: 1080, height: 1920 },
        native: { width: 1200, height: 628 }
    };
    const rows = core.normalizeRows([
        core.HEADERS,
        ['DefaultBanner', ' Banner ', 'cpm', 1, '', '', ''],
        ['CustomBanner', 'banner', 'cpm', 1, '', '', '640x100'],
        ['DefaultInterstitial', 'interstitial', 'bidding', '', 1, 8, '  '],
        ['CustomNative', 'native', 'cpm', 1, '', '', ' 1080 × 1920 '],
        ['DefaultNative', 'native', 'cpm', 1, '', ''],
        ['InitialSplash', 'splash', 'cpm', 1, '', '', '']
    ], { appName: 'App', typeConfig });

    assert.deepEqual(rows.map((row) => [row.status, row.width, row.height]), [
        ['ready', 728, 90],
        ['ready', 640, 100],
        ['ready', 1080, 1920],
        ['ready', 1080, 1920],
        ['ready', 1200, 628],
        ['ready', 9, 16]
    ]);
    core.resolveTypeIds(rows, TYPE_LIST);
    for (const row of rows) {
        const payload = core.buildPlacementPayload(row, { publisherId: 'publisher-1', appId: 'app-1' });
        assert.equal(payload.width, row.width);
        assert.equal(payload.height, row.height);
    }
    assert.deepEqual(typeConfig.banner, { width: 728, height: 90 });
    assert.deepEqual(core.TYPE_CONFIG.banner, { width: 320, height: 50 });
});

test('keeps six-column templates compatible with configured default sizes', () => {
    const matrix = validMatrix();
    matrix[0] = ['名称', '广告类型', '结算模式', '固定价格', '最低价格', '最高价格'];
    const rows = core.normalizeRows(matrix, {
        appName: 'App',
        typeConfig: { banner: { width: 728, height: 90 } }
    });
    assert.equal(rows[0].width, 728);
    assert.equal(rows[0].height, 90);
    assert.ok(rows.every((row) => row.status === 'ready'));
    assert.doesNotThrow(() => core.validateHeaders(matrix[0].concat('', '')));
    assert.doesNotThrow(() => core.validateHeaders(core.HEADERS.concat('', '')));
});

test('marks nonblank invalid Excel sizes as invalid without falling back to defaults', () => {
    const rows = core.normalizeRows([
        core.HEADERS,
        ...['0x50', '320x', '320x-50', '1.5x50', 'auto'].map((size, index) => (
            [`Invalid${index}`, 'banner', 'cpm', 1, '', '', size]
        ))
    ], { appName: 'App' });
    for (const row of rows) {
        assert.equal(row.status, 'invalid');
        assert.match(row.reason, /尺寸格式/);
        assert.equal(row.width, undefined);
        assert.equal(row.height, undefined);
    }
});

test('persists all type sizes locally and reloads them for later imports', () => {
    const storage = new Map();
    const win = { localStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value)
    } };
    assert.deepEqual(core.readTypeConfig(win), core.TYPE_CONFIG);
    const config = core.normalizeTypeConfig(null);
    config.banner = { width: '728', height: '90' };
    config.native = { width: 1200, height: 628 };
    const saved = core.saveTypeConfig(win, config);
    assert.deepEqual(saved.banner, { width: 728, height: 90 });
    assert.deepEqual(JSON.parse(storage.get(core.TYPE_CONFIG_KEY)), saved);
    const reloaded = core.readTypeConfig(win);
    assert.deepEqual(reloaded, saved);
    const row = core.normalizeRows(validMatrix(), { appName: 'App', typeConfig: reloaded })[0];
    assert.equal(row.width, 728);
    assert.equal(row.height, 90);

    const previous = storage.get(core.TYPE_CONFIG_KEY);
    config.native.width = 0;
    assert.throws(() => core.saveTypeConfig(win, config), /native.*正整数/);
    assert.equal(storage.get(core.TYPE_CONFIG_KEY), previous);
    core.saveTypeConfig(win, core.TYPE_CONFIG);
    assert.deepEqual(core.readTypeConfig(win), core.TYPE_CONFIG);
});

test('recovers from missing, corrupted and inaccessible local size settings', () => {
    for (const raw of [null, 'invalid JSON', 'null', '[]', '42', '{}']) {
        assert.deepEqual(core.readTypeConfig({ localStorage: { getItem: () => raw } }), core.TYPE_CONFIG);
    }
    const config = core.readTypeConfig({ localStorage: { getItem: () => JSON.stringify({
        banner: { width: 728, height: 90 },
        native: { width: 0, height: 628 },
        splash: { width: 'bad', height: 16 },
        unknown: { width: 1, height: 1 }
    }) } });
    assert.deepEqual(config, { ...core.TYPE_CONFIG, banner: { width: 728, height: 90 } });
    const denied = {};
    Object.defineProperty(denied, 'localStorage', { get() { throw new Error('Access denied'); } });
    assert.deepEqual(core.readTypeConfig(denied), core.TYPE_CONFIG);
    assert.throws(() => core.saveTypeConfig(denied, core.TYPE_CONFIG), /Access denied/);
});

test('rejects reward and requires incentivized', () => {
    const rows = core.normalizeRows([
        core.HEADERS,
        ['Reward', 'reward', 'cpm', 2, '', '']
    ], { prefix: 'Loklok', appName: 'Fallback' });

    assert.equal(rows[0].status, 'invalid');
    assert.match(rows[0].reason, /reward 已停用/);
});

test('validates the fixed header order and rejects extra columns', () => {
    assert.throws(() => core.normalizeRows([
        ['广告类型', '名称', '结算模式', '固定价格', '最低价格', '最高价格']
    ]), /第一行必须严格/);

    assert.throws(() => core.normalizeRows([
        core.HEADERS.concat('备注')
    ]), /第一行必须严格/);
    assert.throws(() => core.normalizeRows([
        core.HEADERS.slice(0, -1).concat('备注')
    ]), /第一行必须严格/);
});

test('validates CPM and Bidding price columns', () => {
    const rows = core.normalizeRows([
        core.HEADERS,
        ['CpmMissing', 'banner', 'cpm', '', '', ''],
        ['CpmRange', 'banner', 'cpm', 1, 0, 2],
        ['BidFixed', 'native', 'bidding', 1, 0, 2],
        ['BidReverse', 'splash', 'bidding', '', 5, 2]
    ], { prefix: 'P', appName: 'A' });

    assert.deepEqual(rows.map((row) => row.status), ['invalid', 'invalid', 'invalid', 'invalid']);
    assert.match(rows[0].reason, /固定价格/);
    assert.match(rows[1].reason, /必须留空/);
    assert.match(rows[2].reason, /固定价格必须留空/);
    assert.match(rows[3].reason, /最高价格不能小于最低价格/);
});

test('builds names with prefix fallback and normalized prices', () => {
    assert.equal(core.buildPlacementName(' Loklok ', 'App', ' Home ', 'cpm', 2.50), 'Loklok-Home-2.5');
    assert.equal(core.buildPlacementName('', ' App Name ', 'Reward', 'bidding', null), 'App Name-Reward-bidding');
});

test('includes normalized placement types only when the naming switch is enabled', () => {
    assert.equal(core.buildPlacementName('P', 'App', 'Home', 'cpm', 2.5, ' Banner ', true), 'P-Home-banner-2.5');
    assert.equal(core.buildPlacementName('', ' App ', 'Home', 'bidding', null, 'native', true), 'App-Home-native-bidding');
    assert.equal(core.buildPlacementName('P', 'App', 'Home', 'cpm', 2.5, 'banner', false), 'P-Home-2.5');

    const rows = core.normalizeRows(validMatrix(), { prefix: 'P', appName: 'App', includeType: true });
    assert.deepEqual(rows.map((row) => row.name), [
        'P-Home-banner-2.5',
        'P-Open-interstitial-bidding',
        'P-Reward-incentivized-bidding',
        'P-Feed-native-1',
        'P-Launch-splash-3'
    ]);
});

test('prefix and placement type switches independently control generated names', () => {
    const matrix = [
        core.HEADERS,
        ['Home', 'banner', 'cpm', 2.5, '', ''],
        ['Feed', 'native', 'bidding', '', 1, 8]
    ];
    for (const prefix of ['Custom', '']) {
        for (const includePrefix of [true, false]) {
            for (const includeType of [true, false]) {
                const rows = core.normalizeRows(matrix, { prefix, appName: 'App', includePrefix, includeType });
                const start = includePrefix ? `${prefix || 'App'}-` : '';
                assert.deepEqual(rows.map((row) => row.name), [
                    `${start}Home-${includeType ? 'banner-' : ''}2.5`,
                    `${start}Feed-${includeType ? 'native-' : ''}bidding`
                ]);
            }
        }
    }
});

test('type names distinguish different types while still rejecting duplicates of the same type', () => {
    const matrix = [
        core.HEADERS,
        ['Home', 'banner', 'cpm', 2, '', ''],
        ['Home', 'interstitial', 'cpm', 2, '', '']
    ];
    const options = { prefix: 'P', appName: 'A', includeType: true };
    assert.deepEqual(core.normalizeRows(matrix, options).map((row) => row.status), ['ready', 'ready']);
    matrix.push(['Home', 'banner', 'cpm', 2, '', '']);
    assert.deepEqual(core.normalizeRows(matrix, options).map((row) => row.status), ['invalid', 'ready', 'invalid']);
});

test('detects duplicate generated names inside one workbook', () => {
    const rows = core.normalizeRows([
        core.HEADERS,
        ['Home', 'banner', 'cpm', 2, '', ''],
        ['Home', 'interstitial', 'cpm', 2, '', '']
    ], { prefix: 'P', appName: 'A' });

    assert.deepEqual(rows.map((row) => row.status), ['invalid', 'invalid']);
    assert.match(rows[0].reason, /重复广告位名称/);
});

test('resolves CMS type IDs without creating custom types', () => {
    const rows = core.normalizeRows(validMatrix(), { prefix: 'P', appName: 'A' });
    core.resolveTypeIds(rows, TYPE_LIST);

    assert.deepEqual(rows.map((row) => row.placementTypeId), [
        'type-banner',
        'type-interstitial',
        'type-incentivized',
        'type-native',
        'type-splash'
    ]);

    const missing = core.normalizeRows([
        core.HEADERS,
        ['Native', 'native', 'cpm', 1, '', '']
    ], { prefix: 'P', appName: 'A' });
    core.resolveTypeIds(missing, []);
    assert.equal(missing[0].status, 'invalid');
    assert.match(missing[0].reason, /找不到 native/);
});

test('builds placement and settlement payloads', () => {
    const rows = core.normalizeRows([
        core.HEADERS,
        ['Home', 'banner', 'cpm', 2.5, '', ''],
        ['Open', 'splash', 'bidding', '', 1, 8]
    ], { prefix: 'P', appName: 'A' });
    core.resolveTypeIds(rows, TYPE_LIST);

    assert.deepEqual(core.buildPlacementPayload(rows[0], {
        publisherId: 'publisher-1',
        appId: 'app-1'
    }), {
        publisher_id: 'publisher-1',
        placement_id: '',
        publisher_app_id: 'app-1',
        placement_type_id: 'type-banner',
        placement_type_type: '',
        name: 'P-Home-2.5',
        unit: null,
        actions: '1,3,5',
        private: 0,
        settlement: [],
        width: 320,
        height: 50
    });

    assert.deepEqual(core.buildSettlementPayload(rows[0], 'placement-1'), {
        publisher_placement_id: 'placement-1',
        unit: 2,
        settle: 2.5,
        settle_min: 0,
        settle_max: 0,
        country: 'ALL',
        valid_from: '',
        valid_to: ''
    });
    assert.deepEqual(core.buildSettlementPayload(rows[1], 'placement-2'), {
        publisher_placement_id: 'placement-2',
        unit: 4,
        settle: 0,
        settle_min: 1,
        settle_max: 8,
        country: 'ALL',
        valid_from: '',
        valid_to: ''
    });
});

test('extracts returned placement IDs without treating false as an ID', () => {
    assert.equal(core.extractCreatedId({ result: { id: 'placement-1' } }), 'placement-1');
    assert.equal(core.extractCreatedId({ result: 'placement-2' }), 'placement-2');
    assert.equal(core.extractCreatedId({ result: null }), '');
    assert.equal(core.extractCreatedId({ result: {} }), '');
});

test('skips every existing name even when its settlement configuration differs', () => {
    const rows = core.normalizeRows([
        core.HEADERS,
        ['Home', 'banner', 'cpm', 2.5, '', ''],
        ['Open', 'splash', 'bidding', '', 1, 8]
    ], { prefix: 'P', appName: 'A' });
    core.resolveTypeIds(rows, TYPE_LIST);

    const exact = {
        id: 'existing-1',
        name: rows[0].name,
        publisher_app_id: 'app-1',
        placement_type_id: 'type-banner',
        width: 320,
        height: 50,
        unit: 2,
        private: 0,
        actions: '1,3,5',
        status: 'suspend',
        settlement: [{
            country: 'ALL',
            unit: 2,
            settle: 2.5,
            settle_min: 0,
            settle_max: 0,
            valid_from: '',
            valid_to: ''
        }]
    };
    const conflict = {
        id: 'existing-2',
        name: rows[1].name,
        publisher_app_id: 'app-1',
        placement_type_id: 'type-splash',
        width: 9,
        height: 16,
        unit: 4,
        private: 0,
        actions: '1,3,5',
        settlement: [{
            country: 'ALL',
            unit: 4,
            settle: 0,
            settle_min: 2,
            settle_max: 8,
            valid_from: '',
            valid_to: ''
        }]
    };

    core.classifyRows(rows, [exact, conflict], { appId: 'app-1' });
    assert.equal(rows[0].status, 'skipped');
    assert.match(rows[0].reason, /保留当前启用状态/);
    assert.equal(rows[1].status, 'skipped');
    assert.equal(rows[1].placementId, 'existing-2');
});

test('rechecks names before creation and skips records left by interrupted uploads', async () => {
    const row = core.normalizeRows(validMatrix(), { appName: 'App' })[0];
    const calls = [];
    const context = {
        appId: 'app-1',
        findExistingPlacements: async (name) => {
            calls.push('check');
            assert.equal(name, row.name);
            return [{ id: 'unfinished-id', name, publisher_app_id: 'app-1', settlement: [] }];
        },
        api: {
            addPlacement: async () => { calls.push('add'); return { result: { id: 'duplicate-id' } }; },
            setSettlementMode: async () => calls.push('mode'),
            addSettlement: async () => calls.push('settlement'),
            activatePlacement: async () => calls.push('activation'),
            syncPlacement: async () => calls.push('sync')
        }
    };
    const result = await core.executePlacementRow(row, context);
    assert.deepEqual(calls, ['check']);
    assert.equal(result.skipped, true);
    assert.equal(result.placementId, 'unfinished-id');
});

test('checks exact names within the selected app and reports all existing duplicate IDs', () => {
    const rows = core.normalizeRows(validMatrix(), { appName: 'App' });
    core.classifyRows(rows, [
        { id: 'unfinished', name: ` ${rows[0].name} `, publisher_app_id: 'app-1' },
        { id: 'another-app', name: rows[1].name, publisher_app_id: 'app-2' },
        { id: 'similar-name', name: `${rows[2].name}-other`, publisher_app_id: 'app-1' },
        { id: 'duplicate-1', name: rows[3].name, publisher_app_id: 'app-1' },
        { id: 'duplicate-2', name: rows[3].name, publisher_app_id: 'app-1' }
    ], { appId: 'app-1' });
    assert.deepEqual(rows.map((row) => row.status), ['skipped', 'ready', 'ready', 'skipped', 'ready']);
    assert.equal(rows[0].placementId, 'unfinished');
    assert.match(rows[3].reason, /2 个同名广告位/);
    assert.match(rows[3].reason, /duplicate-1、duplicate-2/);
});

test('a failed name lookup prevents all creation requests', async () => {
    const row = core.normalizeRows(validMatrix(), { appName: 'App' })[0];
    const calls = [];
    await assert.rejects(core.executePlacementRow(row, {
        appId: 'app-1',
        findExistingPlacements: async () => { throw new Error('lookup unavailable'); },
        api: {
            addPlacement: async () => { calls.push('add'); return { result: { id: 'new-id' } }; },
            setSettlementMode: async () => calls.push('mode'),
            addSettlement: async () => calls.push('settlement'),
            activatePlacement: async () => calls.push('activation'),
            syncPlacement: async () => calls.push('sync')
        }
    }), (error) => {
        assert.equal(error.bulkStage, 'check');
        assert.equal(error.placementId, '');
        assert.match(error.message, /lookup unavailable/);
        return true;
    });
    assert.deepEqual(calls, []);
});

test('a malformed name lookup fails before any creation request', async () => {
    const row = core.normalizeRows(validMatrix(), { appName: 'App' })[0];
    let created = false;
    await assert.rejects(core.executePlacementRow(row, {
        appId: 'app-1',
        findExistingPlacements: async () => ({ list: [] }),
        api: { addPlacement: async () => { created = true; } }
    }), (error) => {
        assert.equal(error.bulkStage, 'check');
        assert.match(error.message, /数据格式异常/);
        return true;
    });
    assert.equal(created, false);
});

test('waits for the fresh name lookup before deciding whether to create', async () => {
    const row = core.normalizeRows(validMatrix(), { appName: 'App' })[0];
    let finishLookup;
    let created = false;
    const execution = core.executePlacementRow(row, {
        appId: 'app-1',
        findExistingPlacements: () => new Promise((resolve) => { finishLookup = resolve; }),
        api: { addPlacement: async () => { created = true; } }
    });
    assert.equal(created, false);
    finishLookup([{ id: 'appeared-later', name: row.name }]);
    const result = await execution;
    assert.equal(result.skipped, true);
    assert.equal(result.placementId, 'appeared-later');
    assert.equal(created, false);
});

test('executes name check, add, settlement mode, settlement, activation, then sync in order', async () => {
    const rows = core.normalizeRows([
        core.HEADERS,
        ['Home', 'banner', 'cpm', 2.5, '', '']
    ], { prefix: 'P', appName: 'A' });
    core.resolveTypeIds(rows, TYPE_LIST);
    const calls = [];

    const result = await core.executePlacementRow(rows[0], {
        publisherId: 'publisher-1',
        appId: 'app-1',
        knownIds: new Set(),
        findExistingPlacements: async () => { calls.push(['check']); return []; },
        api: {
            addPlacement: async (payload) => {
                calls.push(['add', payload]);
                return { code: 200, result: { id: 'placement-1' } };
            },
            setSettlementMode: async (payload) => calls.push(['mode', payload]),
            addSettlement: async (payload) => calls.push(['settlement', payload]),
            activatePlacement: async (payload) => calls.push(['activation', payload]),
            syncPlacement: async (payload) => calls.push(['sync', payload])
        },
        resolveCreatedId: async () => assert.fail('fallback ID lookup should not run')
    });

    assert.equal(result.placementId, 'placement-1');
    assert.deepEqual(calls.map(([name]) => name), ['check', 'add', 'mode', 'settlement', 'activation', 'sync']);
    assert.deepEqual(calls[4][1], { id: 'placement-1', status: 'active' });
    assert.deepEqual(calls[5][1], { id: 'placement-1' });
});

test('uses fallback ID lookup and reports activation as a partial stage', async () => {
    const rows = core.normalizeRows([
        core.HEADERS,
        ['Open', 'interstitial', 'bidding', '', 1, 8]
    ], { prefix: 'P', appName: 'A' });
    core.resolveTypeIds(rows, TYPE_LIST);
    const calls = [];

    await assert.rejects(core.executePlacementRow(rows[0], {
        publisherId: 'publisher-1',
        appId: 'app-1',
        knownIds: new Set(['old-id']),
        findExistingPlacements: async () => [],
        api: {
            addPlacement: async () => ({ code: 200, result: null }),
            setSettlementMode: async () => calls.push('mode'),
            addSettlement: async () => calls.push('settlement'),
            activatePlacement: async () => {
                calls.push('activation');
                throw new Error('cannot activate');
            },
            syncPlacement: async () => assert.fail('sync must not run after activation fails')
        },
        resolveCreatedId: async () => 'new-id'
    }), (error) => {
        assert.equal(error.bulkStage, 'activation');
        assert.equal(error.placementId, 'new-id');
        assert.match(error.message, /cannot activate/);
        return true;
    });

    assert.deepEqual(calls, ['mode', 'settlement', 'activation']);
});

test('waits for sync and preserves the created ID when sync fails', async () => {
    const row = core.normalizeRows(validMatrix(), { appName: 'App' })[0];
    core.resolveTypeIds([row], TYPE_LIST);
    const phases = [];
    const knownIds = new Set();
    let rejectSync;
    let signalSync;
    const syncStarted = new Promise((resolve) => { signalSync = resolve; });
    const syncResponse = new Promise((resolve, reject) => { rejectSync = reject; });
    let finished = false;
    const execution = core.executePlacementRow(row, {
        publisherId: 'publisher-1',
        appId: 'app-1',
        knownIds,
        findExistingPlacements: async () => [],
        onPhase: (phase) => phases.push(phase),
        api: {
            addPlacement: async () => ({ result: null }),
            setSettlementMode: async () => {},
            addSettlement: async () => {},
            activatePlacement: async () => {},
            syncPlacement: async (payload) => {
                assert.deepEqual(payload, { id: 'resolved-id' });
                signalSync();
                return syncResponse;
            }
        },
        resolveCreatedId: async () => 'resolved-id'
    });
    execution.then(() => { finished = true; }, () => { finished = true; });

    await syncStarted;
    assert.equal(finished, false);
    assert.equal(phases.at(-1), '正在同步广告位');
    assert.equal(knownIds.has('resolved-id'), true);
    rejectSync(new Error('sync unavailable'));
    await assert.rejects(execution, (error) => {
        assert.equal(error.bulkStage, 'sync');
        assert.equal(error.placementId, 'resolved-id');
        assert.match(error.message, /sync unavailable/);
        return true;
    });
});
