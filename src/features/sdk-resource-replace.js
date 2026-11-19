(function (factory) {
    'use strict';

    if (typeof module === 'object' && module.exports) module.exports = factory();
})(function createSdkResourceReplace() {
    'use strict';

    const CHANNELS = [
        { key: 'resource', pane: 'pane-BuildResources', label: '辅料' },
        { key: 'resource2', pane: 'pane-BuildResources2', label: '辅料2' }
    ];
    const DIRECTORY = '/sdk/resource/index';
    const id = (value) => String(value ?? '');
    const validWeight = (value) => Number.isInteger(value) && value >= 0 && value <= 100;

    function routeId(location) {
        const [path, query] = location.hash.split('?');
        return path === '#/sdk/config/overview/detials' ? new URLSearchParams(query).get('id') : null;
    }

    async function allRows(request, path, params = {}) {
        const rows = new Map();
        let total;
        for (let page = 1; page <= 1000; page++) {
            const response = await request(path, { params: { ...params, page, size: 100 } });
            const list = response.result?.list;
            const count = response.count;
            if (!Array.isArray(list) || !Number.isSafeInteger(count) || count < 0
                || (page > 1 && count !== total)) throw new Error('列表数量发生变化或格式异常，请重新读取。');
            total = count;
            for (const row of list) {
                if (!id(row?.id) || rows.has(id(row.id))) throw new Error('列表包含无效或重复记录，请重新读取。');
                rows.set(id(row.id), row);
            }
            if (rows.size === total) return [...rows.values()];
            if (rows.size > total || !list.length) break;
        }
        throw new Error('未能读取完整列表。');
    }

    function matchingResources(rows, source) {
        return rows.filter((row) => row.resource === source.resource_resource && id(row.id) !== id(source.resource_id));
    }

    function matches(resource, key, version) {
        return resource?.status === 'active' && resource.resource === key && resource.resource_ver === version;
    }

    function bindingFields(row) {
        return [id(row.id), id(row.resource_id), row.resource_resource, row.resource_resource_ver, row.status, row.weight];
    }

    function sameBindings(left, right) {
        const snapshot = (rows) => JSON.stringify(rows.map(bindingFields).sort((a, b) => a[0].localeCompare(b[0])));
        return snapshot(left) === snapshot(right);
    }

    async function replace(request, channelKey, configId, displayed, selected, canSubmit, onStage) {
        const channel = CHANNELS.find(({ key }) => key === channelKey);
        if (!channel) throw new Error('未知的辅料页签。');
        const base = '/sdk/config/' + channel.key;
        const params = { config_id: configId };
        async function bindings() {
            const rows = await allRows(request, base + '/index', params);
            if (rows.some((row) => id(row.config_id) !== configId)) throw new Error('辅料不属于当前配置。');
            return rows;
        }
        async function checkCandidate() {
            // The candidate endpoint can report an unfiltered count; locate the exact ID without trusting it.
            const seen = new Set();
            for (let page = 1; page <= 1000; page++) {
                const response = await request(base + '/add/index', { params: { ...params, page, size: 100 } });
                const list = response.result?.list;
                if (!Array.isArray(list)) break;
                for (const row of list) {
                    if (!id(row?.id) || seen.has(id(row.id))) throw new Error('候选列表格式或分页异常。');
                    seen.add(id(row.id));
                }
                if (list.some((row) => id(row.id) === id(selected.id)
                    && matches(row, selected.resource, selected.resource_ver))) return;
                if (!list.length) break;
            }
            throw new Error('目标辅料不在当前配置的可添加候选中。');
        }
        const before = await bindings();
        const source = before.find((row) => id(row.id) === id(displayed.id));
        if (!source || !sameBindings([source], [displayed]) || source.status !== 'active' || !validWeight(source.weight)
            || !source.resource_resource || typeof source.resource_resource_ver !== 'string'
            || !id(selected.id) || !matches(selected, source.resource_resource, selected.resource_ver)
            || typeof selected.resource_ver !== 'string'
            || before.some((row) => id(row.resource_id) === id(selected.id)
                || (row !== source && row.resource_resource === source.resource_resource))) {
            throw new Error('旧辅料已变化、存在重复绑定或目标不符合替换条件，请刷新后检查。');
        }
        const directory = await allRows(request, DIRECTORY);
        if (!matches(directory.find((row) => id(row.id) === id(source.resource_id)), source.resource_resource, source.resource_resource_ver)
            || !matches(directory.find((row) => id(row.id) === id(selected.id)), selected.resource, selected.resource_ver)) {
            throw new Error('资源目录已变化，请重新选择。');
        }
        await checkCandidate();
        if (!sameBindings(before, await bindings()) || !canSubmit()) throw new Error('配置或页面已变化，未执行替换。');

        const removed = before.filter((row) => row !== source);
        const assertBindings = (expected, actual) => {
            if (!sameBindings(expected, actual)) throw new Error('辅料回读与预期不一致。');
        };
        async function write(path, data, stage) {
            onStage(stage);
            await request(base + path, { data });
        }
        try {
            await write('/delete', { id: id(source.id) }, '删除旧辅料');
            assertBindings(removed, await bindings());
            await checkCandidate();
            const data = { ...params, resource_id: [id(selected.id)] };
            const duplicate = await request(base + '/add/duplication', { data });
            if (!Array.isArray(duplicate.result?.list) || duplicate.result.list.length) {
                throw new Error('重复校验未通过，已停止新增。');
            }
            assertBindings(removed, await bindings());
            await write('/add', data, '新增目标辅料');
            const current = await bindings();
            const added = current.find((row) => id(row.resource_id) === id(selected.id));
            if (!added || id(added.id) === id(source.id) || added.resource_resource !== selected.resource
                || added.resource_resource_ver !== selected.resource_ver || added.status !== 'active'
                || !validWeight(added.weight)) throw new Error('未核验到预期的新辅料。');
            assertBindings(removed, current.filter((row) => row !== added));
            if (added.weight !== source.weight) {
                await write('/update', { id: id(added.id), weight: source.weight }, '恢复原权重');
                assertBindings([...removed, { ...added, weight: source.weight }], await bindings());
            }
        } catch (error) {
            let summary = '未能核对当前列表';
            try {
                const current = await bindings();
                const old = current.some((row) => id(row.id) === id(source.id));
                const target = current.find((row) => id(row.resource_id) === id(selected.id));
                summary = `旧绑定${old ? '仍在' : '已不在'}，目标${target ? `已绑定（权重 ${target.weight}）` : '未绑定'}`;
            } catch { /* The write outcome is unknown until the page can be read. */ }
            throw new Error(`替换未完整验证：${error.message}。${summary}。请刷新核对后再处理，未自动重试。`);
        }
    }

    function createRequest(win) {
        let version = '';
        const proto = win.XMLHttpRequest.prototype;
        const original = proto.setRequestHeader;
        proto.setRequestHeader = function (key, value) {
            if (String(key).toLowerCase() === 'x-token' && value) version = String(value);
            return original.apply(this, arguments);
        };
        return async (path, { params, data } = {}) => {
            const url = new URL('https://cms-sdk-api.apicmob.com/api/cms2' + path);
            Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
            const cookie = win.document.cookie.match(/(?:^|;\s*)appic_cms_main_version=([^;]+)/);
            const token = version || (cookie && decodeURIComponent(cookie[1]));
            if (!token) throw new Error('未找到 CMS 版本，请刷新页面。');
            const headers = { accept: 'application/json, text/plain, */*', 'x-token': token };
            if (data) headers['content-type'] = 'application/json;charset=UTF-8';
            const response = await win.fetch(url.toString(), {
                method: data ? 'POST' : 'GET', credentials: 'include', headers,
                body: data ? JSON.stringify(data) : undefined,
                signal: win.AbortSignal.timeout(15000)
            });
            if (!response.ok) throw new Error(`CMS 请求失败（HTTP ${response.status}）`);
            const body = await response.json();
            if (body?.code !== 200 && body?.code !== 0) throw new Error(body?.msg || 'CMS 返回异常。');
            return body;
        };
    }

    function findTable(win, configId, channel) {
        const pane = win.document.getElementById(channel.pane);
        if (!pane || !pane.getClientRects().length) return null;
        const seen = new Set();
        function visit(table) {
            if (!table || seen.has(table) || !pane.contains(table.$el)) return null;
            seen.add(table);
            const columns = table.getTableColumn?.().fullColumn;
            const actions = columns?.find((column) => !column.property
                && typeof column.slots?.default === 'function' && column.slots.header && column.slots.edit);
            if (actions && columns.some((column) => column.property === 'resource_resource')) {
                for (let vm = table.$parent; vm; vm = vm.$parent) {
                    if (vm.isActive && id(vm.detailsParams?.id) === configId && typeof vm.GetTableDatas === 'function') {
                        return { table, vm, channel, actions };
                    }
                }
            }
            for (const child of table.$children || []) {
                const found = visit(child);
                if (found) return found;
            }
            return null;
        }
        for (const element of [pane, ...pane.querySelectorAll('.vxe-table')]) {
            const found = visit(element.__vue__);
            if (found) return found;
        }
        return null;
    }

    function boot(win, runtime) {
        let request;
        let attached;
        let dialog;
        let busy = false;
        const active = () => runtime.isEnabled() && routeId(win.location);
        const versionText = (value) => value || '（空版本）';

        async function open(vm, channel, configId, row) {
            if (busy || dialog || active() !== configId || !vm.isActive) return;
            const source = { ...row };
            const doc = win.document;
            const make = (tag, value) => {
                const element = doc.createElement(tag);
                element.textContent = value || '';
                return element;
            };
            const panel = make('dialog');
            panel.setAttribute('aria-labelledby', 'apicmob-replace-title');
            panel.style.cssText = 'width: min(620px, calc(100vw - 32px)); box-sizing: border-box; border: 1px solid #dcdfe6; border-radius: 6px; padding: 20px; color: #303133; overflow-wrap: anywhere;';
            const heading = make('h3', '替换' + channel.label);
            heading.id = 'apicmob-replace-title';
            heading.style.marginTop = '0';
            const summary = make('p', `当前：${source.resource_resource} / ${versionText(source.resource_resource_ver)}`);
            const list = make('div');
            list.style.cssText = 'max-height: min(45vh, 360px); overflow: auto;';
            const status = make('p', '正在读取资源…');
            status.setAttribute('role', 'status');
            const footer = make('div');
            footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';
            const close = make('button', '取消');
            close.className = 'el-button el-button--default el-button--small';
            const submit = make('button', '确认替换');
            submit.className = 'el-button el-button--primary el-button--small';
            submit.disabled = true;
            close.onclick = () => panel.close();
            panel.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
            panel.addEventListener('close', () => {
                panel.remove();
                if (dialog === panel) dialog = null;
            });
            footer.append(close, submit);
            panel.append(heading, summary, list, status, footer);
            doc.body.append(panel);
            dialog = panel;
            panel.showModal();
            let selected;
            let stage = '';
            const canSubmit = () => active() === configId && vm.isActive && !vm._isDestroyed && panel.open;
            submit.onclick = async () => {
                if (busy || !selected || !canSubmit()) return;
                busy = true;
                submit.disabled = close.disabled = true;
                list.querySelectorAll('input').forEach((input) => { input.disabled = true; });
                status.textContent = '正在核对配置和候选…';
                try {
                    await replace(request, channel.key, configId, source, selected, canSubmit, (value) => {
                        stage = value;
                        status.textContent = `正在${value}…`;
                    });
                    status.textContent = '替换成功，原权重已保留。';
                } catch (error) {
                    status.textContent = stage ? `${stage}阶段：${error.message}` : error.message;
                } finally {
                    if (stage && routeId(win.location) === configId && !vm._isDestroyed) {
                        Promise.resolve(vm.GetTableDatas(true)).catch((error) => win.console.error('[辅料替换]', error));
                    }
                    busy = false;
                    close.disabled = false;
                    close.textContent = '关闭';
                }
            };
            try {
                request ||= createRequest(win);
                if (!id(source.resource_id)) {
                    const rows = await allRows(request, '/sdk/config/' + channel.key + '/index', { config_id: configId });
                    const fresh = rows.find((item) => id(item.id) === id(source.id) && id(item.config_id) === configId);
                    if (!id(fresh?.resource_id) || !sameBindings([fresh], [{ ...source, resource_id: fresh.resource_id }])) {
                        throw new Error('无法核对当前辅料，请刷新列表。');
                    }
                    source.resource_id = fresh.resource_id;
                }
                const candidates = matchingResources(await allRows(request, DIRECTORY), source);
                if (!canSubmit()) return;
                let selectable = false;
                for (const candidate of candidates) {
                    const label = make('label');
                    label.style.cssText = 'display: flex; align-items: baseline; gap: 8px; padding: 10px 4px; border-bottom: 1px solid #ebeef5;';
                    const radio = make('input');
                    radio.type = 'radio';
                    radio.name = 'apicmob-replace-target';
                    radio.disabled = candidate.status !== 'active' || typeof candidate.resource_ver !== 'string';
                    selectable ||= !radio.disabled;
                    radio.onchange = () => { selected = candidate; submit.disabled = false; };
                    label.append(radio, make('span', [
                        versionText(candidate.resource_ver), candidate.filename, candidate.description,
                        id(candidate.id), radio.disabled ? '不可选' : ''
                    ].filter(Boolean).join(' / ')));
                    list.append(label);
                }
                status.textContent = selectable ? '' : '没有可替换的同标识资源。';
            } catch (error) {
                status.textContent = error.message;
            }
        }

        function sync() {
            const configId = active();
            let found;
            if (configId) {
                for (const channel of CHANNELS) {
                    found = findTable(win, configId, channel);
                    if (found) break;
                }
            }
            if (attached && (attached.actions !== found?.actions || attached.configId !== configId
                || attached.actions.slots.default !== attached.render)) {
                const { table, actions, original, render, width } = attached;
                attached = null;
                if (actions.slots.default === render) actions.slots.default = original;
                actions.width = width;
                if (!table._isDestroyed && table !== found?.table) table.refreshColumn();
                if (dialog?.open && !busy) dialog.close();
            }
            if (!found || attached) return;
            const { table, vm, channel, actions } = found;
            const { default: original } = actions.slots;
            const { width } = actions;
            const label = '替换' + channel.label;
            function render(params, h) {
                const { row } = params;
                const enabled = row.status === 'active' && id(row.id) && row.resource_resource;
                return [].concat(original.call(this, params, h) || [], h('button', {
                    class: 'el-button el-button--text',
                    style: { marginLeft: '8px', width: '28px', padding: '0', fontSize: '18px' },
                    attrs: { type: 'button', 'aria-label': label, title: enabled ? label : '仅支持替换已启用的绑定', disabled: !enabled },
                    on: { click: (event) => { event.stopPropagation(); open(vm, channel, configId, row); } }
                }, [h('i', { class: 'el-icon-refresh', attrs: { 'aria-hidden': 'true' } })]));
            }
            attached = { table, actions, original, render, width, configId };
            actions.width = (Number(width) || 120) + 36;
            actions.slots.default = render;
            Promise.resolve(table.refreshColumn()).catch((error) => win.console.error('[辅料替换]', error));
        }
        runtime.watch(sync);
    }

    return { routeId, allRows, matchingResources, replace, boot };
});
