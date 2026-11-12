'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./src/features/ssp-placement-bulk-upload.js');

function fixture() {
    const scope = { supplyId: 'supply-1', appId: 'app-1', os: 'android',
        bundleId: 'example.app', networkId: 'network-dsp' };
    const row = { placementId: 'ssp-1', publicPlacementId: '1792704791349911', type: 'banner' };
    const binding = { id: 'binding-1', integration_id: 'integration-1', integration_channel_id: 'default-1',
        network_placement_id: 'dsp-1', integration: 'c2s' };
    const channel = { id: 'default-1', integration_id: 'integration-1', cohort_id: '', cohort_placement_list: [] };
    const candidate = { id: 'dsp-1', network_id: scope.networkId, network_app_id: 'network-app-1',
        placement_id: row.publicPlacementId, placement_type_type: 'banner', network_app_os: scope.os,
        network_app_bundle_id: scope.bundleId, integration: ['c2s', 'c2c'] };
    const lists = {
        '/cms2/sdk/supply/app/index': [{ id: scope.appId, supply_id: scope.supplyId, os: scope.os, bundle_id: scope.bundleId }],
        '/cms2/sdk/supply/placement/index': [{ id: row.placementId, supply_id: scope.supplyId,
            supply_app_id: scope.appId, placement_id: row.publicPlacementId, type: row.type,
            supply_app_os: scope.os, supply_app_bundle_id: scope.bundleId }],
        '/cms2/sdk/integration/index': [{ id: 'integration-1', supply_id: scope.supplyId,
            supply_app_id: scope.appId, supply_placement_id: row.placementId,
            supply_placement_placement_id: row.publicPlacementId }],
        '/cms2/sdk/network/app/index': [{ id: 'network-app-1', network_id: scope.networkId,
            supply_app_id: scope.appId, os: scope.os, bundle_id: scope.bundleId }],
        '/cms2/sdk/network/placement/index': [{ id: 'dsp-1', network_id: scope.networkId,
            network_app_id: 'network-app-1', placement_id: row.publicPlacementId, placement_type_type: row.type }],
        '/cms2/sdk/integration/placement/add/index': [candidate]
    };
    const reads = {
        '/cms2/sdk/supply/all': { result: { list: [{ id: scope.supplyId, publisher_id: 'publisher-1' }] } },
        '/cms2/sdk/network/all': { result: { list: [{ id: scope.networkId, network: 'appicdsp' },
            { id: 'network-adx', network: 'appicadx' }] } },
        '/cms2/sdk/integration/detail': { result: { id: 'integration-1', supply_app_id: scope.appId, supply_placement_id: row.placementId } },
        '/cms2/sdk/integration/detail/list': { result: [channel] }
    };
    const calls = [];
    const api = {
        sdkList: async (path, params) => { calls.push({ method: 'GET', path, params }); return lists[path]; },
        sdkRead: async (path, params) => { calls.push({ method: 'GET', path, params }); return reads[path]; },
        sdkAdd: async (path, data) => {
            calls.push({ method: 'POST', path, data });
            channel.cohort_placement_list.push({ ...binding });
            return { code: 200 };
        }
    };
    const context = { ...api, appId: scope.appId, publisherId: 'publisher-1', readApp: async () => ({ result: {
        id: scope.appId, publisher_id: 'publisher-1', os: scope.os, bundle_id: scope.bundleId
    } }) };
    return { scope, row, binding, channel, candidate, lists, reads, calls, api, context };
}

test('automatic DSP binding defaults on and remembers an explicit off preference', () => {
    assert.equal(core.readAutoDsp({ localStorage: { getItem: () => null } }), true);
    assert.equal(core.readAutoDsp({ localStorage: { getItem: () => 'true' } }), true);
    assert.equal(core.readAutoDsp({ localStorage: { getItem: () => 'false' } }), false);
    assert.equal(core.readAutoDsp({}), true);
});

test('resolves the real publisher supply, matching SDK app and appicdsp network', async () => {
    const f = fixture();
    assert.deepEqual(await core.resolveDspScope(f.context), f.scope);
    assert.ok(f.calls.every((call) => call.method === 'GET'));
    assert.equal(f.calls.find((call) => call.path.endsWith('/supply/app/index')).params.supply_id, 'supply-1');
});

test('scope lookup rejects ambiguous DSP networks, another publisher and a foreign app', async () => {
    const ambiguous = fixture();
    ambiguous.reads['/cms2/sdk/network/all'].result.list.push({ id: 'another-dsp', network: 'appicdsp' });
    await assert.rejects(core.resolveDspScope(ambiguous.context), /appicdsp.*2 条/);
    const foreign = fixture();
    foreign.context.publisherId = 'another-publisher';
    await assert.rejects(core.resolveDspScope(foreign.context), /publisher_id/);
    const app = fixture();
    app.lists['/cms2/sdk/supply/app/index'][0].supply_id = 'another-supply';
    await assert.rejects(core.resolveDspScope(app.context), /supply_id/);
});

test('binds only the matching DSP position to the default channel and verifies the result', async () => {
    const f = fixture();
    f.reads['/cms2/sdk/integration/detail/list'].result.push({ id: 'directed-1',
        integration_id: 'integration-1', cohort_id: 'cohort-1', cohort_placement_list: [] });
    const result = await core.addDspPlacement(f.row, f.scope, f.api);
    assert.deepEqual(result, { skipped: false, networkPlacementId: 'dsp-1' });
    assert.equal(f.row.integrationId, 'integration-1');
    assert.equal(f.row.dspPlacementId, 'dsp-1');
    assert.deepEqual(f.calls.filter((call) => call.method === 'POST'), [{
        method: 'POST', path: '/cms2/sdk/integration/placement/add', data: {
            integration_id: 'integration-1', integration_channel_id: 'default-1',
            network_placement_list: [{ network_placement_id: 'dsp-1', integration: 'c2s' }]
        }
    }]);
    assert.equal(f.calls.at(-1).path, '/cms2/sdk/integration/detail/list');
});

test('existing DSP bindings are checked without another add request', async () => {
    const f = fixture();
    f.channel.cohort_placement_list.push(f.binding);
    const result = await core.addDspPlacement(f.row, f.scope, f.api);
    assert.equal(result.skipped, true);
    assert.ok(f.calls.every((call) => call.method === 'GET'));
    assert.ok(!f.calls.some((call) => call.path.endsWith('/placement/add/index')));
});

test('accepts the current detail page publisher aliases without relaxing target ownership', async () => {
    const f = fixture();
    f.reads['/cms2/sdk/integration/detail'].result = { id: 'integration-1',
        publisher_app_id: f.scope.appId, publisher_placement_id: f.row.placementId };
    await core.addDspPlacement(f.row, f.scope, f.api);
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
});

for (const [name, mutate, error] of [
    ['foreign supply position', (f) => { f.lists['/cms2/sdk/supply/placement/index'][0].supply_app_id = 'foreign'; }, /supply_app_id/],
    ['wrong public position ID', (f) => { f.lists['/cms2/sdk/integration/index'][0].supply_placement_placement_id = 'wrong'; }, /placement_id/],
    ['foreign integration detail', (f) => { f.reads['/cms2/sdk/integration/detail'].result.supply_app_id = 'foreign'; }, /supply_app_id/],
    ['duplicate default channels', (f) => { f.reads['/cms2/sdk/integration/detail/list'].result.push({ ...f.channel, id: 'other-default' }); }, /默认渠道.*2 条/],
    ['missing channel records', (f) => { f.channel.cohort_placement_list = null; }, /列表格式异常/],
    ['foreign network app', (f) => { f.lists['/cms2/sdk/network/app/index'][0].supply_app_id = 'foreign'; }, /DSP 联盟应用.*0 条/],
    ['foreign network placement', (f) => { f.lists['/cms2/sdk/network/placement/index'][0].network_id = 'network-adx'; }, /network_id/],
    ['wrong placement type', (f) => { f.candidate.placement_type_type = 'native'; }, /placement_type_type/],
    ['wrong package', (f) => { f.candidate.network_app_bundle_id = 'foreign.app'; }, /network_app_bundle_id/],
    ['multiple unknown adapters', (f) => { f.candidate.integration = ['unknown-a', 'unknown-b']; }, /集成方式/],
    ['missing DSP candidate', (f) => { f.lists['/cms2/sdk/integration/placement/add/index'] = []; }, /候选.*0 条/],
    ['duplicate source position', (f) => { f.lists['/cms2/sdk/network/placement/index'].push({ ...f.lists['/cms2/sdk/network/placement/index'][0], id: 'duplicate' }); }, /DSP 联盟位置.*2 条/]
]) {
    test(`does not write when ${name} cannot be verified`, async () => {
        const f = fixture();
        mutate(f);
        await assert.rejects(core.addDspPlacement(f.row, f.scope, f.api), error);
        assert.ok(f.calls.every((call) => call.method === 'GET'));
        assert.equal(f.row.placementId, 'ssp-1');
    });
}

test('an add failure is not retried and keeps the known source IDs', async () => {
    const f = fixture();
    let writes = 0;
    f.api.sdkAdd = async () => { writes += 1; throw new Error('network error'); };
    await assert.rejects(core.addDspPlacement(f.row, f.scope, f.api), /network error/);
    assert.equal(writes, 1);
    assert.equal(f.row.placementId, 'ssp-1');
    assert.equal(f.row.publicPlacementId, '1792704791349911');
    assert.equal(f.row.dspPlacementId, 'dsp-1');
});

test('a successful add response without a matching binding is not reported as success', async () => {
    const f = fixture();
    f.api.sdkAdd = async () => ({ code: 200 });
    await assert.rejects(core.addDspPlacement(f.row, f.scope, f.api), /DSP 绑定.*0 条/);
});

test('result workbooks remain valid imports for legacy and size-column templates', () => {
    for (const headers of [core.HEADERS, core.HEADERS.slice(0, -1)]) {
        const resultHeaders = headers.concat(core.RESULT_HEADERS);
        assert.doesNotThrow(() => core.validateHeaders(resultHeaders));
        const matrix = [resultHeaders, ['Banner', 'banner', 'cpm', 1, '', '',
            ...(headers.length === 7 ? [''] : []), '1792704791349911', 'ssp-1']];
        assert.equal(core.normalizeRows(matrix, { appName: 'App' })[0].status, 'ready');
        assert.throws(() => core.validateHeaders(resultHeaders.concat('位置ID')), /第一行必须严格/);
    }
});

test('result cells follow original Excel rows, store IDs as text and preserve other sheets', () => {
    const originalSheet = { header: core.HEADERS.slice() };
    const otherSheet = { A1: { f: 'SUM(1,2)', t: 'n', v: 3 }, '!cols': [{ wch: 30 }] };
    const book = { SheetNames: ['广告位', '说明'], Sheets: { 广告位: originalSheet, 说明: otherSheet } };
    const writes = new Map();
    const xlsx = { utils: {
        sheet_to_json: (sheet) => [sheet.header.slice()],
        sheet_add_aoa(sheet, values, { origin }) {
            assert.equal(sheet, originalSheet);
            writes.set(`${origin.r},${origin.c}`, values[0][0]);
            if (origin.r === 0) sheet.header[origin.c] = values[0][0];
        }
    } };
    const rows = [{ rowNumber: 2, placementId: 'ssp-1', publicPlacementId: '99999999999999999',
        integrationId: 'integration-1', dspPlacementId: 'dsp-1', status: 'success', reason: '完成' },
    { rowNumber: 5, placementId: 'ssp-2', publicPlacementId: '1792704791349912', status: 'partial', reason: 'DSP 失败' }];
    assert.equal(core.writeWorkbookResults(xlsx, book, '广告位', rows), book);
    assert.equal(writes.get('1,7'), '99999999999999999');
    assert.equal(writes.get('1,8'), 'ssp-1');
    assert.equal(writes.get('1,9'), 'integration-1');
    assert.equal(writes.get('1,10'), 'dsp-1');
    assert.equal(writes.get('4,7'), '1792704791349912');
    assert.equal(writes.get('4,11'), '部分完成');
    assert.ok(![...writes.keys()].some((key) => key.startsWith('2,') || key.startsWith('3,')));
    assert.equal(book.Sheets.说明, otherSheet);
    assert.deepEqual(originalSheet.header.slice(0, 7), core.HEADERS);
    core.writeWorkbookResults(xlsx, book, '广告位', rows);
    assert.equal(originalSheet.header.length, 7 + core.RESULT_HEADERS.length);
});
