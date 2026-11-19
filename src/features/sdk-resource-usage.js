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
            const channelLabel = (key) => CHANNELS.find((channel) => channel.key === key).label;
            const versionLabel = (value) => value || '（空版本）';
            const panel = make('dialog', undefined, 'apicmob-dialog apicmob-dialog-wide');
            panel.setAttribute('aria-labelledby', 'apicmob-usage-title');
            const head = make('div', undefined, 'dlg-head');
            const heading = make('h3', '资源引用与批量替换');
            heading.id = 'apicmob-usage-title';
            const dismiss = make('button', '×', 'dlg-x');
            dismiss.type = 'button';
            dismiss.setAttribute('aria-label', '关闭');
            head.append(heading, dismiss);
            const source = make('div', undefined, 'dlg-source');
            function renderSource(definition) {
                source.replaceChildren(make('span', '当前资源', 'dlg-source-label'), make('span', definition.resource, 'dlg-key'),
                    make('span', extra(definition.remark) || '（空附加信息）', 'tag'),
                    make('span', definition.resource_ver ? '版本 ' + definition.resource_ver : '空版本', 'tag tag-primary'));
                if (definition.status !== 'active') source.append(make('span', '未启用', 'tag tag-danger'));
                source.append(make('span', '展示应用分布及配置接口已返回并核对的引用，配置总览完整性未确认。', 'dlg-note'));
            }
            renderSource(displayed);
            const resultArea = make('div', undefined, 'dlg-results');
            function step(number, title) {
                const bar = make('div', undefined, 'dlg-toolbar');
                const label = make('h4', undefined, 'dlg-step');
                label.append(make('span', String(number), 'dlg-step-num'), doc.createTextNode(title));
                const meta = make('span', '', 'dlg-meta');
                bar.append(label, meta);
                return { bar, meta };
            }
            function headRow(names) {
                const row = make('div', undefined, 'dlg-row dlg-row-head');
                row.setAttribute('aria-hidden', 'true');
                names.forEach((name) => row.append(make('span', name)));
                return row;
            }
            const configStep = step(1, '选择要替换的配置');
            const selectAllLabel = make('label', undefined, 'dlg-check dlg-push');
            const selectAll = make('input');
            selectAll.type = 'checkbox';
            selectAll.setAttribute('aria-label', '全选可替换配置');
            selectAllLabel.append(selectAll, doc.createTextNode('全选可替换'));
            const refresh = make('button', undefined, 'el-button el-button--text el-button--small');
            refresh.type = 'button';
            refresh.append(make('i', undefined, 'el-icon-refresh'), doc.createTextNode(' 刷新引用'));
            configStep.bar.append(selectAllLabel, refresh);
            const refs = make('div', undefined, 'dlg-list dlg-refs');
            refs.setAttribute('aria-label', '引用配置列表');
            const errors = make('div', undefined, 'dlg-alert');
            const configSection = make('section', undefined, 'dlg-section');
            configSection.append(configStep.bar, refs, errors);
            const targetStep = step(2, '选择替换目标');
            function makeFilter(name) {
                const input = make('input', undefined, 'el-input__inner');
                input.type = 'search';
                input.placeholder = name;
                input.setAttribute('aria-label', name);
                targetStep.bar.append(input);
                return input;
            }
            const remarkFilter = makeFilter('筛选备注');
            remarkFilter.className += ' dlg-push';
            const versionFilter = makeFilter('筛选动态版本');
            const candidates = make('div', undefined, 'dlg-list dlg-targets');
            candidates.setAttribute('role', 'radiogroup');
            candidates.setAttribute('aria-label', '可选资源列表');
            const targetSection = make('section', undefined, 'dlg-section');
            targetSection.append(targetStep.bar, candidates);
            const body = make('div', undefined, 'dlg-body');
            body.append(source, resultArea, configSection, targetSection);
            const status = make('p');
            status.setAttribute('role', 'status');
            const setStatus = (text, tone) => {
                status.textContent = text;
                status.className = tone ? 'dlg-status is-' + tone : 'dlg-status';
            };
            setStatus('正在读取资源…', 'loading');
            const actions = make('div', undefined, 'dlg-actions');
            const close = make('button', '关闭', 'el-button el-button--default el-button--small');
            const submit = make('button', '一键替换（0 个配置）', 'el-button el-button--primary el-button--small');
            actions.append(close, submit);
            const foot = make('div', undefined, 'dlg-foot');
            foot.append(status, actions);
            panel.append(make('style', core.DIALOG_STYLE), head, body, foot);
            const view = { panel, vm, loading: false, busy: false, executed: false, selected: new Set(), entries: [], target: null,
                candidates: [], visible: 0, generation: 0 };
            state = view;
            const current = () => state === view && panel.open && active() && vm.isActive && !vm._isDestroyed;
            const lock = () => view.loading || view.busy || !current();
            function controls() {
                const eligible = view.entries.filter((entry) => !unavailable(entry, view.definition));
                selectAll.checked = eligible.length > 0 && eligible.every((entry) => view.selected.has(id(entry.config.id)));
                selectAll.indeterminate = view.selected.size > 0 && !selectAll.checked;
                selectAll.disabled = lock() || !eligible.length || view.executed;
                refresh.disabled = lock();
                close.disabled = dismiss.disabled = view.busy;
                remarkFilter.disabled = versionFilter.disabled = lock() || view.executed || !view.candidates.length;
                submit.textContent = `一键替换（${view.selected.size} 个配置）`;
                submit.disabled = lock() || view.executed || !view.target || !view.selected.size;
                panel.querySelectorAll('input[data-choice]').forEach((input) => {
                    input.disabled = lock() || view.executed || input.dataset.unavailable === 'true';
                });
                const blocked = view.entries.length - eligible.length;
                configStep.meta.textContent = view.entries.length
                    ? `已选 ${view.selected.size} / ${eligible.length}${blocked ? ` · ${blocked} 个不可替换` : ''}` : '';
                targetStep.meta.textContent = [view.candidates.length && `${view.visible} / ${view.candidates.length} 条`,
                    view.target && `已选 ${versionLabel(view.target.resource_ver)}`].filter(Boolean).join(' · ');
            }
            view.updateControls = controls;
            function renderRefs() {
                if (!view.entries.length) {
                    refs.replaceChildren(make('div', view.loading ? '正在读取引用配置…' : '尚未读取到已确认的引用配置', 'dlg-empty'));
                    return;
                }
                refs.replaceChildren(headRow(['', 'App', '配置', '类型 / 状态', '引用位置 · 权重', '活跃版本（SDK · 应用 · 活跃度）']));
                for (const entry of view.entries) {
                    const reason = unavailable(entry, view.definition);
                    const row = make('label', undefined, reason ? 'dlg-row is-unavailable' : 'dlg-row');
                    const checkbox = make('input');
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
                    const app = make('span', entry.app.name);
                    app.title = 'App ID：' + id(entry.app.id);
                    const config = make('span', entry.config.name);
                    config.title = '配置 ID：' + id(entry.config.id);
                    const kind = make('span', undefined, 'dlg-tags');
                    kind.append(make('span', TYPES[entry.config.type] || '未知', 'tag'), entry.config.status === 'active'
                        ? make('span', '启用', 'tag tag-success') : make('span', '暂停', 'tag tag-warning'));
                    const locations = make('span', undefined, 'dlg-tags');
                    entry.references.forEach((ref) => locations.append(make('span',
                        `${channelLabel(ref.channel)} · ${ref.binding.weight}`, 'tag tag-primary')));
                    const versions = make('span', undefined, 'dlg-lines');
                    if (entry.versionState === 'na') versions.append(make('span', '不适用（无独立版本分配）', 'dlg-sub'));
                    else if (entry.versionState === 'error') versions.append(make('span', '版本读取失败', 'dlg-reason'));
                    else if (!entry.versions.length) versions.append(make('span', '没有活跃版本', 'dlg-sub'));
                    else entry.versions.forEach((version) => {
                        const line = make('span', `SDK ${version.release_version || '未知'} · 应用 ${version.version || '未知'} · 活跃 ${version.activity}`);
                        line.title = [version.bundle_id, version.hash, id(version.id)].filter(Boolean).join(' / ');
                        versions.append(line);
                    });
                    row.append(checkbox, app, config, kind, locations, versions);
                    if (reason) row.append(make('span', reason, 'dlg-reason'));
                    refs.append(row);
                }
            }
            function renderCandidates() {
                const rows = core.filterResources(view.candidates, remarkFilter.value, versionFilter.value);
                if (!rows.includes(view.target)) view.target = null;
                view.visible = rows.length;
                if (!rows.length) {
                    candidates.replaceChildren(make('div', view.loading && !view.definition ? '正在读取资源…'
                        : view.candidates.length ? '没有符合筛选条件的资源' : '没有资源标识与附加信息均相同的其他资源', 'dlg-empty'));
                    return;
                }
                candidates.replaceChildren(headRow(['', '动态版本', '原文件名', '备注']));
                for (const candidate of rows) {
                    const blocked = candidate.status !== 'active' ? '未启用'
                        : typeof candidate.resource_ver !== 'string' ? '版本异常' : '';
                    const row = make('label', undefined, blocked ? 'dlg-row is-unavailable' : 'dlg-row');
                    const radio = make('input');
                    radio.type = 'radio';
                    radio.name = 'apicmob-usage-target';
                    radio.dataset.choice = 'target';
                    radio.dataset.unavailable = String(Boolean(blocked));
                    radio.checked = candidate === view.target;
                    radio.setAttribute('aria-label', `选择目标资源 ${versionLabel(candidate.resource_ver)} ${candidate.filename || ''}`.trim());
                    radio.onchange = () => { view.target = candidate; controls(); };
                    const version = make('span');
                    version.append(make('span', versionLabel(candidate.resource_ver), 'dlg-mono'));
                    if (blocked) version.append(make('span', blocked, 'tag tag-danger'));
                    row.append(radio, version, make('span', candidate.filename || '—'),
                        make('span', candidate.description || '—', candidate.description ? undefined : 'dlg-sub'));
                    candidates.append(row);
                }
            }
            const TONES = { pending: 'tag', running: 'tag tag-primary', success: 'tag tag-success', failed: 'tag tag-danger', partial: 'tag tag-danger' };
            function renderResults(outcome) {
                view.executed = true;
                resultArea.replaceChildren(make('h4', '本次替换结果'));
                for (const result of outcome.results) {
                    const block = make('div', undefined, 'dlg-result');
                    block.append(make('span', STATES[result.status], TONES[result.status]),
                        make('span', `${result.entry.app.name} / ${result.entry.config.name}`));
                    if (result.message !== STATES[result.status]) {
                        block.append(make('span', result.message, ['partial', 'failed'].includes(result.status) ? 'dlg-reason' : 'dlg-sub'));
                    }
                    if (result.completed.length) {
                        const details = make('details');
                        details.append(make('summary', `绑定明细（${result.completed.length}）`));
                        for (const ref of result.completed) details.append(make('div',
                            `${channelLabel(ref.channel)}：${ref.oldBindingId} → ${ref.newBindingId}，权重 ${ref.weight}`));
                        block.append(details);
                    }
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
                view.candidates = [];
                view.definition = null;
                setStatus('正在读取资源…', 'loading');
                renderRefs();
                renderCandidates();
                errors.replaceChildren();
                controls();
                try {
                    const catalog = await core.allRows(request, DIRECTORY);
                    const definition = catalog.find((row) => id(row.id) === id(displayed.id));
                    if (!definition || definition.resource !== displayed.resource || extra(definition.remark) !== extra(displayed.remark)
                        || definition.resource_ver !== displayed.resource_ver) throw new Error('资源目录已变化，请刷新资源页后重新打开。');
                    if (!canRead()) return;
                    view.definition = definition;
                    renderSource(definition);
                    view.candidates = core.matchingResources(catalog, definition);
                    renderCandidates();
                    const data = await readUsage(request, definition, core, canRead, (done, total) => {
                        if (canRead()) setStatus(`正在读取引用配置：${done} / ${total} 个 App`, 'loading');
                    });
                    if (!canRead()) return;
                    view.entries = data.entries;
                    data.issues.forEach((issue) => errors.append(make('p', issue)));
                    renderRefs();
                    setStatus(`已确认 ${data.entries.length} 个配置引用${data.issues.length ? `；${data.issues.length} 项读取异常` : ''}。`,
                        data.issues.length ? 'error' : '');
                } catch (error) {
                    if (canRead()) setStatus(`读取失败：${error.message}`, 'error');
                } finally {
                    view.loading = false;
                    if (generation === view.generation) {
                        renderRefs();
                        renderCandidates();
                    }
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
            remarkFilter.oninput = versionFilter.oninput = () => {
                renderCandidates();
                controls();
            };
            refresh.onclick = load;
            close.onclick = dismiss.onclick = () => { if (!view.busy) panel.close(); };
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
                setStatus('正在预检全部勾选配置…', 'loading');
                body.scrollTop = 0;
                try {
                    const outcome = await replaceBatch(request, view.entries.filter((entry) => view.selected.has(id(entry.config.id))),
                        view.definition, view.target, core, current, (progress) => {
                            const running = progress.results.find((result) => result.status === 'running');
                            if (running) setStatus(`正在替换 ${running.entry.app.name} / ${running.entry.config.name}…`, 'loading');
                            renderResults(progress);
                            controls();
                        });
                    renderResults(outcome);
                    setStatus(outcome.stopped ? `批次已停止：${outcome.error}` : '所选配置替换完成。', outcome.stopped ? 'error' : 'success');
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
