(function (factory) {
    'use strict';

    const core = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = core;
    }
})(function createSessionGuard() {
    'use strict';

    const LOGOUT = 'd2admin/account/logout';
    const CHECK_URL = 'https://cmsapi.apicmob.com/api/cms2/user/menu';
    const installed = new WeakSet();

    function readCookie(win, name) {
        const entry = win.document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
        if (!entry) return '';
        try { return decodeURIComponent(entry.slice(name.length + 1)); }
        catch (error) { return ''; }
    }

    function boot(win, runtime) {
        const enabled = runtime.isEnabled;
        let observedVersion = '';
        const prototype = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
        if (prototype && typeof prototype.setRequestHeader === 'function') {
            const original = prototype.setRequestHeader;
            prototype.setRequestHeader = function (name, value) {
                if (String(name).toLowerCase() === 'x-token' && value) observedVersion = String(value);
                return original.apply(this, arguments);
            };
        }

        async function probe(version) {
            const controller = new win.AbortController();
            let timer;
            const timeout = new Promise((resolve) => {
                timer = win.setTimeout(() => { controller.abort(); resolve('unknown'); }, 5000);
            });
            const request = async () => {
                try {
                    const response = await win.fetch(CHECK_URL, {
                        method: 'GET', credentials: 'include', cache: 'no-store', signal: controller.signal,
                        headers: { accept: 'application/json, text/plain, */*', 'x-token': version }
                    });
                    if (response.status === 401) return 'rejected';
                    if (!response.ok) return 'unknown';
                    const body = await response.json();
                    if (body && body.code === 401) return 'rejected';
                    return body && (body.code === 200 || body.code === 0) ? 'valid' : 'unknown';
                } catch (error) {
                    return 'unknown';
                }
            };
            try { return await Promise.race([request(), timeout]); }
            finally { win.clearTimeout(timer); }
        }

        function attach() {
            if (!enabled()) return;
            const root = win.document.getElementById('app');
            const vm = root && (root.__vue__ || [...root.querySelectorAll('*')].map((node) => node.__vue__).find((value) => value && value.$store));
            const store = vm && vm.$store;
            if (!store || typeof store.dispatch !== 'function' || installed.has(store)) return;
            installed.add(store);

            const original = store.dispatch;
            let pending = null;
            let generation = 0;
            let lastNotice = 0;

            function notice(status) {
                if (Date.now() - lastNotice < 10000) return;
                lastNotice = Date.now();
                const message = status === 'valid'
                    ? '登录状态复核通过，已保留当前页面。刚才失败的操作请核对结果后重试。'
                    : '暂时无法确认登录状态，已保留当前页面。请稍后重试；持续失败可手动退出后登录。';
                try {
                    if (typeof vm.$message === 'function') vm.$message({ message, type: 'warning', duration: 7000 });
                    else win.console.warn('[CMS 登录态保护]', message);
                } catch (error) { /* A notification must never turn a preserved session into a failed dispatch. */ }
            }

            store.dispatch = function (action, payload) {
                const type = action && typeof action === 'object' ? action.type : action;
                const data = action && typeof action === 'object' ? action : payload;
                if (type !== LOGOUT) return original.apply(this, arguments);
                if (data && data.confirm) {
                    generation++;
                    return original.apply(this, arguments);
                }
                const identity = readCookie(win, 'appic_6.x_cms_token');
                if (!enabled() || !identity || identity === 'undefined' || identity === 'null'
                    || /^#\/login(?:[/?]|$)/.test(win.location.hash)) {
                    generation++;
                    return original.apply(this, arguments);
                }
                if (pending) return pending;

                const args = arguments;
                const receiver = this;
                const currentGeneration = generation;
                const current = () => generation === currentGeneration
                    && identity === readCookie(win, 'appic_6.x_cms_token');
                const version = observedVersion || readCookie(win, 'appic_cms_main_version');
                const check = async () => {
                    // Use native fetch so a failed verification cannot schedule another CMS logout.
                    let status = version ? await probe(version) : 'unknown';
                    if (!current()) return;
                    if (!enabled()) return original.apply(receiver, args);
                    if (status === 'rejected') {
                        await new Promise((resolve) => win.setTimeout(resolve, 500));
                        if (!current()) return;
                        if (!enabled()) return original.apply(receiver, args);
                        status = await probe(version);
                        if (!current()) return;
                        if (!enabled() || status === 'rejected') return original.apply(receiver, args);
                    }
                    notice(status);
                };
                pending = check().finally(() => { pending = null; });
                return pending;
            };
        }

        runtime.watch(attach);
        attach();
    }

    return { boot };
});
