(function (factory) {
    'use strict';

    if (typeof module === 'object' && module.exports) module.exports = factory();
})(function createSdkResourceUsage() {
    'use strict';

    const CHANNELS = [{ key: 'resource', label: '辅料' }, { key: 'resource2', label: '辅料2' }];
    const TYPES = { 1: '调试', 2: '离线', 3: '活跃', 4: '默认' };
    const STATES = { pending: '未执行', running: '执行中', success: '成功', failed: '失败', partial: '部分完成' };
    const DIRECTORY = '/sdk/resource/index';
    const id = (value) => String(value ?? '');
    const extra = (value) => value ?? '';
    const isResourcePage = (location) => location.hash.split('?')[0] === '#/sdk/config/resources';

    function listOf(response) {
        const list = response.result?.list;
        if (!Array.isArray(list) || list.some((row) => !id(row?.id))
            || new Set(list.map((row) => id(row.id))).size !== list.length) throw new Error('列表包含无效或重复记录。');
        return list;
    }

    function configFields(config) {
        return [id(config.id), id(config.supply_app_id), config.name, config.type, config.status, config.product_mode];
    }

    async function bindings(request, core, configId, channel) {
        const rows = await core.allRows(request, '/sdk/config/' + channel + '/index', { config_id: configId });
        if (rows.some((row) => id(row.config_id) !== configId)) throw new Error('辅料不属于当前配置。');
        return rows;
    }

    async function readUsage(request, definition, core, canRead = () => true, onProgress = () => {}) {
        const entries = [];
        const issues = [];
        const read = async (path, options) => {
            if (!canRead()) throw new Error('读取已取消。');
            const response = await request(path, options);
            if (!canRead()) throw new Error('读取已取消。');
            return response;
        };
        const apps = listOf(await read('/sdk/resource/app_index', { params: { id: id(definition.id) } }));
        let next = 0;
        let finished = 0;
        async function worker() {
            while (next < apps.length && canRead()) {
                const app = apps[next++];
                try {
                    // config/all returns observed rows even when count=0; do not use counted pagination here.
                    const configs = listOf(await read('/sdk/config/all', {
                        params: { supply_app_id: id(app.id), page: 1, size: 100, keyword: '' }
                    }));
                    if (configs.some((config) => id(config.supply_app_id) !== id(app.id))) {
                        throw new Error('配置列表包含其他 App 的记录。');
                    }
                    for (const config of configs) {
                        const entry = { app, config, references: [], versions: [], versionState: 'na', issues: [] };
                        for (const channel of CHANNELS) {
                            try {
                                const rows = await bindings(read, core, id(config.id), channel.key);
                                for (const binding of rows.filter((row) => id(row.resource_id) === id(definition.id))) {
                                    entry.references.push({ channel: channel.key, binding });
                                }
                            } catch (error) {
                                entry.issues.push(`${channel.label}：${error.message}`);
                            }
                        }
                        if (entry.references.length && [2, 3].includes(config.type)) {
                            try {
                                const versions = listOf(await read('/sdk/config/version/select', { params: { config_id: id(config.id) } }));
                                if (versions.some((row) => !Number.isFinite(Number(row.activity)) || row.activity === null
                                    || row.activity === '')) throw new Error('版本活跃度格式异常。');
                                entry.versions = versions.filter((row) => Number(row.activity) > 0);
                                entry.versionState = 'ok';
                            } catch (error) {
                                entry.versionState = 'error';
                                entry.issues.push(`活跃版本：${error.message}`);
                            }
                        }
                        if (entry.references.length) entries.push(entry);
                        for (const issue of entry.issues) issues.push(`${app.name} / ${config.name}：${issue}`);
                    }
                } catch (error) {
                    issues.push(`${app.name}（${id(app.id)}）：${error.message}`);
                }
                onProgress(++finished, apps.length);
            }
        }
        await Promise.all(Array.from({ length: Math.min(4, apps.length) }, worker));
        if (!canRead()) throw new Error('读取已取消。');
        entries.sort((a, b) => id(a.app.id).localeCompare(id(b.app.id)) || id(a.config.id).localeCompare(id(b.config.id)));
        return { entries, issues, appsRead: finished, inventoryComplete: false };
    }

    function unavailable(entry, definition) {
        if (entry.issues.length) return entry.issues.join('；');
        if (!TYPES[entry.config.type] || !['active', 'suspend'].includes(entry.config.status)) return '配置类型或状态异常';
        if (definition.status !== 'active') return '原资源未启用';
        if (entry.references.some(({ binding }) => binding.status !== 'active' || !Number.isInteger(binding.weight)
            || binding.weight < 0 || binding.weight > 100 || binding.resource_resource !== definition.resource
            || extra(binding.resource_remark) !== extra(definition.remark)
            || binding.resource_resource_ver !== definition.resource_ver)) return '原绑定状态或资源信息不符合替换条件';
        return '';
    }

    async function verifyEntry(request, core, entry, definition, canSubmit) {
        if (!canSubmit()) throw new Error('页面或功能开关已变化，未执行后续替换。');
        const reason = unavailable(entry, definition);
        if (reason || !entry.references.length) throw new Error(reason || '配置没有已确认的资源引用。');
        const config = (await request('/sdk/config/detail', { params: { id: id(entry.config.id) } })).result;
        if (!config || id(config.supply_app_id) !== id(entry.app.id)
            || JSON.stringify(configFields(config)) !== JSON.stringify(configFields(entry.config))) {
            throw new Error('配置归属、类型或状态已变化，请重新读取引用。');
        }
        for (const channel of CHANNELS) {
            const actual = (await bindings(request, core, id(config.id), channel.key))
                .filter((row) => id(row.resource_id) === id(definition.id));
            const expected = entry.references.filter((ref) => ref.channel === channel.key).map((ref) => ref.binding);
            if (!core.sameBindings(actual, expected)) throw new Error('配置的资源引用已变化，请重新读取。');
        }
        if (!canSubmit()) throw new Error('页面或功能开关已变化，未执行后续替换。');
    }

    async function replaceBatch(request, entries, definition, selected, core, canSubmit, onProgress = () => {}) {
        const results = entries.map((entry) => ({ entry, status: 'pending', message: '未执行', completed: [] }));
        let current;
        let started = false;
        const publish = () => onProgress({ results, started });
        try {
            if (!results.length) throw new Error('请先勾选配置。');
            if (new Set(entries.map((entry) => id(entry.config.id))).size !== entries.length) throw new Error('配置重复。');
            const directory = await core.allRows(request, DIRECTORY);
            if (!core.matchingResources(directory, definition).some((row) => id(row.id) === id(selected.id)
                && row.status === 'active' && row.resource_ver === selected.resource_ver
                && row.resource === selected.resource && extra(row.remark) === extra(selected.remark))) {
                throw new Error('目标资源已变化。');
            }
            for (const result of results) {
                current = result;
                result.message = '预检中';
                publish();
                await verifyEntry(request, core, result.entry, definition, canSubmit);
                for (const ref of result.entry.references) {
                    await core.prepareReplacement(request, ref.channel, id(result.entry.config.id), ref.binding, selected, directory);
                }
                result.message = '预检通过，未执行';
            }
            for (const result of results) {
                current = result;
                await verifyEntry(request, core, result.entry, definition, canSubmit);
                const guard = async () => {
                    if (!canSubmit()) throw new Error('页面或功能开关已变化，未执行后续替换。');
                    const config = (await request('/sdk/config/detail', { params: { id: id(result.entry.config.id) } })).result;
                    if (!config || JSON.stringify(configFields(config)) !== JSON.stringify(configFields(result.entry.config))) {
                        throw new Error('配置归属、类型或状态已变化。');
                    }
                };
                for (const ref of result.entry.references) {
                    const added = await core.replace(request, ref.channel, id(result.entry.config.id), ref.binding, selected, canSubmit,
                        (stage) => {
                            started = true;
                            result.status = 'running';
                            result.message = `${CHANNELS.find((channel) => channel.key === ref.channel).label}：${stage}`;
                            publish();
                        }, guard);
                    result.completed.push({ channel: ref.channel, oldBindingId: id(ref.binding.id), newBindingId: id(added.id),
                        oldResourceId: id(definition.id), newResourceId: id(selected.id), weight: added.weight });
                }
                await guard();
                result.status = 'success';
                result.message = '替换成功，原权重已保留';
                publish();
            }
        } catch (error) {
            current ||= results[0];
            if (current) {
                current.status = current.completed.length || error.writeStarted ? 'partial' : 'failed';
                current.message = error.stage ? `${error.stage}阶段：${error.message}` : error.message;
            }
            publish();
            return { results, started, stopped: true, error: error.message };
        }
        return { results, started, stopped: false };
    }

    function findTable(win) {
        for (const element of win.document.querySelectorAll('#app .vxe-table')) {
            const table = element.__vue__;
            if (!table || table._isDestroyed || !element.getClientRects().length) continue;
            const columns = table.getTableColumn?.().fullColumn;
            const column = columns?.find((item) => item.property === 'xbc_id' && typeof item.slots?.default === 'function');
            if (!column || !['resource', 'remark', 'resource_ver'].every((field) => columns.some((item) => item.property === field))) continue;
            for (let vm = table.$parent; vm; vm = vm.$parent) {
                if (vm.isActive && typeof vm.handleOpenLinkApplyDrawer === 'function') return { table, column, vm };
            }
        }
        return null;
    }

    function boot(win, runtime, core) {
        let attached;
        let state;
        let request;
        const active = () => runtime.isEnabled() && isResourcePage(win.location);

        function open(vm, displayed) {
            if (state || !active() || !vm.isActive || !id(displayed.id)) return;
            request ||= core.createRequest(win);
            const doc = win.document;
            const make = (tag, text, className) => {
                const element = doc.createElement(tag);
                if (text !== undefined) element.textContent = text;
                if (className) element.className = className;
                return element;
            };
            const panel = make('dialog', undefined, 'apicmob-resource-usage');
            panel.setAttribute('aria-labelledby', 'apicmob-usage-title');
            const style = make('style');
            style.textContent = `
                .apicmob-resource-usage { width: min(1240px, calc(100vw - 32px)); max-height: calc(100vh - 32px); box-sizing: border-box; padding: 20px; border: 1px solid #dcdfe6; border-radius: 6px; color: #303133; background: #fff; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: auto; overflow-wrap: anywhere; letter-spacing: 0; }
                .apicmob-resource-usage::backdrop { background: #0006; }
                .apicmob-resource-usage h3 { margin: 0 0 8px; font-size: 18px; }
                .apicmob-resource-usage h4 { margin: 16px 0 8px; font-size: 14px; }
                .apicmob-resource-usage p { margin: 8px 0; }
                .apicmob-resource-usage .usage-scroll { max-height: 32vh; overflow: auto; border: 1px solid #ebeef5; }
                .apicmob-resource-usage table { width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; table-layout: fixed; }
                .apicmob-resource-usage th, .apicmob-resource-usage td { padding: 8px; border-bottom: 1px solid #ebeef5; vertical-align: top; overflow-wrap: anywhere; }
                .apicmob-resource-usage th { position: sticky; top: 0; z-index: 1; background: #f5f7fa; font-weight: 500; }
                .apicmob-resource-usage small { display: block; color: #606266; font-size: 12px; }
                .apicmob-resource-usage .usage-error { color: #b54141; }
                .apicmob-resource-usage .usage-success { color: #23804b; }
                .apicmob-resource-usage .usage-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
                .apicmob-resource-usage .usage-footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
                .apicmob-resource-usage .el-button { font-size: 13px; line-height: 20px; padding: 6px 12px; }
                .apicmob-resource-usage input[type=checkbox], .apicmob-resource-usage input[type=radio] { accent-color: #409eff; }
            `;
            const heading = make('h3', '资源引用与批量替换');
            heading.id = 'apicmob-usage-title';
            const summary = make('p');
            const note = make('small', '展示应用分布及配置接口已返回并核对的引用，配置总览完整性未确认。');
            const toolbar = make('div', undefined, 'usage-toolbar');
            const selectAllLabel = make('label');
            const selectAll = make('input');
            selectAll.type = 'checkbox';
            selectAll.setAttribute('aria-label', '全选可替换配置');
            selectAllLabel.append(selectAll, doc.createTextNode(' 全选可替换配置'));
            const refresh = make('button', '刷新引用', 'el-button el-button--default el-button--small');
            toolbar.append(selectAllLabel, refresh);
            function table(headers, widths, label) {
                const scroll = make('div', undefined, 'usage-scroll');
                scroll.setAttribute('aria-label', label);
                const element = make('table');
                element.style.minWidth = widths.reduce((total, width) => total + width, 0) + 'px';
                const header = make('tr');
                headers.forEach((name, index) => {
                    const cell = make('th', name);
                    cell.scope = 'col';
                    cell.style.width = widths[index] + 'px';
                    header.append(cell);
                });
                const head = make('thead');
                const body = make('tbody');
                head.append(header);
                element.append(head, body);
                scroll.append(element);
                return { scroll, body };
            }
            const refs = table(['选择', 'App', '配置', '类型 / 状态', '引用位置 / 权重', '活跃 SDK 版本 / 应用版本 / 活跃度'],
                [48, 180, 190, 90, 130, 290], '引用配置列表');
            const candidates = table(['选择', '资源标识 / 附加信息', '资源版本', '资源 ID', '文件名 / 备注'],
                [48, 220, 190, 230, 240], '可选资源列表');
            const errors = make('div', undefined, 'usage-error');
            const status = make('p', '正在读取资源…');
            status.setAttribute('role', 'status');
            const resultArea = make('div');
            const footer = make('div', undefined, 'usage-footer');
            const close = make('button', '关闭', 'el-button el-button--default el-button--small');
            const submit = make('button', '一键替换（0 个配置）', 'el-button el-button--primary el-button--small');
            footer.append(close, submit);
            panel.append(style, heading, summary, note, make('h4', '引用配置'), toolbar, refs.scroll, errors,
                make('h4', '替换为'), candidates.scroll, status, resultArea, footer);
            const view = { panel, vm, loading: false, busy: false, executed: false, selected: new Set(), entries: [], target: null, generation: 0 };
            state = view;
            const current = () => state === view && panel.open && active() && vm.isActive && !vm._isDestroyed;
            const lock = () => view.loading || view.busy || !current();
            function controls() {
                const eligible = view.entries.filter((entry) => !unavailable(entry, view.definition));
                selectAll.checked = eligible.length > 0 && eligible.every((entry) => view.selected.has(id(entry.config.id)));
                selectAll.indeterminate = view.selected.size > 0 && !selectAll.checked;
                selectAll.disabled = lock() || !eligible.length || view.executed;
                refresh.disabled = lock();
                close.disabled = view.busy;
                submit.textContent = `一键替换（${view.selected.size} 个配置）`;
                submit.disabled = lock() || view.executed || !view.target || !view.selected.size;
                panel.querySelectorAll('input[data-choice]').forEach((input) => {
                    input.disabled = lock() || view.executed || input.dataset.unavailable === 'true';
                });
            }
            view.updateControls = controls;
            function cell(row, value, secondary) {
                const element = make('td', value);
                if (secondary !== undefined) element.append(make('small', secondary));
                row.append(element);
                return element;
            }
            function renderRefs() {
                refs.body.replaceChildren();
                for (const entry of view.entries) {
                    const row = make('tr');
                    const checkbox = make('input');
                    const reason = unavailable(entry, view.definition);
                    checkbox.type = 'checkbox';
                    checkbox.dataset.choice = 'config';
                    checkbox.dataset.unavailable = String(Boolean(reason));
                    checkbox.checked = view.selected.has(id(entry.config.id));
                    checkbox.setAttribute('aria-label', `选择配置 ${entry.app.name} / ${entry.config.name}`);
                    checkbox.title = reason;
                    checkbox.onchange = () => {
                        if (checkbox.checked) view.selected.add(id(entry.config.id));
                        else view.selected.delete(id(entry.config.id));
                        controls();
                    };
                    cell(row).append(checkbox);
                    cell(row, entry.app.name, id(entry.app.id));
                    cell(row, entry.config.name, id(entry.config.id));
                    cell(row, TYPES[entry.config.type] || '未知', entry.config.status === 'active' ? '启用' : '暂停');
                    const locations = cell(row);
                    entry.references.forEach((ref) => locations.append(make('div',
                        `${CHANNELS.find((channel) => channel.key === ref.channel).label} / ${ref.binding.weight}`)));
                    const versions = cell(row);
                    if (entry.versionState === 'na') versions.textContent = '不适用（无独立版本分配）';
                    else if (entry.versionState === 'error') versions.append(make('span', '版本读取失败', 'usage-error'));
                    else if (!entry.versions.length) versions.textContent = '没有活跃版本';
                    else entry.versions.forEach((version) => {
                        const line = make('div', `${version.release_version || '未知 SDK 版本'} / ${version.version || '未知应用版本'} / ${version.activity}`);
                        line.title = [version.bundle_id, version.hash, id(version.id)].filter(Boolean).join(' / ');
                        versions.append(line);
                    });
                    if (reason) versions.append(make('small', reason, 'usage-error'));
                    refs.body.append(row);
                }
                if (!view.entries.length) {
                    const row = make('tr');
                    const empty = cell(row, '尚未读取到已确认的引用配置');
                    empty.colSpan = 6;
                    refs.body.append(row);
                }
            }
            function renderCandidates(rows) {
                candidates.body.replaceChildren();
                for (const candidate of rows) {
                    const row = make('tr');
                    const radio = make('input');
                    radio.type = 'radio';
                    radio.name = 'apicmob-usage-target';
                    radio.dataset.choice = 'target';
                    radio.dataset.unavailable = String(candidate.status !== 'active' || typeof candidate.resource_ver !== 'string');
                    radio.setAttribute('aria-label', `选择目标资源 ${candidate.resource_ver || '空版本'} ${id(candidate.id)}`);
                    radio.onchange = () => { view.target = candidate; controls(); };
                    cell(row).append(radio);
                    cell(row, candidate.resource, extra(candidate.remark) || '（空附加信息）');
                    cell(row, candidate.resource_ver || '（空版本）', radio.dataset.unavailable === 'true' ? '不可选' : '');
                    cell(row, id(candidate.id));
                    cell(row, candidate.filename || '（无文件名）', candidate.description || '');
                    candidates.body.append(row);
                }
                if (!rows.length) {
                    const row = make('tr');
                    cell(row, '没有资源标识与附加信息均相同的其他资源').colSpan = 5;
                    candidates.body.append(row);
                }
            }
            function renderResults(outcome) {
                view.executed = true;
                resultArea.replaceChildren(make('h4', '本次替换结果'));
                for (const result of outcome.results) {
                    const block = make('div', undefined, result.status === 'success' ? 'usage-success'
                        : ['partial', 'failed'].includes(result.status) ? 'usage-error' : '');
                    block.append(make('p', `${result.entry.app.name} / ${result.entry.config.name}：${STATES[result.status]} · ${result.message}`));
                    for (const ref of result.completed) block.append(make('small',
                        `${CHANNELS.find((channel) => channel.key === ref.channel).label}：${ref.oldBindingId} → ${ref.newBindingId}，权重 ${ref.weight}`));
                    resultArea.append(block);
                }
            }
            async function load() {
                if (view.loading || view.busy || !current()) return;
                const generation = ++view.generation;
                const canRead = () => current() && generation === view.generation;
                view.loading = true;
                view.executed = false;
                view.selected.clear();
                view.target = null;
                view.entries = [];
                view.definition = null;
                refs.body.replaceChildren();
                candidates.body.replaceChildren();
                errors.replaceChildren();
                controls();
                try {
                    const catalog = await core.allRows(request, DIRECTORY);
                    const definition = catalog.find((row) => id(row.id) === id(displayed.id));
                    if (!definition || definition.resource !== displayed.resource || extra(definition.remark) !== extra(displayed.remark)
                        || definition.resource_ver !== displayed.resource_ver) throw new Error('资源目录已变化，请刷新资源页后重新打开。');
                    if (!canRead()) return;
                    view.definition = definition;
                    summary.textContent = `${definition.resource} / ${extra(definition.remark) || '（空附加信息）'} / ${definition.resource_ver || '（空版本）'} / ${id(definition.id)}`;
                    renderCandidates(core.matchingResources(catalog, definition));
                    const data = await readUsage(request, definition, core, canRead, (done, total) => {
                        if (canRead()) status.textContent = `正在读取引用配置：${done} / ${total} 个 App`;
                    });
                    if (!canRead()) return;
                    view.entries = data.entries;
                    data.issues.forEach((issue) => errors.append(make('p', issue)));
                    renderRefs();
                    status.textContent = `已确认 ${data.entries.length} 个配置引用；${data.issues.length} 项读取异常。`;
                } catch (error) {
                    if (canRead()) status.textContent = `读取失败：${error.message}`;
                } finally {
                    view.loading = false;
                    controls();
                }
            }
            selectAll.onchange = () => {
                const checked = selectAll.checked;
                view.selected.clear();
                if (checked) view.entries.filter((entry) => !unavailable(entry, view.definition))
                    .forEach((entry) => view.selected.add(id(entry.config.id)));
                renderRefs();
                controls();
            };
            refresh.onclick = load;
            close.onclick = () => { if (!view.busy) panel.close(); };
            panel.addEventListener('cancel', (event) => { if (view.busy) event.preventDefault(); });
            panel.addEventListener('close', () => {
                view.generation++;
                panel.remove();
                if (state === view) state = null;
            });
            submit.onclick = async () => {
                if (lock() || view.executed || !view.selected.size || !view.target) return;
                view.busy = true;
                controls();
                status.textContent = '正在预检全部勾选配置…';
                try {
                    const outcome = await replaceBatch(request, view.entries.filter((entry) => view.selected.has(id(entry.config.id))),
                        view.definition, view.target, core, current, (progress) => {
                            renderResults(progress);
                            controls();
                        });
                    renderResults(outcome);
                    status.textContent = outcome.stopped ? `批次已停止：${outcome.error}` : '所选配置替换完成。';
                    if (outcome.started) {
                        try {
                            const data = await readUsage(request, view.definition, core, () => panel.open);
                            view.entries = data.entries;
                            view.selected.clear();
                            errors.replaceChildren();
                            data.issues.forEach((issue) => errors.append(make('p', issue)));
                            renderRefs();
                        } catch (error) {
                            errors.append(make('p', `替换后刷新失败：${error.message}`));
                        }
                    }
                } finally {
                    view.busy = false;
                    controls();
                }
            };
            doc.body.append(panel);
            panel.showModal();
            load();
        }

        function sync() {
            const found = active() ? findTable(win) : null;
            if (attached && (attached.column !== found?.column || attached.column.slots.default !== attached.render)) {
                const { table, column, original, render, width } = attached;
                if (column.slots.default === render) column.slots.default = original;
                column.width = width;
                attached = null;
                if (!table._isDestroyed) table.refreshColumn();
            }
            if (state && !state.busy && !state.executed && (!active() || state.vm._isDestroyed || !state.vm.isActive)) state.panel.close();
            state?.updateControls();
            if (!found || attached) return;
            const { table, column, vm } = found;
            const original = column.slots.default;
            const width = column.width;
            function render(params, h) {
                const native = [].concat(original.call(this, params, h) || []);
                if (!id(params.row.id)) return native;
                return native.concat(h('button', {
                    class: 'el-button el-button--text el-button--small',
                    style: { marginLeft: '8px', fontSize: '13px', lineHeight: '20px', padding: '6px 4px' },
                    attrs: { type: 'button', title: '查看引用配置并批量替换' },
                    on: { click: (event) => { event.stopPropagation(); open(vm, { ...params.row }); } }
                }, ['引用配置']));
            }
            attached = { table, column, original, render, width };
            column.width = (Number(width) || 150) + 100;
            column.slots.default = render;
            Promise.resolve(table.refreshColumn()).catch((error) => win.console.error('[资源引用]', error));
        }
        runtime.watch(sync);
    }

    return { isResourcePage, readUsage, unavailable, replaceBatch, boot };
});
