(function (factory) {
    'use strict';

    const core = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = core;
    }
})(function createSdkIntegration() {
    'use strict';

    const COLUMN = 'apicmobChannelControl';
    const STYLE_ID = 'apicmob-integration-control-style';
    const OVERVIEW = /^#\/sdk\/integration\/overview\/?(?:\?|$)/;
    const INTEGRATION = /^#\/sdk\/integration\//;
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

    function channelName(channel) {
        return !channel.cohort_id ? '默认渠道' : (channel.cohort_name || channel.id);
    }

    function channelControl(channel) {
        const config = channel.module_config_json || {};
        let status = '未配置模组';
        if (channel.module_config_id) {
            const value = config.request_limit_switch;
            status = !own(config, 'request_limit_switch') ? '未配置开关'
                : value === 0 ? '关闭' : value === 1 ? '开启' : `未知值：${JSON.stringify(value)}`;
        }
        return {
            name: channelName(channel), status,
            values: channel.module_config_id ? ['request_period', 'request_limit']
                .filter((key) => own(config, key))
                .map((key) => `${key}=${JSON.stringify(config[key])}`).join('，') : ''
        };
    }

    function defaultModuleName(vm) {
        const header = vm.headerMessage || {};
        if (!vm.addModuleConfig || !vm.params || !header.supply_placement_name || !header.supply_placement_placement_id) return;
        const base = `${header.supply_placement_name}_${header.supply_placement_placement_id}`;
        if (vm.addModuleConfig.name === base) {
            vm.addModuleConfig.name = `${base}_${channelName(vm.params)}`;
        }
    }

    // Old requests still occupy a slot until they settle, even after cancellation.
    function createQueue(request, changed, AbortController) {
        let generation = 0;
        let pending = [];
        let entries = new Map();
        const running = new Set();
        function publish() { changed(new Map(entries)); }
        function drain() {
            while (running.size < 4 && pending.length) {
                const job = pending.shift();
                job.controller = new AbortController();
                running.add(job);
                Promise.resolve().then(() => request(job.id, job.controller.signal)).then((channels) => {
                    if (job.generation === generation) {
                        entries.set(job.id, { status: 'ready', channels });
                        publish();
                    }
                }, (error) => {
                    if (job.generation === generation) {
                        entries.set(job.id, { status: 'error', message: error.message || '读取失败' });
                        publish();
                    }
                }).finally(() => {
                    running.delete(job);
                    drain();
                });
            }
        }
        function cancel() {
            generation += 1;
            pending = [];
            running.forEach((job) => job.controller.abort());
            entries = new Map();
        }
        function enqueue(id) {
            entries.set(id, { status: 'loading' });
            pending.push({ id, generation });
        }
        return {
            begin(ids) {
                cancel();
                new Set(ids.map(String)).forEach(enqueue);
                publish();
                drain();
            },
            retry(id) {
                id = String(id);
                if (!entries.has(id) || entries.get(id).status !== 'error') return;
                enqueue(id);
                publish();
                drain();
            },
            cancel
        };
    }

    function findComponents(win, match) {
        const root = win.document.getElementById('app');
        if (!root) return [];
        const found = [];
        const seen = new Set();
        const accepts = typeof match === 'function' ? match : (vm) => vm.$options && vm.$options.name === match;
        function visit(vm) {
            if (!vm || seen.has(vm) || vm._isDestroyed || vm._inactive) return;
            seen.add(vm);
            if (accepts(vm)) found.push(vm);
            (vm.$children || []).forEach(visit);
        }
        visit(root.__vue__);
        // A populated root tree can still omit Vue instances mounted separately below it.
        if (!found.length) root.querySelectorAll('*').forEach((element) => visit(element.__vue__));
        return found;
    }

    function findIntegrationTable(win) {
        return findComponents(win, (vm) => {
            if (typeof vm.getTableColumn !== 'function' || typeof vm.loadColumn !== 'function'
                || typeof vm.$watch !== 'function' || !Array.isArray(vm.data)) return false;
            if (vm.$el && (vm.$el.isConnected === false
                || (vm.$el.getClientRects && !vm.$el.getClientRects().length))) return false;
            const fields = new Set(vm.getTableColumn().fullColumn.map((column) => column.property));
            return ['supply_placement_name', 'supply_placement_placement_id', 'timeout'].every((field) => fields.has(field));
        })[0];
    }

    function observe(win, runtime, update, active) {
        let scheduled = false;
        let watching = false;
        const observer = new win.MutationObserver(() => {
            if (!scheduled) {
                scheduled = true;
                Promise.resolve().then(() => { scheduled = false; run(); });
            }
        });
        function run() {
            if (active() && !watching) {
                observer.observe(win.document.body, { childList: true, subtree: true });
                watching = true;
            } else if (!active() && watching) {
                observer.disconnect();
                watching = false;
            }
            update();
        }
        function init() {
            if (runtime && runtime.watch) runtime.watch(run);
            else {
                win.addEventListener('hashchange', run);
                win.setInterval(run, 500);
            }
            run();
        }
        if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', init, { once: true });
        else init();
    }

    function createApi(win) {
        let version = '';
        const prototype = win.XMLHttpRequest.prototype;
        const original = prototype.setRequestHeader;
        prototype.setRequestHeader = function (key, value) {
            if (String(key).toLowerCase() === 'x-token' && value) version = String(value);
            return original.apply(this, arguments);
        };
        return async (id, signal) => {
            const cookie = win.document.cookie.split('; ').find((item) => item.startsWith('appic_cms_main_version='));
            const response = await win.fetch(`https://cms-sdk-api.apicmob.com/api/cms2/sdk/integration/detail/list?id=${encodeURIComponent(id)}`, {
                credentials: 'include', signal,
                headers: { accept: 'application/json, text/plain, */*', 'x-token': version || (cookie && decodeURIComponent(cookie.split('=').slice(1).join('='))) || '8.2.34' }
            });
            if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`);
            const body = await response.json();
            if (body.code === 401) throw new Error('登录态或 CMS 版本失效，请刷新或重新登录后重试');
            if (body.code !== 200 && body.code !== 0) throw new Error(body.msg || body.message || `读取失败（${body.code}）`);
            if (!Array.isArray(body.result)) throw new Error('渠道数据格式异常');
            return body.result;
        };
    }

    function renderCell(h, entry, retry) {
        if (!entry || entry.status === 'loading') return [h('span', ['读取中…'])];
        if (entry.status === 'error') return [h('span', { attrs: { title: entry.message } }, ['读取失败 ']),
            h('button', { class: 'apicmob-control-retry', attrs: { type: 'button', title: entry.message }, on: { click: (event) => { event.stopPropagation(); retry(); } } }, ['重试'])];
        if (!entry.channels.length) return [h('span', ['暂无渠道'])];
        return [h('div', { class: 'apicmob-channel-controls' }, entry.channels.map((channel) => {
            const control = channelControl(channel);
            return h('div', { key: channel.id, class: 'apicmob-channel-control' }, [
                h('div', [h('strong', [control.name]), h('span', { class: control.status === '开启' ? 'apicmob-control-on' : '' }, [`：${control.status}`])]),
                control.values ? h('div', { class: 'apicmob-control-values' }, [control.values]) : null
            ]);
        }))];
    }

    function bootOverview(win, runtime) {
        const enabled = runtime && runtime.isEnabled ? runtime.isEnabled : () => true;
        const store = win.Vue ? win.Vue.observable({ entries: {} }) : { entries: {} };
        let binding = null;
        let lastRows = null;
        let wasLoading = false;
        const queue = createQueue(createApi(win), (entries) => {
            store.entries = Object.fromEntries(entries);
        }, win.AbortController);

        function release() {
            queue.cancel();
            if (binding) {
                binding.unwatch.forEach((stop) => stop());
                const { table } = binding;
                if (!table._isDestroyed) {
                    Promise.resolve(table.loadColumn(table.getTableColumn().collectColumn.filter((column) => column.property !== COLUMN)))
                        .catch((error) => win.console.error('[集成渠道控量]', error));
                }
            }
            binding = null;
            lastRows = null;
            wasLoading = false;
            const style = win.document.getElementById(STYLE_ID);
            if (style) style.remove();
        }

        function readRows() {
            if (!binding) return;
            const { table } = binding;
            const loading = Boolean(table.loading);
            if (loading) {
                if (!wasLoading) { queue.cancel(); store.entries = {}; }
                wasLoading = true;
                return;
            }
            if (lastRows !== table.data || wasLoading) {
                lastRows = table.data;
                wasLoading = false;
                queue.begin((lastRows || []).filter((row) => row.id).map((row) => row.id));
            }
        }

        function update() {
            if (!enabled() || !OVERVIEW.test(win.location.hash)) {
                if (binding) release();
                return;
            }
            const table = findIntegrationTable(win);
            if (!table) {
                if (binding) release();
                return;
            }
            if (binding && binding.table !== table) release();
            if (!binding) {
                // Vue is a CDN global and may load after this document-start userscript.
                if (!win.Vue) return;
                win.Vue.observable(store);
                binding = { table, unwatch: [] };
                binding.unwatch.push(table.$watch(() => table.data, readRows));
                binding.unwatch.push(table.$watch(() => table.loading, readRows, { sync: true }));
            }
            const columns = table.getTableColumn().collectColumn;
            if (!columns.some((column) => column.property === COLUMN)) {
                const index = columns.findIndex((column) => column.property === 'supply_placement_name');
                const next = columns.slice();
                next.splice(index < 0 ? next.length : index + 1, 0, {
                    field: COLUMN, title: '渠道控量', width: 330, showOverflow: false,
                    className: 'apicmob-channel-control-cell',
                    slots: { default: ({ row }, h) => renderCell(h, store.entries[String(row.id)], () => queue.retry(row.id)) }
                });
                Promise.resolve(table.loadColumn(next)).catch((error) => win.console.error('[集成渠道控量]', error));
            }
            if (!win.document.getElementById(STYLE_ID)) {
                const style = win.document.createElement('style');
                style.id = STYLE_ID;
                style.textContent = `
                    .apicmob-channel-control-cell .vxe-cell { white-space: normal !important; max-height: none !important; overflow: visible !important; line-height: 1.5 !important; }
                    .apicmob-channel-controls { padding: 5px 0; overflow-wrap: anywhere; }
                    .apicmob-channel-control + .apicmob-channel-control { margin-top: 6px; border-top: 1px solid #ebeef5; padding-top: 6px; }
                    .apicmob-channel-control strong { font-weight: 500; }
                    .apicmob-control-on { color: #21845b; }
                    .apicmob-control-values { color: #7c8590; font-size: 12px; }
                    .apicmob-control-retry { border: 0; background: none; color: #2563b8; cursor: pointer; padding: 2px 4px; font: inherit; }
                `;
                win.document.head.appendChild(style);
            }
            readRows();
        }
        observe(win, runtime, update, () => enabled() && OVERVIEW.test(win.location.hash));
    }

    function bootNaming(win, runtime) {
        const enabled = runtime && runtime.isEnabled ? runtime.isEnabled : () => true;
        const bindings = new Map();
        function update() {
            const components = enabled() && INTEGRATION.test(win.location.hash) ? findComponents(win, 'ChannelModule') : [];
            bindings.forEach((stop, vm) => {
                if (!components.includes(vm)) { stop(); bindings.delete(vm); }
            });
            components.forEach((vm) => {
                if (bindings.has(vm)) return;
                const apply = (visible) => {
                    if (visible && enabled() && INTEGRATION.test(win.location.hash)) defaultModuleName(vm);
                };
                bindings.set(vm, vm.$watch(() => vm.addModuleVisible, apply, { sync: true }));
                apply(vm.addModuleVisible);
            });
        }
        observe(win, runtime, update, () => enabled() && INTEGRATION.test(win.location.hash));
    }

    return { channelName, channelControl, defaultModuleName, createQueue, createApi, renderCell, bootOverview, bootNaming };
});
