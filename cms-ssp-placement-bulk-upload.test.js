'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./cms-ssp-placement-bulk-upload.user.js');

const TYPE_LIST = [
    { id: 'type-banner', name: 'Banner' },
    { id: 'type-interstitial', name: 'Interstitial' },
    { id: 'type-incentivized', name: 'Incentivized' },
    { id: 'type-native', name: 'Native' },
    { id: 'type-splash', name: 'Splash' }
];

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
