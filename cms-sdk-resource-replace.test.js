'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { routeId, allRows, matchingResources, replace, boot } = require('./src/features/sdk-resource-replace');

const configId = 'config-example';
const old = { id: 'binding-old', config_id: configId, resource_id: 'def-old', resource_resource: 'banner',
    resource_resource_ver: '', weight: 37, status: 'active' };
const other = { ...old, id: 'binding-other', resource_id: 'def-other', resource_resource: 'other' };
const target = { id: 'def-new', resource: 'banner', resource_ver: '01', status: 'active' };
const definitions = [{ ...target, id: 'def-old', resource_ver: '' }, target];
const result = (list, count = list.length) => ({ count, result: { list } });

test('both panes add a button to the native action cell without inserting a table column', () => {
    const nativeActions = () => ['edit', 'delete'];
    const panes = Object.fromEntries(['pane-BuildResources', 'pane-BuildResources2'].map((id) => {
        const cell = { width: '120', slots: { default: nativeActions, header() {}, edit() {} } };
        const columns = [cell, { property: 'resource_resource' }];
        const table = {
            $el: {},
            $parent: { isActive: true, detailsParams: { id: configId }, GetTableDatas() {} },
            getTableColumn: () => ({ fullColumn: columns, collectColumn: columns }),
            refreshColumn() {},
            loadColumn() { assert.fail('the existing table columns must not be replaced'); }
        };
        return [id, {
            cell, table, getClientRects: () => [1], contains: (el) => el === table.$el,
            querySelectorAll: () => [{ __vue__: table }]
        }];
    }));
    let activePane = 'pane-BuildResources';
    let sync;
    const win = { document: { getElementById: (id) => id === activePane ? panes[id] : null },
        location: { hash: `#/sdk/config/overview/detials?id=${configId}` }, console };
    boot(win, { isEnabled: () => true, watch: (callback) => { sync = callback; } });
    const h = (tag, props, children) => ({ tag, props, children });
    for (const [id, pane] of Object.entries(panes)) {
        activePane = id;
        sync();
        sync();
        const actions = pane.cell.slots.default({ row: old }, h);
        assert.deepEqual(actions.slice(0, 2), ['edit', 'delete']);
        assert.equal(actions.length, 3);
        assert.equal(actions[2].tag, 'button');
        assert.equal(actions[2].props.attrs['aria-label'], id.endsWith('2') ? '替换辅料2' : '替换辅料');
        assert.equal(typeof actions[2].props.on.click, 'function');
    }
    assert.equal(panes['pane-BuildResources'].cell.slots.default, nativeActions);
});

function fixture(options = {}) {
    const base = '/sdk/config/' + (options.channel || 'resource');
    let rows = options.rows || [old, other];
    const writes = [];
    const request = async (path, { params, data }) => {
        if (path === base + '/index') {
            assert.equal(params.config_id, configId);
            return result(rows);
        }
        if (path === '/sdk/resource/index') return result(definitions);
        if (path === base + '/add/index') {
            assert.equal(params.config_id, configId);
            return result([target], 10);
        }
        assert.ok(path.startsWith(base + '/'), `unexpected channel: ${path}`);
        const method = path.slice(base.length);
        writes.push([method, data]);
        switch (method) {
            case '/delete':
                rows = rows.filter((row) => row.id !== data.id);
                break;
            case '/add/duplication':
                return result(options.duplicates || []);
            case '/add':
                assert.deepEqual(data, { config_id: configId, resource_id: ['def-new'] });
                if (options.failAdd) throw new Error('network');
                rows = [...rows, { ...old, id: 'binding-new', resource_id: target.id, resource_resource_ver: '01', weight: 100 }];
                break;
            case '/update':
                rows = rows.map((row) => row.id === data.id ? { ...row, weight: data.weight } : row);
                break;
            default:
                assert.fail(path);
        }
    };
    return { request, writes, rows: () => rows };
}

test('scopes the route to SDK config details and matches exact keys across versions', () => {
    assert.equal(routeId({ hash: '#/sdk/config/overview/detials?id=config-example&name=' }), configId);
    assert.equal(routeId({ hash: '#/sdk/config/overview?id=config-example' }), null);
    const suspended = { ...target, id: 'def-suspended', resource_ver: '', status: 'suspend' };
    assert.deepEqual(matchingResources([...definitions, suspended, { ...target, id: 'def-prefix', resource: 'banner2' }], old),
        [target, suspended]);
});

test('reads all pages and fails on incomplete or repeated results', async () => {
    const request = async (_path, { params }) => result([definitions[params.page - 1]], 2);
    assert.deepEqual(await allRows(request, '/list'), definitions);
    await assert.rejects(allRows(async () => result([target], 2), '/list'), /重复/);
    await assert.rejects(allRows(async () => result([], 2), '/list'), /完整/);
});

for (const channel of ['resource', 'resource2']) {
    test(`${channel}: replaces the binding and preserves its weight using only its own endpoints`, async () => {
        const api = fixture({ channel });
        await replace(api.request, channel, configId, old, target, () => true, () => {});
        assert.deepEqual(api.writes, [
            ['/delete', { id: 'binding-old' }],
            ['/add/duplication', { config_id: configId, resource_id: ['def-new'] }],
            ['/add', { config_id: configId, resource_id: ['def-new'] }],
            ['/update', { id: 'binding-new', weight: 37 }]
        ]);
        assert.deepEqual(api.rows(), [other, { ...old, id: 'binding-new', resource_id: 'def-new', resource_resource_ver: '01' }]);
    });
}

test('does not delete after navigation, stale data, or a mismatched config', async () => {
    const api = fixture();
    await assert.rejects(replace(api.request, 'unknown', configId, old, target, () => true, () => {}), /未知/);
    await assert.rejects(replace(api.request, 'resource', configId, old, target, () => false, () => {}), /未执行/);
    await assert.rejects(replace(api.request, 'resource', configId, { ...old, weight: 2 }, target, () => true, () => {}), /已变化/);
    const mismatched = fixture({ rows: [{ ...old, config_id: 'another-config' }] });
    await assert.rejects(replace(mismatched.request, 'resource', configId, old, target, () => true, () => {}), /不属于/);
    assert.deepEqual([...api.writes, ...mismatched.writes], []);
});

test('reads back partial progress without adding after a duplicate warning or retrying a failed add', async () => {
    for (const options of [{ duplicates: [{ id: 'warning' }] }, { failAdd: true }]) {
        const api = fixture(options);
        await assert.rejects(replace(api.request, 'resource', configId, old, target, () => true, () => {}),
            /旧绑定已不在，目标未绑定.*未自动重试/);
        assert.deepEqual(api.writes.map(([method]) => method), options.failAdd
            ? ['/delete', '/add/duplication', '/add'] : ['/delete', '/add/duplication']);
    }
});
