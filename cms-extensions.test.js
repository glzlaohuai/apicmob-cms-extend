'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const extensions = require('./src/cms-extensions.js');

function createHarness(initial) {
    const stored = new Map();
    const sessions = new Map();
    const listeners = new Map();
    const starts = [];
    const ticks = [];
    const errors = [];
    const runtimes = {};
    if (initial !== undefined) stored.set(extensions.STORAGE_KEY, JSON.stringify(initial));
    const win = {
        location: { hostname: 'cms.apicmob.com', search: '', hash: '#/dashboard' },
        document: { readyState: 'loading', addEventListener() {} },
        localStorage: {
            getItem: (key) => stored.get(key) || null,
            setItem: (key, value) => stored.set(key, value)
        },
        sessionStorage: { getItem: (key) => sessions.get(key) || null },
        console: { error: (...args) => errors.push(args) },
        addEventListener(name, handler) {
            const handlers = listeners.get(name) || [];
            handlers.push(handler);
            listeners.set(name, handlers);
        }
    };
    const factories = Object.fromEntries(extensions.FEATURES.map(({ id }) => [id, (runtime) => {
        starts.push(id);
        runtimes[id] = runtime;
        runtime.watch(() => ticks.push({ id, enabled: runtime.isEnabled() }));
    }]));
    function dispatch(key = extensions.STORAGE_KEY) {
        (listeners.get('storage') || []).forEach((listener) => listener({ key }));
    }
    return { win, stored, sessions, factories, starts, ticks, errors, runtimes, dispatch };
}

test('settings default to enabled and accept only known boolean switches', () => {
    assert.deepEqual(extensions.normalizeSettings(null), {
        version: 1,
        features: { reportBack: true, moduleTemplate: true, placementBulk: true }
    });
    assert.deepEqual(extensions.normalizeSettings({
        features: { reportBack: false, moduleTemplate: 'false', placementBulk: 0, unknown: true }
    }).features, { reportBack: false, moduleTemplate: true, placementBulk: true });
});

test('malformed or unavailable storage does not prevent default startup', () => {
    const harness = createHarness();
    harness.stored.set(extensions.STORAGE_KEY, '{broken');
    assert.equal(extensions.readSettings(harness.win).features.reportBack, true);
    Object.defineProperty(harness.win, 'localStorage', { get() { throw new Error('Access denied'); } });
    extensions.boot(harness.win, harness.factories);
    assert.equal(harness.starts.length, 3);
});

test('save failures are reported to the settings UI instead of silently succeeding', () => {
    const harness = createHarness();
    harness.win.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
    assert.throws(() => extensions.saveSettings(harness.win, extensions.normalizeSettings(null)), /Quota exceeded/);
});

test('disabled features do not start until enabled by another tab', () => {
    const harness = createHarness({ features: { moduleTemplate: false, placementBulk: false } });
    extensions.boot(harness.win, harness.factories);
    assert.deepEqual(harness.starts, ['reportBack']);
    extensions.saveSettings(harness.win, { features: { reportBack: false, moduleTemplate: true, placementBulk: false } });
    harness.dispatch();
    assert.deepEqual(harness.starts, ['reportBack', 'moduleTemplate']);
    assert.equal(harness.runtimes.reportBack.isEnabled(), false);
    assert.equal(harness.runtimes.moduleTemplate.isEnabled(), true);
    harness.dispatch();
    assert.deepEqual(harness.starts, ['reportBack', 'moduleTemplate']);
});

test('storage clearing restores defaults while unrelated changes are ignored', () => {
    const harness = createHarness({ features: { reportBack: false, moduleTemplate: false, placementBulk: false } });
    extensions.boot(harness.win, harness.factories);
    harness.stored.clear();
    harness.dispatch('some-other-setting');
    assert.equal(harness.starts.length, 0);
    harness.dispatch(null);
    assert.equal(harness.starts.length, 3);
});

test('duplicate script injection and non-CMS pages cannot start additional features', () => {
    const harness = createHarness();
    extensions.boot(harness.win, harness.factories);
    extensions.boot(harness.win, harness.factories);
    assert.equal(harness.starts.length, 3);
    const other = createHarness();
    other.win.location.hostname = 'other.example';
    extensions.boot(other.win, other.factories);
    assert.equal(other.starts.length, 0);
});

test('one failed feature does not prevent other features from starting or updating', () => {
    const harness = createHarness();
    harness.factories.reportBack = () => { throw new Error('Failed to boot'); };
    extensions.boot(harness.win, harness.factories);
    assert.deepEqual(harness.starts, ['moduleTemplate', 'placementBulk']);
    assert.equal(harness.errors.length, 1);
    assert.deepEqual(harness.ticks.map(({ id }) => id), ['moduleTemplate', 'placementBulk']);
});

test('disabled template feature still resumes an unexpired migration for the current module', () => {
    const harness = createHarness({ features: { reportBack: false, moduleTemplate: false, placementBulk: false } });
    harness.win.location.hash = '#/system/custom-configuration/module-edit?id=new-module';
    harness.sessions.set('apicmob-apply-template::pending', JSON.stringify({ moduleId: 'new-module', ts: Date.now() }));
    extensions.boot(harness.win, harness.factories);
    assert.deepEqual(harness.starts, ['moduleTemplate']);
    assert.equal(harness.runtimes.moduleTemplate.isEnabled(), false);
});

test('expired migrations and migrations for another module do not activate disabled features', () => {
    const harness = createHarness();
    harness.win.location.hash = '#/system/custom-configuration/module-edit?id=module-1';
    const pendingKey = 'apicmob-apply-template::pending';
    harness.sessions.set(pendingKey, JSON.stringify({ moduleId: 'module-2', ts: Date.now() }));
    assert.equal(extensions.hasPendingMigration(harness.win), false);
    harness.sessions.set(pendingKey, JSON.stringify({ moduleId: 'module-1', ts: Date.now() - 6 * 60 * 1000 }));
    assert.equal(extensions.hasPendingMigration(harness.win), false);
});

test('settings links use a separate page without taking over CMS hash routes', () => {
    const url = new URL(extensions.settingsUrl());
    assert.equal(url.origin, 'https://cms.apicmob.com');
    assert.equal(url.hash, '');
    assert.equal(extensions.isSettingsPage(url), true);
    assert.equal(extensions.isSettingsPage({ search: '' }), false);
    assert.equal(extensions.isSettingsPage({ search: '?apicmob-cms-settings=0' }), false);
});
