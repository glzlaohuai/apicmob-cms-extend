'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('./src/features/session-guard.js');

const LOGOUT = 'd2admin/account/logout';
const COOKIE = 'appic_6.x_cms_token';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const response = (code, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ code, result: [] }) });

function createHarness(replies = [response(200)], initiallyMounted = true) {
    const state = { enabled: true, clears: 0, reloads: 0, hash: '#/sdk/config/overview?id=123', cookie: `${COOKIE}=test-session; appic_cms_main_version=8.3.0` };
    const calls = [];
    const requests = [];
    const notices = [];
    const watchers = [];
    const timers = new Map();
    let timerId = 0;
    let component = null;
    let manual = false;
    const store = {
        dispatch(...args) {
            calls.push(args);
            const [action, payload] = args;
            const type = typeof action === 'object' ? action.type : action;
            if (type === LOGOUT) {
                if ((typeof action === 'object' ? action : payload)?.confirm) manual = true;
                state.cookie = '';
                state.clears++;
                state.reloads++;
                state.hash = '#/login';
            }
            return Promise.resolve('original-result');
        }
    };
    const document = {
        get cookie() { return state.cookie; },
        getElementById: () => component
    };
    const win = {
        document,
        location: { get hash() { return state.hash; } },
        XMLHttpRequest: class { setRequestHeader() {} },
        AbortController,
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        fetch: async (url, options) => {
            requests.push({ url, options });
            const reply = replies.shift();
            if (reply instanceof Error) throw reply;
            if (typeof reply === 'function') return reply(options);
            if (!reply) throw new Error('Unexpected extra probe');
            return reply;
        },
        console: { warn: (...args) => notices.push(args) }
    };
    const vm = { $store: store, $message: (notice) => notices.push(notice) };
    if (initiallyMounted) component = { __vue__: vm, querySelectorAll: () => [] };
    const runtime = { isEnabled: () => state.enabled, watch: (callback) => watchers.push(callback) };
    guard.boot(win, runtime);
    async function runTimers(delay) {
        const due = [...timers].filter(([, timer]) => timer.delay === delay);
        for (const [id, timer] of due) { timers.delete(id); timer.fn(); }
        await flush();
    }
    // Matches the deployed error handler, including its substring check and delayed logout.
    function cmsError(message) {
        if (message.includes('401')) win.setTimeout(() => store.dispatch(LOGOUT), 2500);
    }
    return { win, state, store, calls, requests, notices, watchers, timers, cmsError, runTimers,
        tick: () => watchers.forEach((callback) => callback()),
        unmount: () => { component = null; }, mount: () => { component = { __vue__: vm, querySelectorAll: () => [] }; },
        wasManual: () => manual };
}

test('transient business 401 does not delete a valid cookie, clear storage or leave the form', async () => {
    const h = createHarness();
    h.cmsError('[ code: 401 ] temporary failure, 2秒后自动跳转至登录');
    await h.runTimers(2500);
    assert.equal(h.state.clears, 0);
    assert.equal(h.state.reloads, 0);
    assert.equal(h.state.hash, '#/sdk/config/overview?id=123');
    assert.match(h.state.cookie, /test-session/);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].url, 'https://cmsapi.apicmob.com/api/cms2/user/menu');
    assert.equal(h.requests[0].options.method, 'GET');
    assert.equal(h.requests[0].options.credentials, 'include');
    assert.equal(h.requests[0].options.cache, 'no-store');
    assert.equal(h.requests[0].options.headers['x-token'], '8.3.0');
    assert.ok(h.notices.length);
});

test('an unrelated error containing 401 in a resource ID cannot destroy a valid session', async () => {
    const h = createHarness();
    h.cmsError('[ code: 403 ] permission denied : /detail?id=140123');
    await h.runTimers(2500);
    assert.equal(h.state.clears, 0);
});

test('only two explicit authentication rejections allow the original automatic logout', async () => {
    const h = createHarness([response(401), response(undefined, 401)]);
    const pending = h.store.dispatch(LOGOUT);
    await flush();
    assert.equal(h.state.clears, 0);
    await h.runTimers(500);
    assert.equal(await pending, 'original-result');
    assert.equal(h.requests.length, 2);
    assert.equal(h.state.clears, 1);
});

test('the second probe can recover from a transient authentication rejection', async () => {
    const h = createHarness([response(401), response(200)]);
    const pending = h.store.dispatch(LOGOUT);
    await flush();
    await h.runTimers(500);
    await pending;
    assert.equal(h.requests.length, 2);
    assert.equal(h.state.clears, 0);
});

test('network, server, permission and malformed response errors preserve the form', async () => {
    for (const failure of [new Error('offline'), response(500, 503), response(403, 403), response(0, 500),
        { ok: true, status: 200, json: async () => { throw new Error('bad JSON'); } }, response(undefined)]) {
        const h = createHarness([failure]);
        await h.store.dispatch(LOGOUT);
        assert.equal(h.state.clears, 0);
        assert.equal(h.requests.length, 1);
        assert.ok(h.notices.length);
    }
});

test('concurrent error timers share one authentication check', async () => {
    let finish;
    const h = createHarness([() => new Promise((resolve) => { finish = resolve; })]);
    const pending = [h.store.dispatch(LOGOUT), h.store.dispatch(LOGOUT), h.store.dispatch({ type: LOGOUT })];
    await flush();
    assert.equal(h.requests.length, 1);
    finish(response(200));
    await Promise.all(pending);
    assert.equal(h.state.clears, 0);
});

test('an explicit manual logout still runs immediately and invalidates any pending check', async () => {
    let finish;
    const h = createHarness([() => new Promise((resolve) => { finish = resolve; })]);
    const pending = h.store.dispatch(LOGOUT);
    await flush();
    assert.equal(h.state.clears, 0);
    assert.equal(await h.store.dispatch(LOGOUT, { confirm: true }), 'original-result');
    assert.equal(h.wasManual(), true);
    finish(response(401));
    await pending;
    assert.equal(h.state.clears, 1);
    assert.equal(h.requests.length, 1);
});

test('disabled protection, login pages and missing cookies retain native logout behavior', async () => {
    for (const change of [h => { h.state.enabled = false; }, h => { h.state.hash = '#/login?redirect=%2Fdashboard'; },
        h => { h.state.cookie = ''; }]) {
        const h = createHarness();
        change(h);
        assert.equal(await h.store.dispatch(LOGOUT), 'original-result');
        assert.equal(h.state.clears, 1);
        assert.equal(h.requests.length, 0);
    }
});

test('unrelated actions and object-form manual logout keep their original arguments and result', async () => {
    const h = createHarness();
    const action = { type: 'd2admin/page/open', path: '/sdk/config' };
    const options = { root: true };
    assert.equal(await h.store.dispatch(action, options), 'original-result');
    assert.deepEqual(h.calls[0], [action, options]);
    assert.equal(await h.store.dispatch({ type: LOGOUT, confirm: true }), 'original-result');
    assert.equal(h.requests.length, 0);
});

test('a session change while checking cannot log out the new session', async () => {
    let finish;
    const h = createHarness([() => new Promise((resolve) => { finish = resolve; })]);
    const pending = h.store.dispatch(LOGOUT);
    await flush();
    h.state.cookie = `${COOKIE}=new-session; appic_cms_main_version=8.3.0`;
    finish(response(401));
    await pending;
    assert.equal(h.state.clears, 0);
    assert.equal(h.requests.length, 1);
});

test('a timed out probe settles and releases the shared check', async () => {
    const h = createHarness([options => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }), response(200)]);
    const pending = h.store.dispatch(LOGOUT);
    await flush();
    await h.runTimers(5000);
    await pending;
    assert.equal(h.state.clears, 0);
    await h.store.dispatch(LOGOUT);
    assert.equal(h.requests.length, 2);
});

test('the guard attaches when Vue mounts later and repeated ticks do not wrap dispatch again', async () => {
    const h = createHarness();
    const original = h.store.dispatch;
    h.tick();
    h.tick();
    assert.equal(h.store.dispatch, original);
    const late = createHarness([response(200)], false);
    late.mount();
    late.tick();
    await late.store.dispatch(LOGOUT);
    assert.equal(late.state.clears, 0);
});

test('the observed page version takes priority over a stale version cookie', async () => {
    const h = createHarness();
    new h.win.XMLHttpRequest().setRequestHeader('X-Token', '8.4.0');
    await h.store.dispatch(LOGOUT);
    assert.equal(h.requests[0].options.headers['x-token'], '8.4.0');
    assert.equal(h.state.clears, 0);
});

test('missing version information cannot be treated as an expired session', async () => {
    const h = createHarness();
    h.state.cookie = `${COOKIE}=test-session`;
    await h.store.dispatch(LOGOUT);
    assert.equal(h.requests.length, 0);
    assert.equal(h.state.clears, 0);
    assert.ok(h.notices.length);
});

test('disabling protection during a check restores native behavior', async () => {
    let finish;
    const h = createHarness([() => new Promise((resolve) => { finish = resolve; })]);
    const pending = h.store.dispatch(LOGOUT);
    await flush();
    h.state.enabled = false;
    finish(response(200));
    assert.equal(await pending, 'original-result');
    assert.equal(h.state.clears, 1);
});

test('concurrent authentication rejections cause at most one original logout', async () => {
    const h = createHarness([response(401), response(401)]);
    const pending = [h.store.dispatch(LOGOUT), h.store.dispatch(LOGOUT)];
    await flush();
    await h.runTimers(500);
    await Promise.all(pending);
    assert.equal(h.requests.length, 2);
    assert.equal(h.state.clears, 1);
});
