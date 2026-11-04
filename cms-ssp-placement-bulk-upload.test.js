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

test('normalizes all supported types and applies fixed sizes', () => {
    const rows = core.normalizeRows(validMatrix(), { prefix: 'Loklok', appName: 'Fallback' });

    assert.deepEqual(rows.map((row) => [row.type, row.width, row.height]), [
        ['banner', 320, 50],
        ['interstitial', 9, 16],
        ['incentivized', 9, 16],
        ['native', 9, 16],
        ['splash', 9, 16]
    ]);
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

test('classifies matching records as skipped and different records as conflicts', () => {
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
    assert.equal(rows[1].status, 'conflict');
});

test('executes add, settlement mode, settlement, then activation in order', async () => {
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
        api: {
            addPlacement: async (payload) => {
                calls.push(['add', payload]);
                return { code: 200, result: { id: 'placement-1' } };
            },
            setSettlementMode: async (payload) => calls.push(['mode', payload]),
            addSettlement: async (payload) => calls.push(['settlement', payload]),
            activatePlacement: async (payload) => calls.push(['activation', payload])
        },
        resolveCreatedId: async () => assert.fail('fallback ID lookup should not run')
    });

    assert.equal(result.placementId, 'placement-1');
    assert.deepEqual(calls.map(([name]) => name), ['add', 'mode', 'settlement', 'activation']);
    assert.deepEqual(calls[3][1], { id: 'placement-1', status: 'active' });
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
        api: {
            addPlacement: async () => ({ code: 200, result: null }),
            setSettlementMode: async () => calls.push('mode'),
            addSettlement: async () => calls.push('settlement'),
            activatePlacement: async () => {
                calls.push('activation');
                throw new Error('cannot activate');
            }
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
