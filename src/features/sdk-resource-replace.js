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
    const remark = (value) => value ?? '';
    const validWeight = (value) => Number.isInteger(value) && value >= 0 && value <= 100;
    const DIALOG_STYLE = `
        .apicmob-dialog { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 48px); box-sizing: border-box; padding: 0; border: none; border-radius: 8px; color: #303133; background: #fff; box-shadow: 0 12px 32px #0000001f, 0 2px 6px #00000014; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; letter-spacing: 0; overflow: hidden; }
        .apicmob-dialog.apicmob-dialog-wide { width: min(1080px, calc(100vw - 32px)); }
        .apicmob-dialog[open] { display: flex; flex-direction: column; animation: apicmob-dialog-in .16s ease-out; }
        .apicmob-dialog::backdrop { background: #00000073; }
        .apicmob-dialog * { box-sizing: border-box; }
        @keyframes apicmob-dialog-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
        @keyframes apicmob-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .apicmob-dialog[open] { animation: none; } }
        .apicmob-dialog .dlg-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px 8px; }
        .apicmob-dialog .dlg-head h3 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
        .apicmob-dialog .dlg-x { width: 32px; height: 32px; padding: 0; border: none; border-radius: 6px; background: none; color: #909399; font-size: 20px; line-height: 32px; cursor: pointer; }
        .apicmob-dialog .dlg-x:hover:not(:disabled) { background: #f2f3f5; color: #303133; }
        .apicmob-dialog .dlg-x:disabled { opacity: .4; cursor: not-allowed; }
        .apicmob-dialog .dlg-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 20px 20px; overflow-wrap: anywhere; }
        .apicmob-dialog .dlg-foot { display: flex; align-items: center; gap: 16px; padding: 12px 20px; border-top: 1px solid #ebeef5; background: #fafbfc; }
        .apicmob-dialog .dlg-actions { display: flex; flex-shrink: 0; gap: 8px; }
        .apicmob-dialog .el-button { margin: 0; padding: 7px 16px; font-size: 13px; line-height: 18px; }
        .apicmob-dialog .el-button--text { padding: 7px 4px; }
        .apicmob-dialog .el-button:disabled { opacity: .5; cursor: not-allowed; }
        .apicmob-dialog .dlg-source { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 10px 12px; border-radius: 6px; background: #f5f7fa; }
        .apicmob-dialog .dlg-source-label { color: #909399; font-size: 12px; }
        .apicmob-dialog .dlg-key { font: 600 14px/22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
        .apicmob-dialog .dlg-note { flex-basis: 100%; color: #909399; font-size: 12px; }
        .apicmob-dialog .tag { display: inline-block; padding: 0 6px; border-radius: 4px; background: #f0f2f5; color: #606266; font-size: 12px; line-height: 20px; white-space: nowrap; }
        .apicmob-dialog .tag:empty { display: none; }
        .apicmob-dialog .tag-primary { background: #ecf5ff; color: #337ecc; }
        .apicmob-dialog .tag-success { background: #f0f9eb; color: #529b2e; }
        .apicmob-dialog .tag-warning { background: #fdf6ec; color: #b88230; }
        .apicmob-dialog .tag-danger { background: #fef0f0; color: #c45656; }
        .apicmob-dialog .dlg-section { margin-top: 20px; }
        .apicmob-dialog .dlg-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 16px 0 8px; }
        .apicmob-dialog .dlg-section .dlg-toolbar { margin-top: 0; }
        .apicmob-dialog .dlg-toolbar input[type=search] { flex: 0 1 180px; width: auto; min-width: 120px; height: 32px; padding: 0 10px; line-height: 32px; }
        .apicmob-dialog .dlg-step { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 14px; font-weight: 600; }
        .apicmob-dialog .dlg-step-num { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: #409eff; color: #fff; font-size: 12px; }
        .apicmob-dialog .dlg-meta { color: #909399; font-size: 12px; }
        .apicmob-dialog .dlg-push { margin-left: auto; }
        .apicmob-dialog .dlg-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
        .apicmob-dialog .dlg-list { max-height: min(48vh, 420px); overflow: auto; border: 1px solid #ebeef5; border-radius: 6px; }
        .apicmob-dialog .dlg-refs { max-height: 34vh; }
        .apicmob-dialog .dlg-section .dlg-targets { max-height: 28vh; }
        .apicmob-dialog .dlg-row { display: grid; align-items: center; gap: 4px 12px; padding: 10px 12px; border-bottom: 1px solid #f0f2f5; cursor: pointer; transition: background-color .12s; }
        .apicmob-dialog .dlg-targets .dlg-row { grid-template-columns: 16px minmax(96px, .8fr) minmax(0, 1.4fr) minmax(0, 1.2fr); }
        .apicmob-dialog .dlg-refs .dlg-row { grid-template-columns: 16px minmax(0, 1fr) minmax(0, 1.2fr) 112px 140px minmax(0, 1.6fr); align-items: start; }
        .apicmob-dialog .dlg-row:last-child { border-bottom: none; }
        .apicmob-dialog .dlg-row:hover { background: #f5f7fa; }
        .apicmob-dialog .dlg-row:has(input:checked) { background: #ecf5ff; box-shadow: inset 3px 0 #409eff; }
        .apicmob-dialog .dlg-row:has(input:focus-visible) { outline: 2px solid #409eff; outline-offset: -2px; }
        .apicmob-dialog .dlg-row:not(.is-unavailable):has(input:disabled) { cursor: default; }
        .apicmob-dialog .dlg-row.is-unavailable { color: #a8abb2; background: none; cursor: not-allowed; }
        .apicmob-dialog .dlg-row.is-unavailable .tag { opacity: .7; }
        .apicmob-dialog .dlg-row-head, .apicmob-dialog .dlg-row-head:hover { position: sticky; top: 0; z-index: 1; padding-block: 8px; background: #fafafa; color: #909399; font-size: 12px; cursor: default; }
        .apicmob-dialog .dlg-row input { margin: 3px 0 0; accent-color: #409eff; cursor: inherit; }
        .apicmob-dialog .dlg-row > span { min-width: 0; }
        .apicmob-dialog .dlg-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 600; }
        .apicmob-dialog .dlg-mono + .tag { margin-left: 6px; }
        .apicmob-dialog .dlg-sub { color: #909399; font-size: 12px; }
        .apicmob-dialog .dlg-tags { display: flex; flex-wrap: wrap; gap: 4px; }
        .apicmob-dialog .dlg-lines > * { display: block; font-size: 12px; }
        .apicmob-dialog .dlg-reason { grid-column: 2 / -1; color: #c45656; font-size: 12px; }
        .apicmob-dialog .dlg-empty { padding: 32px 12px; color: #909399; text-align: center; }
        .apicmob-dialog .dlg-alert { margin-top: 8px; padding: 8px 12px; border-radius: 6px; background: #fef0f0; color: #c45656; font-size: 12px; }
        .apicmob-dialog .dlg-alert:empty, .apicmob-dialog .dlg-results:empty { display: none; }
        .apicmob-dialog .dlg-alert p { margin: 2px 0; }
        .apicmob-dialog .dlg-results { margin-top: 16px; padding: 12px; border: 1px solid #ebeef5; border-radius: 6px; }
        .apicmob-dialog .dlg-results h4 { margin: 0 0 4px; font-size: 14px; }
        .apicmob-dialog .dlg-result { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; padding: 6px 0; border-top: 1px solid #f0f2f5; }
        .apicmob-dialog .dlg-result:first-of-type { border-top: none; }
        .apicmob-dialog .dlg-result details { flex-basis: 100%; color: #909399; font-size: 12px; }
        .apicmob-dialog .dlg-result summary { width: fit-content; cursor: pointer; }
        .apicmob-dialog .dlg-status { flex: 1; min-width: 0; margin: 0; color: #606266; font-size: 13px; }
        .apicmob-dialog .dlg-status.is-error { color: #c45656; }
        .apicmob-dialog .dlg-status.is-success { color: #529b2e; }
        .apicmob-dialog .dlg-status.is-loading::before { content: ""; display: inline-block; width: 12px; height: 12px; margin-right: 8px; vertical-align: -2px; border: 2px solid #409eff; border-right-color: transparent; border-radius: 50%; animation: apicmob-spin .8s linear infinite; }
        @media (max-width: 720px) {
            .apicmob-dialog .dlg-targets .dlg-row, .apicmob-dialog .dlg-refs .dlg-row { grid-template-columns: 16px minmax(0, 1fr); }
            .apicmob-dialog .dlg-row > :not(:first-child) { grid-column: 2; }
            .apicmob-dialog .dlg-row-head { display: none; }
            .apicmob-dialog .dlg-toolbar input[type=search] { flex: 1 1 140px; margin-left: 0; }
        }
    `;

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
        const binding = Object.hasOwn(source, 'resource_id');
        const key = binding ? source.resource_resource : source.resource;
        const extra = binding ? source.resource_remark : source.remark;
        return rows.filter((row) => row.resource === key && remark(row.remark) === remark(extra)
            && id(row.id) !== id(binding ? source.resource_id : source.id));
    }

    function filterResources(rows, remark, version) {
        const noteQuery = remark.trim().toLowerCase();
        const versionQuery = version.trim().toLowerCase();
        return rows.filter((row) => String(row.description ?? '').toLowerCase().includes(noteQuery)
            && String(row.resource_ver ?? '').toLowerCase().includes(versionQuery));
    }

    function matches(resource, key, version, extra) {
        return resource?.status === 'active' && resource.resource === key && resource.resource_ver === version
            && remark(resource.remark) === remark(extra);
    }

    function bindingFields(row) {
        return [id(row.id), id(row.resource_id), row.resource_resource, remark(row.resource_remark),
            row.resource_resource_ver, row.status, row.weight];
    }

    function sameBindings(left, right) {
        const snapshot = (rows) => JSON.stringify(rows.map(bindingFields).sort((a, b) => a[0].localeCompare(b[0])));
        return snapshot(left) === snapshot(right);
    }

    async function prepareReplacement(request, channelKey, configId, displayed, selected, catalog) {
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
                    && matches(row, selected.resource, selected.resource_ver, selected.remark))) return;
                if (!list.length) break;
            }
            throw new Error('目标辅料不在当前配置的可添加候选中。');
        }
        const before = await bindings();
        const source = before.find((row) => id(row.id) === id(displayed.id));
        if (!source || !sameBindings([source], [displayed]) || source.status !== 'active' || !validWeight(source.weight)
            || !source.resource_resource || typeof source.resource_resource_ver !== 'string'
            || !id(selected.id) || !matches(selected, source.resource_resource, selected.resource_ver, source.resource_remark)
            || typeof selected.resource_ver !== 'string'
            || before.some((row) => id(row.resource_id) === id(selected.id)
                || (row !== source && row.resource_resource === source.resource_resource))) {
            throw new Error('旧辅料已变化、存在重复绑定或目标不符合替换条件，请刷新后检查。');
        }
        const directory = catalog || await allRows(request, DIRECTORY);
        if (!matches(directory.find((row) => id(row.id) === id(source.resource_id)), source.resource_resource,
            source.resource_resource_ver, source.resource_remark)
            || !matches(directory.find((row) => id(row.id) === id(selected.id)), selected.resource,
                selected.resource_ver, selected.remark)) {
            throw new Error('资源目录已变化，请重新选择。');
        }
        await checkCandidate();
        return { base, params, before, source, bindings, checkCandidate };
    }

    async function replace(request, channelKey, configId, displayed, selected, canSubmit, onStage, guard = async () => {}) {
        const { base, params, before, source, bindings, checkCandidate } =
            await prepareReplacement(request, channelKey, configId, displayed, selected);
        await guard();
        if (!sameBindings(before, await bindings()) || !canSubmit()) throw new Error('配置或页面已变化，未执行替换。');

        const removed = before.filter((row) => row !== source);
        const assertBindings = (expected, actual) => {
            if (!sameBindings(expected, actual)) throw new Error('辅料回读与预期不一致。');
        };
        let stage = '';
        async function write(path, data, nextStage) {
            stage = nextStage;
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
                || remark(added.resource_remark) !== remark(selected.remark)
                || added.resource_resource_ver !== selected.resource_ver || added.status !== 'active'
                || !validWeight(added.weight)) throw new Error('未核验到预期的新辅料。');
            assertBindings(removed, current.filter((row) => row !== added));
            if (added.weight !== source.weight) {
                await write('/update', { id: id(added.id), weight: source.weight }, '恢复原权重');
                assertBindings([...removed, { ...added, weight: source.weight }], await bindings());
            }
            return { ...added, weight: source.weight };
        } catch (error) {
            let summary = '未能核对当前列表';
            try {
                const current = await bindings();
                const old = current.some((row) => id(row.id) === id(source.id));
                const target = current.find((row) => id(row.resource_id) === id(selected.id));
                summary = `旧绑定${old ? '仍在' : '已不在'}，目标${target ? `已绑定（ID ${id(target.id)}，权重 ${target.weight}）` : '未绑定'}`;
            } catch { /* The write outcome is unknown until the page can be read. */ }
            const failure = new Error(`替换未完整验证：${error.message}。${summary}。请刷新核对后再处理，未自动重试。`);
            failure.writeStarted = Boolean(stage);
            failure.stage = stage;
            throw failure;
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
            const make = (tag, text, className) => {
                const element = doc.createElement(tag);
                if (text !== undefined) element.textContent = text;
                if (className) element.className = className;
                return element;
            };
            const panel = make('dialog', undefined, 'apicmob-dialog');
            panel.setAttribute('aria-labelledby', 'apicmob-replace-title');
            const head = make('div', undefined, 'dlg-head');
            const heading = make('h3', '替换' + channel.label);
            heading.id = 'apicmob-replace-title';
            const dismiss = make('button', '×', 'dlg-x');
            dismiss.type = 'button';
            dismiss.setAttribute('aria-label', '关闭');
            head.append(heading, dismiss);
            const card = make('div', undefined, 'dlg-source');
            const remarkTag = make('span', remark(source.resource_remark), 'tag');
            remarkTag.title = '附加信息';
            card.append(make('span', '当前', 'dlg-source-label'), make('span', source.resource_resource, 'dlg-key'), remarkTag,
                make('span', source.resource_resource_ver ? '版本 ' + source.resource_resource_ver : '空版本', 'tag tag-primary'));
            if (validWeight(source.weight)) card.append(make('span', `权重 ${source.weight}`, 'tag'));
            const toolbar = make('div', undefined, 'dlg-toolbar');
            function makeFilter(name) {
                const input = make('input', undefined, 'el-input__inner');
                input.type = 'search';
                input.placeholder = name;
                input.setAttribute('aria-label', name);
                input.disabled = true;
                toolbar.append(input);
                return input;
            }
            const remarkFilter = makeFilter('筛选备注');
            const versionFilter = makeFilter('筛选动态版本');
            const count = make('span', '', 'dlg-meta dlg-push');
            toolbar.append(count);
            const list = make('div', undefined, 'dlg-list dlg-targets');
            list.setAttribute('role', 'radiogroup');
            list.setAttribute('aria-label', '候选资源');
            list.append(make('div', '正在读取…', 'dlg-empty'));
            const body = make('div', undefined, 'dlg-body');
            body.append(card, toolbar, list);
            const status = make('p');
            status.setAttribute('role', 'status');
            const setStatus = (text, tone) => {
                status.textContent = text;
                status.className = tone ? 'dlg-status is-' + tone : 'dlg-status';
            };
            setStatus('正在读取资源…', 'loading');
            const actions = make('div', undefined, 'dlg-actions');
            const close = make('button', '取消', 'el-button el-button--default el-button--small');
            const submit = make('button', '确认替换', 'el-button el-button--primary el-button--small');
            submit.disabled = true;
            close.onclick = dismiss.onclick = () => panel.close();
            panel.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
            panel.addEventListener('close', () => {
                panel.remove();
                if (dialog === panel) dialog = null;
            });
            actions.append(close, submit);
            const foot = make('div', undefined, 'dlg-foot');
            foot.append(status, actions);
            panel.append(make('style', DIALOG_STYLE), head, body, foot);
            doc.body.append(panel);
            dialog = panel;
            panel.showModal();
            let selected;
            let stage = '';
            const canSubmit = () => active() === configId && vm.isActive && !vm._isDestroyed && panel.open;
            submit.onclick = async () => {
                if (busy || !selected || !canSubmit()) return;
                busy = true;
                submit.disabled = close.disabled = dismiss.disabled = true;
                remarkFilter.disabled = versionFilter.disabled = true;
                list.querySelectorAll('input').forEach((input) => { input.disabled = true; });
                setStatus('正在核对配置和候选…', 'loading');
                try {
                    await replace(request, channel.key, configId, source, selected, canSubmit, (value) => {
                        stage = value;
                        setStatus(`正在${value}…`, 'loading');
                    });
                    setStatus('替换成功，原权重已保留。', 'success');
                } catch (error) {
                    setStatus(stage ? `${stage}阶段：${error.message}` : error.message, 'error');
                } finally {
                    if (stage && routeId(win.location) === configId && !vm._isDestroyed) {
                        Promise.resolve(vm.GetTableDatas(true)).catch((error) => win.console.error('[辅料替换]', error));
                    }
                    busy = false;
                    close.disabled = dismiss.disabled = false;
                    close.textContent = '关闭';
                }
            };
            try {
                request ||= createRequest(win);
                if (!id(source.resource_id) || !Object.hasOwn(source, 'resource_remark')) {
                    const rows = await allRows(request, '/sdk/config/' + channel.key + '/index', { config_id: configId });
                    const fresh = rows.find((item) => id(item.id) === id(source.id) && id(item.config_id) === configId);
                    const resolved = { ...source, resource_id: id(source.resource_id) || fresh?.resource_id,
                        resource_remark: Object.hasOwn(source, 'resource_remark') ? source.resource_remark : fresh?.resource_remark };
                    if (!id(fresh?.resource_id) || !sameBindings([fresh], [resolved])) {
                        throw new Error('无法核对当前辅料，请刷新列表。');
                    }
                    source.resource_id = fresh.resource_id;
                    source.resource_remark = fresh.resource_remark;
                    remarkTag.textContent = remark(source.resource_remark);
                }
                const candidates = matchingResources(await allRows(request, DIRECTORY), source);
                if (!canSubmit()) return;
                let selectable = false;
                const hint = () => setStatus(selected
                    ? `将替换为 ${versionText(selected.resource_ver)}${selected.filename ? `（${selected.filename}）` : ''}，保留原权重。`
                    : selectable ? '请选择替换目标。' : candidates.length ? '没有可选的启用资源。' : '');
                function renderCandidates() {
                    const visible = filterResources(candidates, remarkFilter.value, versionFilter.value);
                    if (!visible.includes(selected)) selected = undefined;
                    submit.disabled = !selected;
                    list.replaceChildren();
                    selectable = false;
                    if (visible.length) {
                        const header = make('div', undefined, 'dlg-row dlg-row-head');
                        header.setAttribute('aria-hidden', 'true');
                        ['', '动态版本', '原文件名', '备注'].forEach((name) => header.append(make('span', name)));
                        list.append(header);
                    } else {
                        list.append(make('div', candidates.length ? '没有符合筛选条件的资源' : '没有同标识的其他资源', 'dlg-empty'));
                    }
                    for (const candidate of visible) {
                        const blocked = candidate.status !== 'active' ? '未启用'
                            : typeof candidate.resource_ver !== 'string' ? '版本异常' : '';
                        const entry = make('label', undefined, blocked ? 'dlg-row is-unavailable' : 'dlg-row');
                        const radio = make('input');
                        radio.type = 'radio';
                        radio.name = 'apicmob-replace-target';
                        radio.checked = candidate === selected;
                        radio.disabled = Boolean(blocked);
                        radio.setAttribute('aria-label', `选择 ${versionText(candidate.resource_ver)} ${candidate.filename || ''}`.trim());
                        selectable ||= !blocked;
                        radio.onchange = () => {
                            selected = candidate;
                            submit.disabled = false;
                            hint();
                        };
                        const version = make('span');
                        version.append(make('span', versionText(candidate.resource_ver), 'dlg-mono'));
                        if (blocked) version.append(make('span', blocked, 'tag tag-danger'));
                        entry.append(radio, version, make('span', candidate.filename || '—'),
                            make('span', candidate.description || '—', candidate.description ? undefined : 'dlg-sub'));
                        list.append(entry);
                    }
                    count.textContent = candidates.length ? `${visible.length} / ${candidates.length} 条` : '';
                    hint();
                }
                remarkFilter.disabled = versionFilter.disabled = false;
                remarkFilter.oninput = versionFilter.oninput = renderCandidates;
                renderCandidates();
            } catch (error) {
                list.replaceChildren(make('div', '未能读取候选资源', 'dlg-empty'));
                setStatus(error.message, 'error');
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

    return { DIALOG_STYLE, routeId, allRows, matchingResources, filterResources, prepareReplacement, sameBindings, createRequest, replace, boot };
});
