(function (factory) {
    'use strict';

    const core = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = core;
    }
})(function createModuleApplyTemplate() {
    'use strict';

    // ===================== 常量 =====================

    const CMS_API = 'https://cmsapi.apicmob.com/api';
    const SDK_API = 'https://cms-sdk-api.apicmob.com/api';

    // X-Token 带的是 CMS 主版本号，不是凭证。真正的凭证是 cookie appic_6.x_cms_token，
    // 靠 credentials:'include' 自动携带。版本落后于线上部署会被 {"code":401} 全量拒绝，
    // 所以优先用页面自己发出的值，常量只作最后兜底。
    const FALLBACK_VERSION = '8.2.34';

    const ROUTE_PATH = '/system/custom-configuration/module-edit';
    const TYPE_H5_LINK = 'SdkH5ManageLinkConfiguration';
    const TYPE_SDK_OVERVIEW = 'sdk_overview';

    const PENDING_KEY = 'apicmob-apply-template::pending';
    const REPORT_KEY = 'apicmob-apply-template::report';
    const PENDING_TTL = 5 * 60 * 1000;

    const BTN_ID = 'apicmob-apply-template-btn';
    const MODAL_ID = 'apicmob-apply-template-modal';
    const PANEL_ID = 'apicmob-apply-template-panel';
    let featureEnabled = () => true;

    // 这些类型在配置里是「容器」，没有自己的 field_value
    const CONTAINER_TYPES = ['object', 'object_array'];

    // ===================== 工具 =====================

    const clone = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

    function readCookie(name) {
        const hit = document.cookie.split('; ').find((kv) => kv.startsWith(name + '='));
        return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
    }

    function routePath() {
        const h = location.hash.replace(/^#/, '');
        const qi = h.indexOf('?');
        return qi < 0 ? h : h.slice(0, qi);
    }

    function routeQuery() {
        const h = location.hash;
        const qi = h.indexOf('?');
        if (qi < 0) {
            return {};
        }
        const out = {};
        new URLSearchParams(h.slice(qi + 1)).forEach((v, k) => { out[k] = v; });
        return out;
    }

    const isModuleEditPage = () => routePath() === ROUTE_PATH;

    function readSession(key) {
        try {
            const raw = sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function writeSession(key, value) {
        try {
            sessionStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn('[套用模板] 写入 sessionStorage 失败', e);
            return false;
        }
    }

    function downloadJSON(filename, data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    // ===================== XHR 钩子（必须最先执行） =====================
    //
    // 两件事：
    //   1. 嗅探页面真实发出的 X-Token，供脚本自己的请求复用，避免 CMS 升版后被 401。
    //   2. 一次性改写 module_config/detail 的响应，把旧配置的值合并进服务端返回的新结构里。
    //
    // 改写走「原型级重定义 responseText / response 的 getter」，与 axios 注册 handler 的
    // 先后顺序无关，比包装 onreadystatechange 稳得多。

    let sniffedVersion = '';

    const getVersion = () => sniffedVersion || readCookie('appic_cms_main_version') || FALLBACK_VERSION;

    function installXhrHooks() {
        const XHR = XMLHttpRequest.prototype;

        const rawSetRequestHeader = XHR.setRequestHeader;
        XHR.setRequestHeader = function (key, value) {
            if (String(key).toLowerCase() === 'x-token' && value) {
                sniffedVersion = String(value);
            }
            return rawSetRequestHeader.apply(this, arguments);
        };

        // 同一个 xhr 实例的 getter 可能被读多次，缓存改写结果，保证只消费一次 pending 记录
        const rewritten = new WeakMap();

        function rewriteIfNeeded(xhr, raw) {
            if (typeof raw !== 'string' || !raw) {
                return raw;
            }
            if (rewritten.has(xhr)) {
                return rewritten.get(xhr);
            }
            // A migration already in progress must survive a settings change.
            if (!featureEnabled() && !readSession(PENDING_KEY)) {
                return raw;
            }

            const url = xhr.responseURL || '';
            if (url.indexOf('/cms2/system/module_config/detail') < 0) {
                return raw;
            }

            const pending = readSession(PENDING_KEY);
            if (!pending || !pending.moduleId) {
                return raw;
            }
            if (Date.now() - (pending.ts || 0) > PENDING_TTL) {
                sessionStorage.removeItem(PENDING_KEY);
                return raw;
            }
            if (new URL(url).searchParams.get('id') !== String(pending.moduleId)) {
                return raw;
            }

            let out = raw;
            try {
                const body = JSON.parse(raw);
                const fieldList = body && body.result && body.result.field_list;
                if ((body.code === 200 || body.code === 0) && Array.isArray(fieldList)) {
                    // 只改值，绝不动结构：节点 id / children_object_array 的骨架全是服务端原生的
                    const report = migrateValues(pending.oldFieldList || [], fieldList);
                    out = JSON.stringify(body);

                    const base = {
                        moduleId: pending.moduleId,
                        moduleName: pending.newName,
                        templateName: pending.templateName,
                        oldName: pending.oldName,
                        oldModuleId: pending.oldModuleId,
                        report: report,
                        ts: Date.now()
                    };
                    // 配置很大时可能超出 sessionStorage 配额，宁可丢掉两份全量快照也要保住报告本身
                    if (!writeSession(REPORT_KEY, Object.assign({
                        oldFieldList: pending.oldFieldList,
                        mergedFieldList: fieldList
                    }, base))) {
                        writeSession(REPORT_KEY, base);
                    }

                    // 只有真的合并成功才消费 pending，否则留给下一次请求重试（TTL 兜底）
                    sessionStorage.removeItem(PENDING_KEY);
                }
            } catch (e) {
                console.error('[套用模板] 合并旧值失败，已保留服务端原始响应', e);
                out = raw;
            }

            rewritten.set(xhr, out);
            return out;
        }

        ['responseText', 'response'].forEach((prop) => {
            const desc = Object.getOwnPropertyDescriptor(XHR, prop);
            if (!desc || !desc.get) {
                return;
            }
            Object.defineProperty(XHR, prop, {
                configurable: true,
                enumerable: desc.enumerable,
                get: function () {
                    const raw = desc.get.call(this);
                    try {
                        return rewriteIfNeeded(this, raw);
                    } catch (e) {
                        return raw;
                    }
                }
            });
        });
    }

    // ===================== API =====================

    async function request(host, path, options) {
        const opts = options || {};
        const url = new URL(host + path);
        if (opts.params) {
            Object.keys(opts.params).forEach((k) => {
                if (opts.params[k] !== undefined && opts.params[k] !== null) {
                    url.searchParams.set(k, opts.params[k]);
                }
            });
        }

        const headers = { accept: 'application/json, text/plain, */*', 'x-token': getVersion() };
        if (opts.data !== undefined) {
            headers['content-type'] = 'application/json;charset=UTF-8';
        }

        const res = await fetch(url.toString(), {
            method: opts.data !== undefined ? 'POST' : 'GET',
            credentials: 'include',
            headers: headers,
            body: opts.data !== undefined ? JSON.stringify(opts.data) : undefined
        });

        let body;
        try {
            body = await res.json();
        } catch (e) {
            throw new Error(`${path} 返回的不是合法 JSON（HTTP ${res.status}）`);
        }

        // 401 是以 HTTP 200 的 body 返回的，所以判 body.code 而不是 res.ok
        const code = body && body.code;
        if (code === 401) {
            throw new Error('登录态或 CMS 版本号失效（code 401）。请重新登录 CMS；若仍失败，说明 CMS 已升版，需要更新脚本里的 FALLBACK_VERSION。');
        }
        if (code !== 200 && code !== 0) {
            throw new Error(`${path} 失败：code=${code} ${(body && (body.msg || body.message)) || ''}`);
        }
        return body;
    }

    const api = {
        templateAll: () => request(CMS_API, '/cms2/system/config_template/all'),
        templateFields: (id) => request(CMS_API, '/cms2/system/config_template/module/index', { params: { id } }),
        moduleDetail: (id) => request(CMS_API, '/cms2/system/module_config/detail', { params: { id } }),
        moduleIndex: (page, size, keyword) =>
            request(CMS_API, '/cms2/system/module_config/index', { params: { page, size, keyword: keyword || '' } }),
        moduleAdd: (data) => request(CMS_API, '/cms2/system/module_config/add', { data }),
        h5LinkAll: () => request(SDK_API, '/cms2/sdk/h5/link/all'),
        h5ModuleDelete: (linkId) => request(SDK_API, '/cms2/sdk/h5/module_config/delete', { data: { id: linkId } }),
        h5ModuleAdd: (data) => request(SDK_API, '/cms2/sdk/h5/module_config/add', { data }),
        sdkConfigDetail: (id) => request(SDK_API, '/cms2/sdk/config/detail', { params: { id } }),
        sdkModuleDelete: (configId) => request(SDK_API, '/cms2/sdk/config/module_config/delete', { data: { id: configId } }),
        sdkModuleAdd: (data) => request(SDK_API, '/cms2/sdk/config/module_config/add', { data })
    };

    const listOf = (body) => (body && body.result && Array.isArray(body.result.list) ? body.result.list : []);

    // ===================== 路径与差异算法 =====================
    //
    // 匹配依据：优先 export 的完整路径（key + key 所处的结构），缺失时退回名称路径。
    //
    // 两边的「行模板」取法不同：
    //   - 模版树（config_template/module/index）：object_array 的行模板就是 children
    //   - 模组配置（module_config/detail）：object_array 的行模板是 template_object_array，
    //     children_object_array 才是实际的行数据

    function rowTemplateOf(node, kind) {
        const key = kind === 'template' ? 'children' : 'template_object_array';
        return Array.isArray(node[key]) ? node[key] : [];
    }

    function childrenOf(node, kind) {
        if (node.type === 'object') {
            return Array.isArray(node.children) ? node.children : [];
        }
        if (node.type === 'object_array') {
            return rowTemplateOf(node, kind);
        }
        return [];
    }

    const exSeg = (n) => (n.export ? String(n.export) : '#' + String(n.name || ''));
    const nmSeg = (n) => String(n.name || '');

    /** 把一棵字段树压平成「路径 -> 节点信息」的骨架，object_array 用行模板参与，行数据不参与 */
    function collectSkeleton(list, kind) {
        const rows = [];
        (function walk(nodes, exPath, nmPath) {
            (nodes || []).forEach((n) => {
                const ex = exPath + '/' + exSeg(n);
                const nm = nmPath + '/' + nmSeg(n);
                rows.push({
                    exPath: ex,
                    nmPath: nm,
                    type: n.type,
                    name: n.name || '',
                    export: n.export || '',
                    mandatory: Number(n.mandatory) === 1,
                    isContainer: CONTAINER_TYPES.indexOf(n.type) >= 0
                });
                walk(childrenOf(n, kind), ex, nm);
            });
        })(list, '', '');
        return rows;
    }

    /** 比对新旧骨架，产出四张清单 */
    function diffSkeleton(oldList, oldKind, newList, newKind) {
        const oldRows = collectSkeleton(oldList, oldKind);
        const newRows = collectSkeleton(newList, newKind);

        const oldByEx = new Map();
        const oldByNm = new Map();
        oldRows.forEach((r) => {
            if (!oldByEx.has(r.exPath)) oldByEx.set(r.exPath, r);
            if (!oldByNm.has(r.nmPath)) oldByNm.set(r.nmPath, r);
        });

        const migrated = [];
        const added = [];
        const typeChanged = [];
        const matchedOld = new Set();

        newRows.forEach((nr) => {
            const hit = oldByEx.get(nr.exPath) || oldByNm.get(nr.nmPath);
            if (!hit) {
                added.push(nr);
                return;
            }
            matchedOld.add(hit.exPath);
            if (hit.type !== nr.type) {
                typeChanged.push(Object.assign({ oldType: hit.type }, nr));
                return;
            }
            if (!nr.isContainer) {
                migrated.push(nr);
            }
        });

        const removed = oldRows.filter((r) => !matchedOld.has(r.exPath));

        return { migrated, removed, added, typeChanged };
    }

    // ===================== 值迁移 =====================

    /** 为一层节点建索引，供同层匹配使用 */
    function indexLevel(nodes) {
        const byEx = new Map();
        const byNm = new Map();
        (nodes || []).forEach((n) => {
            if (!byEx.has(exSeg(n))) byEx.set(exSeg(n), n);
            if (!byNm.has(nmSeg(n))) byNm.set(nmSeg(n), n);
        });
        return { byEx, byNm };
    }

    /**
     * 把 oldNodes 的值原地合并进 newNodes（服务端返回的真实结构）。
     * 只写 field_value 与 children_object_array，绝不改结构。
     */
    function mergeLevel(oldNodes, newNodes, stats) {
        const idx = indexLevel(oldNodes);

        (newNodes || []).forEach((nn) => {
            const on = idx.byEx.get(exSeg(nn)) || idx.byNm.get(nmSeg(nn));
            if (!on || on.type !== nn.type) {
                return;
            }

            if (nn.type === 'object') {
                mergeLevel(Array.isArray(on.children) ? on.children : [], Array.isArray(nn.children) ? nn.children : [], stats);
                return;
            }

            if (nn.type === 'object_array') {
                const tpl = rowTemplateOf(nn, 'module');
                const oldRows = Array.isArray(on.children_object_array) ? on.children_object_array : [];
                nn.children_object_array = oldRows.map((oldRow) => {
                    const row = clone(tpl);
                    blankValues(row);
                    mergeLevel(Array.isArray(oldRow) ? oldRow : [], row, stats);
                    return row;
                });
                stats.rows += nn.children_object_array.length;
                return;
            }

            if (on.field_value !== undefined && on.field_value !== null) {
                nn.field_value = on.field_value;
                stats.values += 1;
            }
        });
    }

    /** 行模板取自服务端时可能带着预设值，先清空再填，与 CMS 自身新建行的行为一致 */
    function blankValues(nodes) {
        (nodes || []).forEach((n) => {
            if (n.type === 'object') {
                blankValues(Array.isArray(n.children) ? n.children : []);
            } else if (n.type === 'object_array') {
                n.children_object_array = [];
            } else {
                n.field_value = '';
            }
        });
    }

    /** 拦截器里调用：合并值 + 用真实的新结构重算差异报告 */
    function migrateValues(oldFieldList, newFieldList) {
        const stats = { values: 0, rows: 0 };
        mergeLevel(oldFieldList, newFieldList, stats);
        const diff = diffSkeleton(oldFieldList, 'module', newFieldList, 'module');
        return Object.assign({ stats }, diff);
    }

    // ===================== 样式 =====================

    function injectStyle() {
        if (document.getElementById('apicmob-apply-template-style')) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'apicmob-apply-template-style';
        style.textContent = `
            .aat-mask {
                position: fixed; inset: 0; z-index: 2147483646;
                background: rgba(0, 0, 0, 0.45);
                display: flex; align-items: center; justify-content: center;
            }
            .aat-modal {
                width: 720px; max-width: calc(100vw - 40px); max-height: calc(100vh - 80px);
                background: #fff; border-radius: 6px; overflow: hidden;
                display: flex; flex-direction: column;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                font-size: 13px; color: #303133;
            }
            .aat-modal * { box-sizing: border-box; }
            .aat-hd {
                padding: 14px 20px; border-bottom: 1px solid #ebeef5;
                font-size: 15px; font-weight: 600;
                display: flex; align-items: center; justify-content: space-between;
            }
            .aat-close { cursor: pointer; color: #909399; font-size: 18px; line-height: 1; }
            .aat-close:hover { color: #1677ff; }
            .aat-bd { padding: 18px 20px; overflow: auto; flex: 1; line-height: 1.7; }
            .aat-ft {
                padding: 12px 20px; border-top: 1px solid #ebeef5;
                display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap;
            }
            .aat-row { margin-bottom: 14px; }
            .aat-label { display: block; margin-bottom: 6px; color: #606266; font-weight: 600; }
            .aat-input, .aat-select {
                width: 100%; padding: 7px 10px; border: 1px solid #dcdfe6;
                border-radius: 4px; font-size: 13px; color: #303133; background: #fff;
            }
            .aat-input:focus, .aat-select:focus { outline: none; border-color: #1677ff; }
            .aat-btn {
                padding: 8px 18px; border-radius: 16px; border: 1px solid #dcdfe6;
                background: #fff; color: #606266; cursor: pointer; font-size: 13px;
                white-space: nowrap;
            }
            .aat-btn:hover { color: #1677ff; border-color: #b6cefa; }
            .aat-btn[disabled] { cursor: not-allowed; opacity: .5; }
            .aat-btn[disabled]:hover { color: #606266; border-color: #dcdfe6; }
            .aat-btn-primary { background: #1677ff; border-color: #1677ff; color: #fff; }
            .aat-btn-primary:hover { background: #4093ff; border-color: #4093ff; color: #fff; }
            .aat-btn-danger { background: #f56c6c; border-color: #f56c6c; color: #fff; }
            .aat-btn-danger:hover { background: #f78989; border-color: #f78989; color: #fff; }
            .aat-btn-danger[disabled]:hover { background: #f56c6c; border-color: #f56c6c; color: #fff; }
            .aat-warn {
                background: #fff1f0; border: 1px solid #ffccc7; color: #cf1322;
                border-radius: 4px; padding: 10px 12px; margin-bottom: 14px;
            }
            .aat-tip {
                background: #f4f4f5; border: 1px solid #e9e9eb; color: #606266;
                border-radius: 4px; padding: 10px 12px; margin-bottom: 14px;
            }
            .aat-group { margin-bottom: 14px; border: 1px solid #ebeef5; border-radius: 4px; }
            .aat-group > summary {
                padding: 8px 12px; cursor: pointer; font-weight: 600;
                background: #fafafa; border-radius: 4px; user-select: none;
            }
            .aat-group ul { margin: 0; padding: 8px 12px 10px 28px; max-height: 190px; overflow: auto; }
            .aat-group li { margin: 2px 0; }
            .aat-path { color: #909399; font-family: Menlo, Consolas, monospace; font-size: 11px; }
            .aat-empty { color: #909399; padding: 8px 12px; }
            .aat-err { color: #cf1322; white-space: pre-wrap; }

            #${PANEL_ID} {
                position: fixed; right: 20px; bottom: 20px; width: 340px; max-width: calc(100vw - 40px);
                z-index: 2147483645; background: #fff;
                border: 1px solid #d4d4d4; border-radius: 6px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                font-size: 12px; color: #303133;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
            }
            #${PANEL_ID} * { box-sizing: border-box; }
            #${PANEL_ID} .aat-p-hd {
                padding: 8px 12px; border-bottom: 1px solid #ebeef5;
                display: flex; align-items: center; justify-content: space-between;
                font-weight: 600; cursor: pointer;
            }
            #${PANEL_ID} .aat-p-bd { padding: 10px 12px; max-height: 50vh; overflow: auto; }
            #${PANEL_ID} .aat-group ul { max-height: 140px; }
            #${PANEL_ID} .aat-p-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
            #${PANEL_ID} .aat-btn { padding: 5px 12px; font-size: 12px; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // ===================== 差异清单渲染 =====================

    function renderList(title, rows, opts) {
        const o = opts || {};
        if (!rows.length) {
            return `<div class="aat-group"><div class="aat-empty">${esc(title)} 0 项</div></div>`;
        }
        const items = rows.map((r) => {
            const star = o.markMandatory && r.mandatory ? ' <span style="color:#f56c6c">*必填</span>' : '';
            const extra = r.oldType ? ` <span class="aat-path">（${esc(r.oldType)} → ${esc(r.type)}）</span>` : '';
            return `<li>${esc(r.name || '(未命名)')}${star}${extra}<br><span class="aat-path">${esc(r.exPath)}</span></li>`;
        }).join('');
        return `<details class="aat-group"${o.open ? ' open' : ''}>
            <summary>${esc(title)} ${rows.length} 项</summary>
            <ul>${items}</ul>
        </details>`;
    }

    function renderDiff(diff, opts) {
        const o = opts || {};
        return [
            `<div class="aat-tip">可迁移 <b>${diff.migrated.length}</b> 项 ·
                将丢弃 <b>${diff.removed.length}</b> 项 ·
                新增待配置 <b>${diff.added.length}</b> 项 ·
                类型变更 <b>${diff.typeChanged.length}</b> 项</div>`,
            renderList('🗑 将被丢弃（旧配置有、新模板没有）', diff.removed, { open: o.open }),
            renderList('➕ 新增，需要你独立额外配置', diff.added, { open: o.open, markMandatory: true }),
            renderList('⚠️ 类型变更，值不迁移', diff.typeChanged, { open: o.open }),
            renderList('✅ 可迁移', diff.migrated, {})
        ].join('');
    }

    // ===================== 弹窗 =====================

    function closeModal() {
        if (applying) {
            return;
        }
        const el = document.getElementById(MODAL_ID);
        if (el) {
            el.remove();
        }
        preserveResult = false;
    }

    function openModal(title) {
        closeModal();
        injectStyle();

        const mask = document.createElement('div');
        mask.id = MODAL_ID;
        mask.className = 'aat-mask';
        mask.innerHTML = `
            <div class="aat-modal">
                <div class="aat-hd"><span>${esc(title)}</span><span class="aat-close">&times;</span></div>
                <div class="aat-bd"></div>
                <div class="aat-ft"></div>
            </div>`;

        mask.querySelector('.aat-close').addEventListener('click', closeModal);
        mask.addEventListener('click', (e) => {
            if (e.target === mask) {
                closeModal();
            }
        });

        document.body.appendChild(mask);
        return {
            body: mask.querySelector('.aat-bd'),
            footer: mask.querySelector('.aat-ft')
        };
    }

    function footerButton(footer, label, className, onClick) {
        const btn = document.createElement('button');
        btn.className = 'aat-btn ' + (className || '');
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        footer.appendChild(btn);
        return btn;
    }

    // ===================== 主流程 =====================

    let applying = false;
    let preserveResult = false;

    /** 分页拉取模组配置行。注意 CMS 的 keyword 是服务端模糊搜索，调用方必须再做一次精确比较 */
    async function listModuleRows(keyword) {
        const all = [];
        for (let page = 1; page <= 5; page += 1) {
            const list = listOf(await api.moduleIndex(page, 100, keyword));
            all.push(...list);
            if (list.length < 100) {
                break;
            }
        }
        return all;
    }

    async function findSdkConfigRow(configId) {
        // config/all 必须带 supply_app_id；详情接口可直接按父配置 id 核对关联。
        const body = await api.sdkConfigDetail(configId);
        const row = body.result;
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new Error('SDK 配置详情返回格式异常，无法核对模组关联。');
        }
        return String(row.id) === String(configId) ? row : null;
    }

    async function startFlow() {
        if (applying || !featureEnabled()) {
            return;
        }
        const query = routeQuery();
        const oldModuleId = query.id;
        const oldName = query.name || '';
        const linkId = query.delid || '';
        const type = query.type || '';
        const isSdk = type === TYPE_SDK_OVERVIEW;
        const destructive = type === TYPE_H5_LINK || isSdk;

        if (!oldModuleId) {
            alert('[套用模板] 当前 URL 里没有模组 id，无法继续。');
            return;
        }
        if (type && !destructive) {
            const ui = openModal('套用模板 — 暂不支持');
            ui.body.innerHTML = `<div class="aat-warn">当前模组挂载类型是 <b>${esc(type)}</b>，暂不支持。</div>
                <p>脚本目前支持：</p>
                <ul>
                    <li><b>${esc(TYPE_H5_LINK)}</b>（H5 链接）— 解绑 + 按模板重绑</li>
                    <li><b>${esc(TYPE_SDK_OVERVIEW)}</b>（SDK 配置）— 解绑 + 按模板重绑</li>
                    <li>URL 不带 <code>type</code> 的独立模组 — 直接新建，非破坏性</li>
                </ul>
                <p>其它挂载类型各有自己的 <code>module_config/add</code> 接口，payload 未经验证，贸然调用有风险，因此先不放开。</p>`;
            footerButton(ui.footer, '知道了', 'aat-btn-primary', closeModal);
            return;
        }

        const ui = openModal('套用模板');
        if (destructive && !linkId) {
            ui.body.innerHTML = '<div class="aat-warn aat-err">当前 URL 里没有关联配置 id（delid），无法继续。</div>';
            footerButton(ui.footer, '关闭', '', closeModal);
            return;
        }
        ui.body.innerHTML = '<div class="aat-empty">正在加载模板列表与当前配置…</div>';

        let templates;
        let detail;
        try {
            const [tplBody, detailBody] = await Promise.all([
                api.templateAll(),
                api.moduleDetail(oldModuleId)
            ]);
            templates = listOf(tplBody);
            detail = (detailBody && detailBody.result) || {};
        } catch (e) {
            ui.body.innerHTML = `<div class="aat-warn aat-err">${esc(e.message)}</div>`;
            footerButton(ui.footer, '关闭', '', closeModal);
            return;
        }

        const currentTplId = detail.module_config_template_id || '';
        const oldFieldList = Array.isArray(detail.field_list) ? detail.field_list : [];
        const displayName = typeof detail.name === 'string' && detail.name.trim() ? detail.name : oldName;
        if (!displayName.trim()) {
            ui.body.innerHTML = '<div class="aat-warn aat-err">无法取得原配置名称，已停止套用模板。</div>';
            footerButton(ui.footer, '关闭', '', closeModal);
            return;
        }
        renderStep1();

        function renderStep1() {
            ui.footer.innerHTML = '';
            ui.body.innerHTML = `
                <div class="aat-tip">
                    当前模组：<b>${esc(displayName)}</b><br>
                    套用后配置名称保持不变。<br>
                    迁移<b>以已保存的配置为准</b>，页面上未保存的手动修改不会被带过去。
                </div>
                <div class="aat-row">
                    <label class="aat-label">目标模组模版</label>
                    <select class="aat-select" id="aat-tpl">
                        <option value="">请选择…</option>
                        ${templates.map((t) => `<option value="${esc(t.id)}"${String(t.id) === String(currentTplId) ? ' disabled' : ''}>${esc(t.name)}${String(t.id) === String(currentTplId) ? '（当前）' : ''}</option>`).join('')}
                    </select>
                </div>`;

            const select = ui.body.querySelector('#aat-tpl');
            const selectedTemplate = () => templates.find((t) => String(t.id) === select.value
                && String(t.id) !== String(currentTplId));

            select.addEventListener('change', () => {
                next.disabled = !selectedTemplate();
            });

            footerButton(ui.footer, '取消', '', closeModal);
            const next = footerButton(ui.footer, '预览变更', 'aat-btn-primary', () => {
                const tpl = selectedTemplate();
                if (tpl) {
                    return renderStep2(tpl);
                }
            });
            next.disabled = true;
        }

        async function renderStep2(template) {
            ui.footer.innerHTML = '';
            ui.body.innerHTML = '<div class="aat-empty">正在拉取模板字段树并比对…</div>';

            let tplFields;
            try {
                tplFields = listOf(await api.templateFields(template.id));
            } catch (e) {
                ui.body.innerHTML = `<div class="aat-warn aat-err">${esc(e.message)}</div>`;
                footerButton(ui.footer, '返回', '', renderStep1);
                return;
            }

            if (!tplFields.length) {
                ui.body.innerHTML = `<div class="aat-warn">模板「${esc(template.name)}」没有任何字段，不能套用。</div>`;
                footerButton(ui.footer, '返回', '', renderStep1);
                return;
            }

            // 预览阶段用模板树预估；真正的报告会在新模组建好后用服务端返回的真实结构重算
            const diff = diffSkeleton(oldFieldList, 'module', tplFields, 'template');
            ui.body.innerHTML = `
                <div class="aat-tip">
                    <b>${esc(displayName)}</b> → 模板 <b>${esc(template.name)}</b>，配置名称保持不变。
                </div>
                ${destructive ? `<div class="aat-warn">
                    <b>破坏性操作。</b>CMS 没有「换模板」接口，只能解绑后按新模板重绑。
                    解绑走的是页面上「解除关联」那颗按钮背后的
                    <code>/cms2/sdk/${isSdk ? 'config' : 'h5'}/module_config/delete</code>，其确认文案是「是否确认删除该模组配置?」。
                    <b>请按旧模组会被永久删除、不可回滚来对待</b>。
                    下一步会先把旧配置下载到本地做备份。
                </div>` : `<div class="aat-tip">
                    当前模组不挂在任何链接上，走非破坏性路径：<b>新建一个独立模组，旧模组原样保留</b>。
                </div>`}
                ${renderDiff(diff, { open: true })}
                <div class="aat-tip">
                    新增项会保留条目、值留空。留空时 CMS 渲染会自动落到模板的预设值
                    <code>preset</code>（与新建模组的原生行为一致），所以它们仍需你逐项确认。
                </div>`;

            footerButton(ui.footer, '返回', '', renderStep1);
            footerButton(ui.footer, '备份旧配置 JSON', '', () => {
                downloadJSON(`module-config-backup-${oldModuleId}.json`, detail);
            });
            footerButton(ui.footer, destructive ? '下一步：确认并执行' : '执行',
                destructive ? 'aat-btn-danger' : 'aat-btn-primary',
                () => (destructive ? renderStep3(template) : execute(template)));
        }

        async function attachedRow() {
            const row = isSdk ? await findSdkConfigRow(linkId)
                : listOf(await api.h5LinkAll()).find((r) => String(r.id) === String(linkId));
            if (!row) {
                throw new Error(`找不到 id 为「${linkId}」的${isSdk ? 'SDK 配置' : 'H5 链接'}，无法继续。`);
            }
            if (String(row.module_config_id || '') !== String(oldModuleId)) {
                throw new Error('当前关联模组与页面不一致，已停止执行。请刷新 CMS 后重试。');
            }
            return row;
        }

        async function renderStep3(template) {
            ui.footer.innerHTML = '';
            ui.body.innerHTML = '<div class="aat-empty">正在核对模组关联…</div>';

            let linkRow;
            try {
                linkRow = await attachedRow();
            } catch (e) {
                ui.body.innerHTML = `<div class="aat-warn aat-err">${esc(e.message)}</div>`;
                footerButton(ui.footer, '返回', '', () => renderStep2(template));
                return;
            }

            const confirmation = isSdk ? linkId : String(linkRow.lid || '');
            if (!confirmation) {
                ui.body.innerHTML = '<div class="aat-warn aat-err">H5 链接缺少 lid，无法确认操作。</div>';
                footerButton(ui.footer, '返回', '', () => renderStep2(template));
                return;
            }
            downloadJSON(`module-config-backup-${oldModuleId}.json`, detail);
            window.open(`${CMS_API}/cms2/system/module_config/export?id=${encodeURIComponent(oldModuleId)}`, '_blank');

            ui.body.innerHTML = `
                <div class="aat-warn">
                    即将对${isSdk ? ' SDK 配置' : '链接'} <b>${esc(confirmation)}</b> 执行：<br>
                    1. 解绑并删除旧模组「${esc(displayName)}」<b>（不可恢复）</b><br>
                    2. 按模板「${esc(template.name)}」绑定新模组，名称保持「${esc(displayName)}」<br><br>
                    旧配置的 JSON 备份已开始下载，官方导出也已在新标签页打开。
                </div>
                <div class="aat-row">
                    <label class="aat-label">请手动输入${isSdk ? ' SDK 配置 ID' : '该链接的 lid'}「${esc(confirmation)}」以确认</label>
                    <input class="aat-input" id="aat-confirm" placeholder="输入 ${esc(confirmation)}" autocomplete="off">
                </div>`;

            const input = ui.body.querySelector('#aat-confirm');
            footerButton(ui.footer, '返回', '', () => renderStep2(template));
            const go = footerButton(ui.footer, '解绑并重建', 'aat-btn-danger', () => execute(template));
            go.disabled = true;
            input.addEventListener('input', () => { go.disabled = input.value.trim() !== confirmation; });
            input.focus();
        }

        async function execute(template) {
            if (applying || !featureEnabled()) {
                return;
            }
            applying = true;
            preserveResult = true;
            ui.footer.innerHTML = '';
            const log = [];
            let unbound = false;
            let created = false;
            const say = (msg) => {
                log.push(msg);
                ui.body.innerHTML = `<div class="aat-tip">${log.map(esc).join('<br>')}</div>`;
            };

            try {
                let newModuleId;
                if (destructive) {
                    say('正在再次核对模组关联…');
                    await attachedRow();
                }

                // 先确认旧值能完整暂存，再进行任何创建或解绑；空 moduleId 不会触发响应注入。
                const pending = {
                    moduleId: '',
                    oldModuleId: String(oldModuleId),
                    oldName: displayName,
                    newName: displayName,
                    templateName: template.name,
                    oldFieldList: oldFieldList,
                    ts: Date.now()
                };
                if (!writeSession(PENDING_KEY, pending)) {
                    throw new Error('无法暂存旧配置，已停止执行，尚未创建或解绑模组。请检查浏览器存储空间后重试。');
                }

                if (destructive) {
                    say('正在解绑旧模组…');
                    if (isSdk) {
                        await api.sdkModuleDelete(linkId);
                    } else {
                        await api.h5ModuleDelete(linkId);
                    }
                    unbound = true;
                    say('旧模组已解绑。');

                    say('正在按模板绑定新模组…');
                    const data = {
                        id: linkId,
                        name: displayName,
                        module_config_template_id: template.id
                    };
                    if (isSdk) {
                        data.copy_id = '';
                        await api.sdkModuleAdd(data);
                    } else {
                        await api.h5ModuleAdd(data);
                    }
                    created = true;
                    say('新模组已绑定，配置值尚未保存。');

                    say('正在查询新模组 id…');
                    const linkRow = isSdk ? await findSdkConfigRow(linkId)
                        : listOf(await api.h5LinkAll()).find((r) => String(r.id) === String(linkId));
                    newModuleId = linkRow && linkRow.module_config_id;
                } else {
                    say('正在读取旧模组的资源标识…');
                    const oldRow = (await listModuleRows(displayName))
                        .find((r) => String(r.id) === String(oldModuleId));

                    // add 不回传 id，只能事后按名字捞。先记下同名的已有 id，
                    // 新建后取「多出来的那个」，避免重名时认错行。
                    const beforeIds = new Set(
                        (await listModuleRows(displayName))
                            .filter((r) => String(r.name) === displayName)
                            .map((r) => String(r.id))
                    );

                    say('正在新建模组…');
                    await api.moduleAdd({
                        name: displayName,
                        module_config_template_id: template.id,
                        sys_key_entry_id: (oldRow && oldRow.sys_key_entry_id) || ''
                    });
                    created = true;
                    say('新模组已创建，配置值尚未保存。');

                    say('正在查询新模组 id…');
                    const fresh = (await listModuleRows(displayName))
                        .filter((r) => String(r.name) === displayName && !beforeIds.has(String(r.id)));
                    newModuleId = fresh.length === 1 ? fresh[0].id : null;
                    if (fresh.length > 1) {
                        throw new Error(`按名称「${displayName}」查到 ${fresh.length} 个同名新模组，无法确定是哪一个。请到模组配置列表手动打开正确的那个，并用下方按钮下载旧配置备份对照补值。`);
                    }
                }

                if (!newModuleId) {
                    throw new Error('新模组已创建，但没能查到它的 id。请手动打开它的配置页，并用下方按钮下载旧配置备份对照补值。');
                }
                if (String(newModuleId) === String(oldModuleId)) {
                    throw new Error('查询到的关联仍是旧模组，无法确认新模组 id，已停止跳转。请刷新配置列表核对，并下载旧配置备份对照补值。');
                }

                pending.moduleId = String(newModuleId);
                pending.ts = Date.now();
                if (!writeSession(PENDING_KEY, pending)) {
                    throw new Error('新模组已创建，但迁移数据暂存失败，已停止跳转。请下载旧配置备份，手动打开新模组对照补值。');
                }

                say('新模组已就绪，正在跳转并注入旧配置的值…');

                const params = new URLSearchParams();
                params.set('id', String(newModuleId));
                params.set('name', displayName);
                if (destructive) {
                    params.set('delid', linkId);
                    params.set('type', type);
                }
                location.hash = `#${ROUTE_PATH}?${params.toString()}`;
                setTimeout(() => location.reload(), 60);
            } catch (e) {
                console.error('[套用模板]', e);
                ui.body.innerHTML = `<div class="aat-tip">${log.map(esc).join('<br>')}</div>
                    <div class="aat-warn aat-err">${esc(e.message)}</div>
                    ${unbound && !created ? `<div class="aat-warn">旧模组已解绑，新模组绑定未确认成功。请到${isSdk ? ' SDK 配置总览' : ' H5 链接管理页'}核对关联；若尚无模组，请用「添加模组」按模板重建，再对照旧配置备份补值。</div>` : ''}
                    ${created ? '<div class="aat-warn">新模组已创建，但自动迁移尚未完成。请下载旧配置备份，对照补值后手动保存。</div>' : ''}`;
                footerButton(ui.footer, '重新下载备份', '', () => {
                    downloadJSON(`module-config-backup-${oldModuleId}.json`, detail);
                });
                footerButton(ui.footer, '关闭', '', closeModal);
            } finally {
                applying = false;
            }
        }
    }

    // ===================== 报告面板 =====================

    function renderPanel() {
        const record = readSession(REPORT_KEY);
        if (!record || String(record.moduleId) !== String(routeQuery().id)) {
            return;
        }
        if (document.getElementById(PANEL_ID)) {
            return;
        }

        injectStyle();
        const diff = record.report || { migrated: [], removed: [], added: [], typeChanged: [] };
        const stats = (record.report && record.report.stats) || { values: 0, rows: 0 };

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div class="aat-p-hd">
                <span>套用模板结果</span>
                <span><span class="aat-toggle" style="cursor:pointer">▼</span> <span class="aat-close" style="cursor:pointer">&times;</span></span>
            </div>
            <div class="aat-p-bd">
                <div class="aat-warn">
                    <b>结构已更新，迁移值尚未保存</b>。<br>
                    请核对后点击右上角「保存」。
                </div>
                <div class="aat-tip">
                    模板：<b>${esc(record.templateName || '')}</b><br>
                    已写入 <b>${stats.values}</b> 个值${stats.rows ? `，${stats.rows} 行 object_array` : ''}
                </div>
                ${renderList('➕ 新增，需要你独立额外配置', diff.added, { open: true, markMandatory: true })}
                ${renderList('🗑 已丢弃', diff.removed, { open: true })}
                ${renderList('⚠️ 类型变更，值未迁移', diff.typeChanged, {})}
                ${renderList('✅ 已迁移', diff.migrated, {})}
                <div class="aat-p-actions">
                    ${record.mergedFieldList ? '<button class="aat-btn" data-act="copy">复制合并后 JSON</button>' : ''}
                    ${record.oldFieldList ? '<button class="aat-btn" data-act="backup">下载旧配置备份</button>' : ''}
                </div>
            </div>`;

        const body = panel.querySelector('.aat-p-bd');
        const toggle = panel.querySelector('.aat-toggle');
        panel.querySelector('.aat-p-hd').addEventListener('click', (e) => {
            if (e.target.classList.contains('aat-close')) {
                return;
            }
            const hidden = body.style.display === 'none';
            body.style.display = hidden ? '' : 'none';
            toggle.textContent = hidden ? '▼' : '▲';
        });
        panel.querySelector('.aat-close').addEventListener('click', () => {
            sessionStorage.removeItem(REPORT_KEY);
            panel.remove();
        });
        const copyBtn = panel.querySelector('[data-act="copy"]');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                navigator.clipboard.writeText(JSON.stringify(record.mergedFieldList, null, 2))
                    .then(() => { e.target.textContent = '已复制'; })
                    .catch(() => { e.target.textContent = '复制失败'; });
            });
        }
        const backupBtn = panel.querySelector('[data-act="backup"]');
        if (backupBtn) {
            backupBtn.addEventListener('click', () => {
                downloadJSON(`module-config-backup-${record.oldModuleId}.json`, {
                    id: record.oldModuleId,
                    name: record.oldName,
                    field_list: record.oldFieldList
                });
            });
        }

        document.body.appendChild(panel);
    }

    // ===================== 按钮注入 =====================

    let button = null;

    function ensureButton() {
        if (!featureEnabled() || !isModuleEditPage()) {
            if (button && button.parentElement) {
                button.remove();
            }
            return;
        }

        const toolbar = document.querySelector('[class*="appic-scope-manage-body_top_right"]');
        if (!toolbar) {
            return;
        }

        if (!button) {
            button = document.createElement('button');
            button.id = BTN_ID;
            button.type = 'button';
            button.className = 'el-button el-button--default is-plain is-round';
            button.innerHTML = '<span>套用模板</span>';
            button.style.marginLeft = '10px';
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                startFlow().catch((err) => {
                    console.error('[套用模板]', err);
                    alert('[套用模板] ' + err.message);
                });
            });
        }

        // Vue 重渲染会把外来节点摘掉，父节点变了就重新挂
        if (button.parentElement !== toolbar) {
            toolbar.appendChild(button);
        }
        button.disabled = applying;
    }

    // ===================== 启动 =====================

    function tick() {
        ensureButton();
        if (!featureEnabled() && !applying && !preserveResult) {
            closeModal();
        }
        if (isModuleEditPage() && (featureEnabled() || readSession(REPORT_KEY))) {
            renderPanel();
        }
    }

    function init(runtime) {
        if (location.hostname !== 'cms.apicmob.com') {
            return;
        }

        if (runtime && runtime.watch) {
            runtime.watch(tick);
            tick();
            return;
        }

        // 该 SPA 不总触发 hashchange，patch history + 轮询双保险
        ['pushState', 'replaceState'].forEach((fn) => {
            const raw = history[fn];
            history[fn] = function () {
                const ret = raw.apply(this, arguments);
                setTimeout(tick, 0);
                return ret;
            };
        });
        window.addEventListener('hashchange', tick);
        window.addEventListener('popstate', tick);
        setInterval(tick, 500);
        tick();
    }

    function boot(runtime) {
        featureEnabled = runtime && runtime.isEnabled ? runtime.isEnabled : () => true;
        installXhrHooks();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => init(runtime), { once: true });
        } else {
            init(runtime);
        }
    }

    return { boot, migrateValues, diffSkeleton };
});
