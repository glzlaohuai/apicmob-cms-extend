(function (factory) {
    'use strict';

    const core = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = core;
    }
})(function createPlacementBulkUpload() {
    'use strict';

    const HEADERS = ['名称', '广告类型', '结算模式', '固定价格', '最低价格', '最高价格', '尺寸'];
    const TYPE_CONFIG = Object.freeze({
        banner: Object.freeze({ width: 320, height: 50 }),
        interstitial: Object.freeze({ width: 9, height: 16 }),
        incentivized: Object.freeze({ width: 9, height: 16 }),
        native: Object.freeze({ width: 9, height: 16 }),
        splash: Object.freeze({ width: 9, height: 16 })
    });
    const TYPE_CONFIG_KEY = 'apicmob-placement-bulk-upload-type-sizes';
    const UNIT = Object.freeze({ cpm: 2, bidding: 4 });
    const STATUS_LABELS = Object.freeze({
        invalid: '校验失败',
        ready: '待创建',
        skipped: '已存在，跳过',
        conflict: '同名冲突',
        running: '处理中',
        success: '创建、启用并同步成功',
        partial: '部分完成',
        failed: '创建失败'
    });

    function cleanText(value) {
        return String(value == null ? '' : value).trim();
    }

    function isBlank(value) {
        return cleanText(value) === '';
    }

    function parseSize(value) {
        const match = /^(\d+)\s*[x×*]\s*(\d+)$/i.exec(cleanText(value));
        if (!match) {
            return null;
        }
        const width = Number(match[1]);
        const height = Number(match[2]);
        return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
            ? { width, height }
            : null;
    }

    function normalizeTypeConfig(value) {
        const config = {};
        Object.keys(TYPE_CONFIG).forEach((type) => {
            const size = value && value[type];
            config[type] = (size && parseSize(`${size.width}x${size.height}`)) || { ...TYPE_CONFIG[type] };
        });
        return config;
    }

    function readTypeConfig(win) {
        try {
            return normalizeTypeConfig(JSON.parse(win.localStorage.getItem(TYPE_CONFIG_KEY)));
        } catch (error) {
            return normalizeTypeConfig(null);
        }
    }

    function saveTypeConfig(win, value) {
        const config = {};
        Object.keys(TYPE_CONFIG).forEach((type) => {
            const size = value && value[type];
            const parsed = size && parseSize(`${size.width}x${size.height}`);
            if (!parsed) {
                throw new Error(`${type} 的宽和高必须是正整数`);
            }
            config[type] = parsed;
        });
        win.localStorage.setItem(TYPE_CONFIG_KEY, JSON.stringify(config));
        return config;
    }

    function normalizeType(value) {
        const type = cleanText(value).toLowerCase();
        return Object.prototype.hasOwnProperty.call(TYPE_CONFIG, type) ? type : '';
    }

    function normalizeMode(value) {
        const mode = cleanText(value).toLowerCase();
        return Object.prototype.hasOwnProperty.call(UNIT, mode) ? mode : '';
    }

    function parseNonNegativeNumber(value) {
        if (isBlank(value)) {
            return null;
        }
        const number = typeof value === 'number' ? value : Number(cleanText(value));
        return Number.isFinite(number) && number >= 0 ? number : NaN;
    }

    function formatNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return '';
        }
        return String(Object.is(number, -0) ? 0 : number);
    }

    function buildPlacementName(prefix, appName, rowName, mode, fixedPrice, type, includeType, includePrefix) {
        const base = cleanText(prefix) || cleanText(appName);
        const middle = cleanText(rowName);
        const suffix = mode === 'cpm' ? formatNumber(fixedPrice) : 'bidding';
        const parts = includePrefix === false ? [middle] : [base, middle];
        if (includeType && normalizeType(type)) {
            parts.push(normalizeType(type));
        }
        parts.push(suffix);
        return parts.join('-');
    }

    function validateHeaders(headerRow) {
        const actual = (headerRow || []).map(cleanText);
        while (actual.length && !actual[actual.length - 1]) {
            actual.pop();
        }
        const expected = actual.length === HEADERS.length - 1 ? HEADERS.slice(0, -1) : HEADERS;
        if (actual.length !== expected.length
            || actual.some((value, index) => value !== expected[index])) {
            throw new Error(`Excel 第一行必须严格为：${HEADERS.join('、')}（兼容不含尺寸列的旧模板）`);
        }
    }

    function normalizeRows(matrix, options) {
        const opts = options || {};
        if (!Array.isArray(matrix) || !matrix.length) {
            throw new Error('Excel 中没有可读取的数据。');
        }
        validateHeaders(matrix[0]);
        const typeConfig = normalizeTypeConfig(opts.typeConfig);
        const hasSizeColumn = cleanText(matrix[0][HEADERS.length - 1]) === '尺寸';

        const rows = [];
        matrix.slice(1).forEach((cells, index) => {
            const values = HEADERS.map((_, cellIndex) => (cells || [])[cellIndex]);
            if (values.every(isBlank)) {
                return;
            }

            const row = {
                rowNumber: index + 2,
                sourceName: cleanText(values[0]),
                type: normalizeType(values[1]),
                mode: normalizeMode(values[2]),
                fixedPrice: parseNonNegativeNumber(values[3]),
                minPrice: parseNonNegativeNumber(values[4]),
                maxPrice: parseNonNegativeNumber(values[5]),
                errors: [],
                status: 'ready',
                reason: '',
                phase: ''
            };

            if (!row.sourceName) {
                row.errors.push('名称不能为空');
            }
            if (!row.type) {
                const rawType = cleanText(values[1]);
                row.errors.push(rawType.toLowerCase() === 'reward'
                    ? 'reward 已停用，请使用 incentivized'
                    : `不支持的广告类型：${rawType || '(空)'}`);
            }
            if (!row.mode) {
                row.errors.push(`不支持的结算模式：${cleanText(values[2]) || '(空)'}`);
            }

            if (row.mode === 'cpm') {
                if (row.fixedPrice === null || Number.isNaN(row.fixedPrice)) {
                    row.errors.push('CPM 的固定价格必须是大于等于 0 的数字');
                }
                if (row.minPrice !== null || row.maxPrice !== null) {
                    row.errors.push('CPM 的最低价格和最高价格必须留空');
                }
            } else if (row.mode === 'bidding') {
                if (row.fixedPrice !== null) {
                    row.errors.push('Bidding 的固定价格必须留空');
                }
                if (row.minPrice === null || Number.isNaN(row.minPrice)
                    || row.maxPrice === null || Number.isNaN(row.maxPrice)) {
                    row.errors.push('Bidding 的最低价格和最高价格必须是大于等于 0 的数字');
                } else if (row.maxPrice < row.minPrice) {
                    row.errors.push('Bidding 的最高价格不能小于最低价格');
                }
            }

            const rawSize = hasSizeColumn ? values[6] : '';
            const size = isBlank(rawSize) ? typeConfig[row.type] : parseSize(rawSize);
            if (!isBlank(rawSize) && !size) {
                row.errors.push('尺寸格式必须为 宽x高（例如 320x50），宽高必须是正整数');
            }
            if (size) {
                row.width = size.width;
                row.height = size.height;
            }
            row.unit = UNIT[row.mode] || null;
            if (row.mode) {
                row.name = buildPlacementName(
                    opts.prefix,
                    opts.appName,
                    row.sourceName,
                    row.mode,
                    row.fixedPrice,
                    row.type,
                    opts.includeType,
                    opts.includePrefix
                );
            } else {
                row.name = '';
            }

            if (row.errors.length) {
                row.status = 'invalid';
                row.reason = row.errors.join('；');
            }
            rows.push(row);
        });

        if (!rows.length) {
            throw new Error('Excel 中没有数据行。');
        }

        const byName = new Map();
        rows.filter((row) => row.name).forEach((row) => {
            const matches = byName.get(row.name) || [];
            matches.push(row);
            byName.set(row.name, matches);
        });
        byName.forEach((matches, name) => {
            if (matches.length < 2) {
                return;
            }
            matches.forEach((row) => {
                row.status = 'invalid';
                row.reason = `Excel 内生成了重复广告位名称：${name}`;
            });
        });

        return rows;
    }

    function candidateTypeValues(typeRow) {
        return [
            typeRow && typeRow.name,
            typeRow && typeRow.type,
            typeRow && typeRow.value,
            typeRow && typeRow.placement_type_type
        ].map((value) => cleanText(value).toLowerCase()).filter(Boolean);
    }

    function resolveTypeIds(rows, typeList) {
        const byType = new Map();
        Object.keys(TYPE_CONFIG).forEach((type) => {
            byType.set(type, (typeList || []).filter((item) => candidateTypeValues(item).includes(type)));
        });

        rows.forEach((row) => {
            if (row.status === 'invalid' || !row.type) {
                return;
            }
            const matches = byType.get(row.type) || [];
            if (matches.length !== 1 || matches[0].id == null || matches[0].id === '') {
                row.status = 'invalid';
                row.reason = matches.length > 1
                    ? `CMS 中存在多个 ${row.type} 类型，无法唯一匹配`
                    : `CMS 中找不到 ${row.type} 类型`;
                return;
            }
            row.placementTypeId = matches[0].id;
        });
        return rows;
    }

    function buildPlacementPayload(row, context) {
        return {
            publisher_id: context.publisherId,
            placement_id: '',
            publisher_app_id: context.appId,
            placement_type_id: row.placementTypeId,
            placement_type_type: '',
            name: row.name,
            unit: null,
            actions: '1,3,5',
            private: 0,
            settlement: [],
            width: row.width,
            height: row.height
        };
    }

    function buildSettlementPayload(row, placementId) {
        return {
            publisher_placement_id: placementId,
            unit: row.unit,
            settle: row.mode === 'cpm' ? row.fixedPrice : 0,
            settle_min: row.mode === 'cpm' ? 0 : row.minPrice,
            settle_max: row.mode === 'cpm' ? 0 : row.maxPrice,
            country: 'ALL',
            valid_from: '',
            valid_to: ''
        };
    }

    function normalizeActions(actions) {
        const list = Array.isArray(actions) ? actions : cleanText(actions).split(',');
        return list.map((value) => Number(value)).filter(Number.isFinite).sort((a, b) => a - b).join(',');
    }

    function numbersEqual(left, right) {
        return Number(left) === Number(right);
    }

    function existingType(existing) {
        const values = [
            existing && existing.placement_type_type,
            existing && existing.placement_type_name,
            existing && existing.type
        ];
        for (let index = 0; index < values.length; index += 1) {
            const type = normalizeType(values[index]);
            if (type) {
                return type;
            }
        }
        return '';
    }

    function isBaseSettlement(settlement) {
        return isBlank(settlement && settlement.valid_from) && isBlank(settlement && settlement.valid_to);
    }

    function matchesExisting(row, existing, context) {
        if (!existing || existing.name !== row.name) {
            return false;
        }
        if (existing.publisher_app_id != null
            && String(existing.publisher_app_id) !== String(context.appId)) {
            return false;
        }
        if (existing.placement_type_id != null
            && String(existing.placement_type_id) !== String(row.placementTypeId)) {
            return false;
        }
        if (existing.placement_type_id == null && existingType(existing) !== row.type) {
            return false;
        }
        if (!numbersEqual(existing.width, row.width) || !numbersEqual(existing.height, row.height)) {
            return false;
        }
        if (!numbersEqual(existing.unit, row.unit)) {
            return false;
        }
        if (Number(existing.private) !== 0 || normalizeActions(existing.actions) !== '1,3,5') {
            return false;
        }

        const settlements = Array.isArray(existing.settlement) ? existing.settlement : [];
        if (settlements.length !== 1 || !isBaseSettlement(settlements[0])) {
            return false;
        }
        const desired = buildSettlementPayload(row, existing.id);
        const actual = settlements[0];
        return cleanText(actual.country).toUpperCase() === 'ALL'
            && numbersEqual(actual.unit, desired.unit)
            && numbersEqual(actual.settle, desired.settle)
            && numbersEqual(actual.settle_min, desired.settle_min)
            && numbersEqual(actual.settle_max, desired.settle_max);
    }

    function classifyRows(rows, existingList, context) {
        const byName = new Map();
        (existingList || []).forEach((item) => {
            if (item.publisher_app_id != null && context.appId != null
                && String(item.publisher_app_id) !== String(context.appId)) {
                return;
            }
            const name = cleanText(item.name);
            const matches = byName.get(name) || [];
            matches.push(item);
            byName.set(name, matches);
        });

        rows.forEach((row) => {
            if (row.status === 'invalid') {
                return;
            }
            const matches = byName.get(cleanText(row.name)) || [];
            if (!matches.length) {
                row.status = 'ready';
                row.reason = '';
                row.placementId = '';
                return;
            }
            row.status = 'skipped';
            row.placementId = matches.length === 1 ? matches[0].id || '' : '';
            if (matches.length === 1 && matchesExisting(row, matches[0], context)) {
                row.reason = '同名广告位及结算配置已存在，保留当前启用状态';
            } else {
                row.reason = matches.length > 1
                    ? `CMS 中已存在 ${matches.length} 个同名广告位，跳过创建，请核对已有记录`
                    : '同名广告位已存在，跳过创建；配置可能尚未完成，请核对已有记录';
            }
            const ids = matches.map((item) => item.id).filter((id) => id != null && id !== '');
            if (ids.length) {
                row.reason += `；广告位 ID：${ids.join('、')}`;
            }
        });
        return rows;
    }

    function extractCreatedId(body) {
        const candidates = [
            body && body.result && body.result.id,
            body && body.data && body.data.id,
            body && body.id,
            body && (typeof body.result === 'string' || typeof body.result === 'number')
                ? body.result
                : undefined
        ];
        return candidates.find((value) => value !== undefined && value !== null && value !== '') || '';
    }

    function markExecutionError(error, stage, placementId) {
        const err = error instanceof Error ? error : new Error(String(error));
        err.bulkStage = stage;
        err.placementId = placementId || '';
        return err;
    }

    async function executePlacementRow(row, context) {
        let placementId = '';
        let stage = 'check';
        try {
            context.onPhase && context.onPhase('正在检查同名广告位');
            const existing = await context.findExistingPlacements(row.name);
            if (!Array.isArray(existing)) {
                throw new Error('同名广告位查询返回的数据格式异常');
            }
            const checkedRow = { ...row };
            classifyRows([checkedRow], existing, context);
            if (checkedRow.status === 'skipped') {
                return { skipped: true, placementId: checkedRow.placementId, reason: checkedRow.reason };
            }

            stage = 'add';
            context.onPhase && context.onPhase('正在创建广告位');
            const addBody = await context.api.addPlacement(buildPlacementPayload(row, context));
            placementId = extractCreatedId(addBody);

            if (!placementId) {
                stage = 'resolve';
                context.onPhase && context.onPhase('正在查询新广告位 ID');
                placementId = await context.resolveCreatedId(row, context.knownIds);
            }
            if (!placementId) {
                throw new Error('广告位已创建，但无法确定新广告位 ID');
            }
            context.knownIds && context.knownIds.add(String(placementId));

            stage = 'mode';
            context.onPhase && context.onPhase('正在设置结算模式');
            await context.api.setSettlementMode({ id: placementId, unit: row.unit });

            stage = 'settlement';
            context.onPhase && context.onPhase('正在创建结算规则');
            await context.api.addSettlement(buildSettlementPayload(row, placementId));

            stage = 'activation';
            context.onPhase && context.onPhase('正在启用广告位');
            await context.api.activatePlacement({ id: placementId, status: 'active' });

            stage = 'sync';
            context.onPhase && context.onPhase('正在同步广告位');
            await context.api.syncPlacement({ id: placementId });

            return { placementId };
        } catch (error) {
            throw markExecutionError(error, stage, placementId);
        }
    }

    function listOf(body) {
        if (body && body.result && Array.isArray(body.result.list)) {
            return body.result.list;
        }
        if (body && Array.isArray(body.result)) {
            return body.result;
        }
        if (body && body.data && Array.isArray(body.data.list)) {
            return body.data.list;
        }
        return body && Array.isArray(body.data) ? body.data : [];
    }

    function boot(win, runtime) {
        const API_HOST = 'https://cms-ssp-api.apicmob.com/api';
        const FALLBACK_VERSION = '8.2.34';
        const ROUTE_PATH = '/ssp/media-details';
        const BTN_ID = 'apicmob-placement-bulk-upload-btn';
        const MODAL_ID = 'apicmob-placement-bulk-upload-modal';
        const STYLE_ID = 'apicmob-placement-bulk-upload-style';
        const INCLUDE_PREFIX_KEY = 'apicmob-placement-bulk-upload-include-prefix';
        const INCLUDE_TYPE_KEY = 'apicmob-placement-bulk-upload-include-type';
        let sniffedVersion = '';
        let button = null;
        let running = false;
        let preserveResult = false;
        const featureEnabled = runtime && runtime.isEnabled ? runtime.isEnabled : () => true;

        const esc = (value) => cleanText(value).replace(/[&<>"']/g, (char) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
        ));

        function readCookie(name) {
            const hit = win.document.cookie.split('; ').find((item) => item.startsWith(name + '='));
            return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
        }

        function getVersion() {
            return sniffedVersion || readCookie('appic_cms_main_version') || FALLBACK_VERSION;
        }

        function installXhrTokenHook() {
            const XHR = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
            if (!XHR || XHR.__apicmobBulkUploadHooked) {
                return;
            }
            const rawSetRequestHeader = XHR.setRequestHeader;
            XHR.setRequestHeader = function (key, value) {
                if (String(key).toLowerCase() === 'x-token' && value) {
                    sniffedVersion = String(value);
                }
                return rawSetRequestHeader.apply(this, arguments);
            };
            Object.defineProperty(XHR, '__apicmobBulkUploadHooked', { value: true });
        }

        installXhrTokenHook();

        function routePath() {
            const hash = win.location.hash.replace(/^#/, '');
            const queryIndex = hash.indexOf('?');
            return queryIndex < 0 ? hash : hash.slice(0, queryIndex);
        }

        function routeQuery() {
            const hash = win.location.hash;
            const queryIndex = hash.indexOf('?');
            const output = {};
            if (queryIndex < 0) {
                return output;
            }
            new URLSearchParams(hash.slice(queryIndex + 1)).forEach((value, key) => {
                output[key] = value;
            });
            return output;
        }

        function isTargetPage() {
            const query = routeQuery();
            return routePath() === ROUTE_PATH && String(query.interface || '').toLowerCase() === 'sdk';
        }

        async function request(path, options) {
            const opts = options || {};
            const url = new URL(API_HOST + path);
            Object.keys(opts.params || {}).forEach((key) => {
                const value = opts.params[key];
                if (value !== undefined && value !== null) {
                    url.searchParams.set(key, value);
                }
            });

            const headers = {
                accept: 'application/json, text/plain, */*',
                'x-token': getVersion()
            };
            if (opts.data !== undefined) {
                headers['content-type'] = 'application/json;charset=UTF-8';
            }
            const response = await win.fetch(url.toString(), {
                method: opts.data === undefined ? 'GET' : 'POST',
                credentials: 'include',
                headers: headers,
                body: opts.data === undefined ? undefined : JSON.stringify(opts.data)
            });
            if (response.ok === false) {
                throw new Error(`${path} 请求失败（HTTP ${response.status}）`);
            }

            let body;
            try {
                body = await response.json();
            } catch (error) {
                throw new Error(`${path} 返回的不是合法 JSON（HTTP ${response.status}）`);
            }
            const code = body && body.code;
            if (code === 401) {
                throw new Error('登录态或 CMS 版本号失效（code 401），请重新登录 CMS 后重试。');
            }
            if (code !== 200 && code !== 0) {
                throw new Error(`${path} 失败：${(body && (body.msg || body.message)) || `code=${code}`}`);
            }
            return body;
        }

        const api = {
            appAll: (publisherId) => request('/cms2/ssp/publisher/app/all', {
                params: { publisher_id: publisherId }
            }),
            typeAll: (publisherId) => request('/cms2/ssp/publisher/placement/type/all', {
                params: { publisher_id: publisherId }
            }),
            placementIndex: (params) => request('/cms2/ssp/publisher/placement/index', { params }),
            addPlacement: (data) => request('/cms2/ssp/publisher/placement/add', { data }),
            setSettlementMode: (data) => request('/cms2/ssp/publisher/placement/setSettlementMode', { data }),
            addSettlement: (data) => request('/cms2/ssp/publisher/placement/settlement/add', { data }),
            activatePlacement: (data) => request('/cms2/ssp/publisher/placement/status/update', { data }),
            syncPlacement: (data) => request('/cms2/ssp/publisher/placement/sync', { data })
        };

        function isVisible(element) {
            return !!(element && element.getClientRects().length);
        }

        function exactText(element, text) {
            return cleanText(element && element.textContent) === text;
        }

        function isPlacementPanel(element) {
            const content = cleanText(element && element.textContent).toLowerCase();
            const chinese = content.includes('广告位名称')
                && (content.includes('结算模式') || content.includes('广告类型'));
            const english = content.includes('placement name')
                && (content.includes('settlement mode') || content.includes('placement type'));
            return !!element && isVisible(element) && (chinese || english);
        }

        function findPlacementTable() {
            const panelSelectors = ['.appic-sp-show-row', '.appic-table', '.vxe-grid', '.el-card'];
            const panels = [];
            const seen = new Set();
            panelSelectors.forEach((selector) => {
                Array.from(win.document.querySelectorAll(selector)).forEach((panel) => {
                    if (!seen.has(panel) && isPlacementPanel(panel)) {
                        seen.add(panel);
                        panels.push(panel);
                    }
                });
            });

            for (let index = 0; index < panels.length; index += 1) {
                const table = panels[index];
                const buttons = Array.from(table.querySelectorAll('button')).filter(isVisible);
                const addButton = buttons.find((item) => (
                    ['添加', '新增', '新建', 'add', 'create'].includes(cleanText(item.textContent).toLowerCase())
                ));
                const queryButton = buttons.find((item) => (
                    ['查询', '搜索', 'query', 'search'].includes(cleanText(item.textContent).toLowerCase())
                ));
                const toolbar = table.querySelector('.appic-table-toolbar, .vxe-toolbar');
                const actionHost = (addButton && addButton.parentElement)
                    || (queryButton && queryButton.parentElement)
                    || toolbar
                    || table;
                return { table, addButton: addButton || null, actionHost };
            }

            return null;
        }

        function findVueSelection(root) {
            const nodes = [root].concat(Array.from(root ? root.querySelectorAll('*') : []));
            const seen = new Set();
            for (let index = 0; index < nodes.length; index += 1) {
                let vm = nodes[index].__vue__;
                while (vm && !seen.has(vm)) {
                    seen.add(vm);
                    const name = vm.$options && vm.$options.name;
                    if (name === 'AppicSelect'
                        || (Array.isArray(vm.selectOptions) && vm.selectVal === 'id')) {
                        return {
                            id: vm.value,
                            options: vm.selectOptions || []
                        };
                    }
                    vm = vm.$parent;
                }
            }
            return null;
        }

        function readSelectedApp(table) {
            const toolbar = table.querySelector('.appic-table-toolbar, .vxe-toolbar') || table;
            const label = Array.from(toolbar.querySelectorAll('span'))
                .find((item) => exactText(item, '应用'));
            const selectRoot = label && label.nextElementSibling;
            const vueSelection = findVueSelection(selectRoot);
            const input = selectRoot && selectRoot.querySelector('input');
            return {
                id: vueSelection && vueSelection.id,
                name: cleanText(input && input.value),
                options: (vueSelection && vueSelection.options) || []
            };
        }

        function resolveSelectedApp(selection, appList) {
            if (selection && selection.id !== undefined && selection.id !== null && selection.id !== '') {
                return (appList || []).find((app) => String(app.id) === String(selection.id)) || null;
            }
            const name = cleanText(selection && selection.name);
            if (!name) {
                return null;
            }
            const matches = (appList || []).filter((app) => cleanText(app.name) === name);
            return matches.length === 1 ? matches[0] : null;
        }

        async function listPlacements(publisherId, appId, keyword) {
            const output = [];
            for (let page = 1; page <= 100; page += 1) {
                const body = await api.placementIndex({
                    publisher_id: publisherId,
                    publisher_app_id: appId,
                    page: page,
                    size: 100,
                    keyword: keyword || ''
                });
                const list = [body.result && body.result.list, body.result, body.data && body.data.list, body.data]
                    .find(Array.isArray);
                if (!list || list.some((item) => !item || typeof item.name !== 'string')) {
                    throw new Error('广告位列表数据格式异常，无法检查同名广告位');
                }
                output.push(...list);
                const rawCount = [body.count, body.result && body.result.count, body.data && body.data.count]
                    .find((value) => value != null && value !== '' && Number.isFinite(Number(value)));
                const count = rawCount === undefined ? NaN : Number(rawCount);
                if (!list.length) {
                    if (Number.isFinite(count) && output.length < count) {
                        throw new Error('广告位列表未读取完整，无法检查同名广告位');
                    }
                    return output;
                }
                if (Number.isFinite(count) ? output.length >= count : list.length < 100) {
                    return output;
                }
            }
            throw new Error('广告位列表超过读取上限，无法检查同名广告位');
        }

        function injectStyle() {
            if (win.document.getElementById(STYLE_ID)) {
                return;
            }
            const style = win.document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = `
                .apu-mask {
                    position: fixed; inset: 0; z-index: 2147483646;
                    display: flex; align-items: center; justify-content: center;
                    background: rgba(0, 0, 0, .45);
                }
                .apu-modal {
                    width: min(1120px, calc(100vw - 40px)); max-height: calc(100vh - 50px);
                    display: flex; flex-direction: column; overflow: hidden;
                    background: #fff; color: #303133; border-radius: 6px;
                    box-shadow: 0 10px 36px rgba(0, 0, 0, .25);
                    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                }
                .apu-modal * { box-sizing: border-box; }
                .apu-head, .apu-foot {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 14px 20px; border-bottom: 1px solid #ebeef5;
                }
                .apu-head { font-size: 15px; font-weight: 600; }
                .apu-foot { justify-content: flex-end; gap: 10px; border-top: 1px solid #ebeef5; border-bottom: 0; }
                .apu-body { padding: 18px 20px; overflow: auto; }
                .apu-close { border: 0; background: transparent; color: #909399; cursor: pointer; font-size: 22px; }
                .apu-close:hover { color: #1677ff; }
                .apu-grid { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(280px, 1.4fr); gap: 14px; }
                .apu-field label { display: block; margin-bottom: 6px; color: #606266; font-weight: 600; }
                .apu-input {
                    width: 100%; height: 36px; padding: 0 10px; border: 1px solid #dcdfe6;
                    border-radius: 4px; color: #303133; background: #fff;
                }
                .apu-input:focus { outline: 0; border-color: #1677ff; }
                .apu-naming-options { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 10px; }
                .apu-field .apu-checkbox { display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; }
                .apu-checkbox input { margin: 0; flex: none; accent-color: #1677ff; }
                .apu-size-settings { margin-top: 16px; padding: 12px 0; border-top: 1px solid #ebeef5; border-bottom: 1px solid #ebeef5; }
                .apu-size-settings summary { color: #606266; font-weight: 600; cursor: pointer; }
                .apu-size-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px 16px; margin: 14px 0; }
                .apu-size-pair { display: grid; grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1fr); align-items: center; gap: 6px; }
                .apu-size-pair .apu-input { min-width: 0; }
                .apu-size-pair > span { text-align: center; color: #909399; }
                .apu-size-status { color: #606266; overflow-wrap: anywhere; }
                .apu-size-status[data-error="true"] { color: #f56c6c; }
                .apu-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
                .apu-file-name { color: #606266; overflow-wrap: anywhere; }
                .apu-tip, .apu-error, .apu-summary {
                    margin-top: 14px; padding: 10px 12px; border: 1px solid #d9ecff;
                    border-radius: 4px; background: #ecf5ff; color: #409eff;
                }
                .apu-error { border-color: #fbc4c4; background: #fef0f0; color: #f56c6c; white-space: pre-wrap; }
                .apu-summary { border-color: #e4e7ed; background: #f5f7fa; color: #606266; }
                .apu-table-wrap { margin-top: 14px; overflow: auto; border: 1px solid #ebeef5; border-radius: 4px; }
                .apu-table { width: 100%; min-width: 960px; border-collapse: collapse; table-layout: fixed; }
                .apu-table th, .apu-table td { padding: 8px 10px; border-bottom: 1px solid #ebeef5; text-align: left; vertical-align: top; }
                .apu-table th { position: sticky; top: 0; z-index: 1; background: #f5f7fa; color: #606266; }
                .apu-table tr:last-child td { border-bottom: 0; }
                .apu-table .apu-col-row { width: 58px; }
                .apu-table .apu-col-name { width: 260px; overflow-wrap: anywhere; }
                .apu-table .apu-col-type { width: 120px; }
                .apu-table .apu-col-mode { width: 190px; }
                .apu-table .apu-col-size { width: 125px; overflow-wrap: anywhere; }
                .apu-status { font-weight: 600; }
                .apu-status-ready, .apu-status-running { color: #409eff; }
                .apu-status-success { color: #25a46f; }
                .apu-status-skipped { color: #909399; }
                .apu-status-invalid, .apu-status-conflict, .apu-status-failed, .apu-status-partial { color: #f56c6c; }
                .apu-reason { margin-top: 2px; color: #909399; font-size: 12px; overflow-wrap: anywhere; }
                @media (max-width: 760px) {
                    .apu-grid { grid-template-columns: 1fr; }
                }
            `;
            (win.document.head || win.document.documentElement).appendChild(style);
        }

        function closeModal(force) {
            if (running && !force) {
                return;
            }
            const modal = win.document.getElementById(MODAL_ID);
            if (modal) {
                modal.remove();
            }
            preserveResult = false;
        }

        function createModal(title) {
            closeModal(true);
            injectStyle();
            const mask = win.document.createElement('div');
            mask.id = MODAL_ID;
            mask.className = 'apu-mask';
            mask.innerHTML = `
                <div class="apu-modal">
                    <div class="apu-head"><span>${esc(title)}</span><button class="apu-close" type="button">&times;</button></div>
                    <div class="apu-body"></div>
                    <div class="apu-foot"></div>
                </div>`;
            mask.querySelector('.apu-close').addEventListener('click', () => closeModal(false));
            mask.addEventListener('click', (event) => {
                if (event.target === mask) {
                    closeModal(false);
                }
            });
            win.document.body.appendChild(mask);
            return {
                mask,
                body: mask.querySelector('.apu-body'),
                footer: mask.querySelector('.apu-foot'),
                close: mask.querySelector('.apu-close')
            };
        }

        function elementButton(label, className, onClick) {
            const buttonElement = win.document.createElement('button');
            buttonElement.type = 'button';
            buttonElement.className = `el-button ${className || 'el-button--default'} is-round`;
            buttonElement.innerHTML = `<span>${esc(label)}</span>`;
            buttonElement.addEventListener('click', onClick);
            return buttonElement;
        }

        function downloadTemplate() {
            if (!win.XLSX) {
                throw new Error('当前页面没有加载 XLSX，请刷新 CMS 后重试。');
            }
            const rows = [
                HEADERS,
                ['HomeBanner', 'banner', 'cpm', 2.5, '', '', ''],
                ['Interstitial', 'interstitial', 'bidding', '', 1, 8, ''],
                ['RewardVideo', 'incentivized', 'bidding', '', 2, 10, ''],
                ['NativeFeed', 'native', 'cpm', 1.5, '', '', ''],
                ['OpenScreen', 'splash', 'bidding', '', 1, 8, '']
            ];
            const sheet = win.XLSX.utils.aoa_to_sheet(rows);
            sheet['!cols'] = [
                { wch: 22 }, { wch: 18 }, { wch: 16 },
                { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 18 }
            ];
            sheet.G1.c = [{ a: 'CMS 扩展', t: '可选。填写宽x高，例如 320x50 或 1080×1920；留空时使用当前广告类型的默认尺寸。宽高必须是正整数。' }];
            const book = win.XLSX.utils.book_new();
            win.XLSX.utils.book_append_sheet(book, sheet, '广告位');
            win.XLSX.writeFile(book, 'SDK广告位批量上传模板.xlsx');
        }

        function readWorkbook(file) {
            return new Promise((resolve, reject) => {
                if (!win.XLSX) {
                    reject(new Error('当前页面没有加载 XLSX，请刷新 CMS 后重试。'));
                    return;
                }
                const reader = new win.FileReader();
                reader.onerror = () => reject(new Error('读取 Excel 文件失败。'));
                reader.onload = () => {
                    try {
                        const book = win.XLSX.read(reader.result, { type: 'array' });
                        const firstName = book.SheetNames && book.SheetNames[0];
                        if (!firstName) {
                            throw new Error('Excel 中没有工作表。');
                        }
                        const matrix = win.XLSX.utils.sheet_to_json(book.Sheets[firstName], {
                            header: 1,
                            defval: '',
                            raw: true,
                            blankrows: false
                        });
                        resolve(matrix);
                    } catch (error) {
                        reject(error);
                    }
                };
                reader.readAsArrayBuffer(file);
            });
        }

        function priceText(row) {
            return row.mode === 'cpm'
                ? `CPM：${formatNumber(row.fixedPrice)}`
                : `Bidding：${formatNumber(row.minPrice)} ~ ${formatNumber(row.maxPrice)}`;
        }

        function renderRows(container, rows) {
            if (!rows || !rows.length) {
                container.innerHTML = '';
                return;
            }
            const counts = {};
            rows.forEach((row) => { counts[row.status] = (counts[row.status] || 0) + 1; });
            const summary = Object.keys(counts)
                .map((status) => `${STATUS_LABELS[status] || status} ${counts[status]} 条`)
                .join(' · ');
            container.innerHTML = `
                <div class="apu-summary">${esc(summary)}</div>
                <div class="apu-table-wrap">
                    <table class="apu-table">
                        <thead><tr>
                            <th class="apu-col-row">行</th>
                            <th class="apu-col-name">最终广告位名称</th>
                            <th class="apu-col-type">类型</th>
                            <th class="apu-col-mode">结算</th>
                            <th class="apu-col-size">尺寸</th>
                            <th>状态</th>
                        </tr></thead>
                        <tbody>${rows.map((row) => `
                            <tr>
                                <td>${row.rowNumber}</td>
                                <td class="apu-col-name">${esc(row.name || row.sourceName || '-')}</td>
                                <td>${esc(row.type || '-')}</td>
                                <td>${row.mode ? esc(priceText(row)) : '-'}</td>
                                <td class="apu-col-size">${row.width ? `${row.width}×${row.height}` : '-'}</td>
                                <td>
                                    <div class="apu-status apu-status-${esc(row.status)}">${esc(STATUS_LABELS[row.status] || row.status)}</div>
                                    ${(row.phase || row.reason) ? `<div class="apu-reason">${esc(row.phase || row.reason)}</div>` : ''}
                                </td>
                            </tr>`).join('')}</tbody>
                    </table>
                </div>`;
        }

        function triggerNativeQuery(table) {
            const queryButton = Array.from(table.querySelectorAll('button.el-button'))
                .find((item) => exactText(item, '查询') && isVisible(item));
            if (queryButton) {
                queryButton.click();
            }
        }

        async function findCreatedPlacement(context, row, knownIds) {
            for (let attempt = 0; attempt < 5; attempt += 1) {
                const matches = (await listPlacements(context.publisherId, context.app.id, row.name))
                    .filter((item) => item.name === row.name && !knownIds.has(String(item.id)));
                if (matches.length === 1) {
                    return matches[0].id;
                }
                if (matches.length > 1) {
                    throw new Error(`新增后查到 ${matches.length} 个同名广告位，无法确定新广告位 ID`);
                }
                await new Promise((resolve) => win.setTimeout(resolve, 500));
            }
            return '';
        }

        function openImportModal(context) {
            const ui = createModal('SDK 广告位批量上传');
            const state = {
                matrix: null,
                rows: [],
                existing: null,
                fileName: '',
                parsing: false,
                typeConfig: readTypeConfig(win)
            };

            ui.body.innerHTML = `
                <div class="apu-grid">
                    <div class="apu-field">
                        <label>当前应用</label>
                        <input class="apu-input" value="${esc(context.app.name)}" disabled>
                    </div>
                    <div class="apu-field">
                        <label>广告位名称前缀（留空时使用应用名称）</label>
                        <input class="apu-input" data-role="prefix" placeholder="${esc(context.app.name)}">
                        <div class="apu-naming-options">
                            <label class="apu-checkbox"><input type="checkbox" data-role="include-prefix">名称包含前缀</label>
                            <label class="apu-checkbox"><input type="checkbox" data-role="include-type">名称包含位置类型</label>
                        </div>
                    </div>
                </div>
                <details class="apu-size-settings">
                    <summary>默认尺寸（宽 × 高）</summary>
                    <div class="apu-size-grid">
                        ${Object.keys(TYPE_CONFIG).map((type) => `
                            <div class="apu-field">
                                <label>${esc(type)}</label>
                                <div class="apu-size-pair">
                                    <input class="apu-input" type="number" min="1" step="1" required aria-label="${esc(type)} 默认宽度" data-size-type="${esc(type)}" data-dimension="width" value="${state.typeConfig[type].width}">
                                    <span aria-hidden="true">×</span>
                                    <input class="apu-input" type="number" min="1" step="1" required aria-label="${esc(type)} 默认高度" data-size-type="${esc(type)}" data-dimension="height" value="${state.typeConfig[type].height}">
                                </div>
                            </div>`).join('')}
                    </div>
                    <div class="apu-actions">
                        <button type="button" class="el-button el-button--primary" data-role="save-sizes"><i class="el-icon-check" aria-hidden="true"></i><span>保存默认尺寸</span></button>
                        <button type="button" class="el-button el-button--default" data-role="reset-sizes"><i class="el-icon-refresh-left" aria-hidden="true"></i><span>恢复初始尺寸</span></button>
                        <span class="apu-size-status" data-role="size-status" role="status" aria-live="polite"></span>
                    </div>
                </details>
                <div class="apu-field" style="margin-top:14px">
                    <label>Excel 文件</label>
                    <div class="apu-actions">
                        <button type="button" class="el-button el-button--primary is-round" data-role="choose"><span>选择文件</span></button>
                        <button type="button" class="el-button el-button--default is-round" data-role="template"><span>下载模板</span></button>
                        <span class="apu-file-name" data-role="file-name">尚未选择文件</span>
                        <input type="file" data-role="file" accept=".xlsx,.xls" hidden>
                    </div>
                </div>
                <div class="apu-tip">
                    支持 banner、interstitial、incentivized、native、splash。尺寸可填 320x50，留空使用默认尺寸。每行创建一个广告位；确认前只做读取和校验，不会修改 CMS。
                </div>
                <div data-role="message"></div>
                <div data-role="preview"></div>`;

            const prefixInput = ui.body.querySelector('[data-role="prefix"]');
            const includePrefixInput = ui.body.querySelector('[data-role="include-prefix"]');
            const includeTypeInput = ui.body.querySelector('[data-role="include-type"]');
            try {
                includePrefixInput.checked = win.localStorage.getItem(INCLUDE_PREFIX_KEY) !== 'false';
                includeTypeInput.checked = win.localStorage.getItem(INCLUDE_TYPE_KEY) === 'true';
            } catch (error) {
                includePrefixInput.checked = true;
                includeTypeInput.checked = false;
            }
            prefixInput.disabled = !includePrefixInput.checked;
            const fileInput = ui.body.querySelector('[data-role="file"]');
            const fileName = ui.body.querySelector('[data-role="file-name"]');
            const message = ui.body.querySelector('[data-role="message"]');
            const preview = ui.body.querySelector('[data-role="preview"]');
            const sizeInputs = Array.from(ui.body.querySelectorAll('[data-size-type]'));
            const saveSizesButton = ui.body.querySelector('[data-role="save-sizes"]');
            const resetSizesButton = ui.body.querySelector('[data-role="reset-sizes"]');
            const sizeStatus = ui.body.querySelector('[data-role="size-status"]');
            const chooseButton = ui.body.querySelector('[data-role="choose"]');
            const templateButton = ui.body.querySelector('[data-role="template"]');
            const closeButton = elementButton('关闭', 'el-button--default', () => closeModal(false));
            const executeButton = elementButton('确认创建', 'el-button--primary', () => executeReadyRows());
            executeButton.disabled = true;
            ui.footer.append(closeButton, executeButton);

            function setMessage(text, isError) {
                message.innerHTML = text
                    ? `<div class="${isError ? 'apu-error' : 'apu-tip'}">${esc(text)}</div>`
                    : '';
            }

            function refreshExecuteButton() {
                const count = state.rows.filter((row) => row.status === 'ready').length;
                const sizesDirty = sizeInputs.some((input) => (
                    input.value !== String(state.typeConfig[input.dataset.sizeType][input.dataset.dimension])
                ));
                executeButton.disabled = running || state.parsing || sizesDirty || count === 0;
                executeButton.querySelector('span').textContent = count ? `确认创建 ${count} 条` : '确认创建';
                sizeInputs.forEach((input) => { input.disabled = running || state.parsing || preserveResult; });
                saveSizesButton.disabled = running || state.parsing || preserveResult || !sizesDirty;
                resetSizesButton.disabled = running || state.parsing || preserveResult;
            }

            function setSizeStatus(text, isError) {
                sizeStatus.textContent = text;
                sizeStatus.dataset.error = String(Boolean(isError));
            }

            function persistSizes(config) {
                if (running || state.parsing || preserveResult) {
                    return;
                }
                try {
                    state.typeConfig = saveTypeConfig(win, config);
                    sizeInputs.forEach((input) => {
                        input.value = state.typeConfig[input.dataset.sizeType][input.dataset.dimension];
                    });
                    setSizeStatus('默认尺寸已保存到本地', false);
                    rebuildPreview(false);
                } catch (error) {
                    setSizeStatus(`保存失败：${error.message}`, true);
                }
                refreshExecuteButton();
            }

            sizeInputs.forEach((input) => input.addEventListener('input', () => {
                setSizeStatus('默认尺寸有未保存的修改', false);
                refreshExecuteButton();
            }));
            saveSizesButton.addEventListener('click', () => {
                const config = {};
                sizeInputs.forEach((input) => {
                    const type = input.dataset.sizeType;
                    if (!config[type]) {
                        config[type] = {};
                    }
                    config[type][input.dataset.dimension] = input.value;
                });
                persistSizes(config);
            });
            resetSizesButton.addEventListener('click', () => persistSizes(TYPE_CONFIG));
            refreshExecuteButton();

            async function rebuildPreview(reloadExisting) {
                if (!state.matrix || state.parsing || running) {
                    return;
                }
                state.parsing = true;
                refreshExecuteButton();
                setMessage('正在校验 Excel 并加载已有广告位…', false);
                try {
                    if (reloadExisting || !state.existing) {
                        state.existing = await listPlacements(context.publisherId, context.app.id, '');
                    }
                    const rows = normalizeRows(state.matrix, {
                        prefix: prefixInput.value,
                        appName: context.app.name,
                        includePrefix: includePrefixInput.checked,
                        includeType: includeTypeInput.checked,
                        typeConfig: state.typeConfig
                    });
                    resolveTypeIds(rows, context.typeList);
                    classifyRows(rows, state.existing, {
                        appId: context.app.id
                    });
                    state.rows = rows;
                    setMessage('', false);
                    renderRows(preview, state.rows);
                } catch (error) {
                    state.rows = [];
                    preview.innerHTML = '';
                    setMessage(error.message, true);
                } finally {
                    state.parsing = false;
                    refreshExecuteButton();
                }
            }

            let prefixTimer = null;
            prefixInput.addEventListener('input', () => {
                win.clearTimeout(prefixTimer);
                prefixTimer = win.setTimeout(() => rebuildPreview(false), 250);
            });
            [[includePrefixInput, INCLUDE_PREFIX_KEY], [includeTypeInput, INCLUDE_TYPE_KEY]].forEach(([input, key]) => {
                input.addEventListener('change', () => {
                    prefixInput.disabled = !includePrefixInput.checked;
                    try {
                        win.localStorage.setItem(key, String(input.checked));
                    } catch (error) {
                        // The current selection still works when browser storage is unavailable.
                    }
                    rebuildPreview(false);
                });
            });
            chooseButton.addEventListener('click', () => fileInput.click());
            templateButton.addEventListener('click', () => {
                try {
                    downloadTemplate();
                } catch (error) {
                    setMessage(error.message, true);
                }
            });
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files && fileInput.files[0];
                if (!file) {
                    return;
                }
                state.fileName = file.name;
                fileName.textContent = file.name;
                setMessage('正在读取 Excel…', false);
                try {
                    state.matrix = await readWorkbook(file);
                    await rebuildPreview(true);
                } catch (error) {
                    state.matrix = null;
                    state.rows = [];
                    preview.innerHTML = '';
                    setMessage(error.message, true);
                    refreshExecuteButton();
                }
            });

            async function executeReadyRows() {
                if (executeButton.disabled || running || state.parsing || !state.matrix || !featureEnabled()) {
                    return;
                }
                running = true;
                closeButton.disabled = true;
                ui.close.disabled = true;
                prefixInput.disabled = true;
                includePrefixInput.disabled = true;
                includeTypeInput.disabled = true;
                fileInput.disabled = true;
                chooseButton.disabled = true;
                templateButton.disabled = true;
                refreshExecuteButton();
                setMessage('正在重新检查已有广告位…', false);
                try {
                    state.existing = await listPlacements(context.publisherId, context.app.id, '');
                    const freshRows = normalizeRows(state.matrix, {
                        prefix: prefixInput.value,
                        appName: context.app.name,
                        includePrefix: includePrefixInput.checked,
                        includeType: includeTypeInput.checked,
                        typeConfig: state.typeConfig
                    });
                    resolveTypeIds(freshRows, context.typeList);
                    classifyRows(freshRows, state.existing, { appId: context.app.id });
                    state.rows = freshRows;
                    renderRows(preview, state.rows);

                    const ready = state.rows.filter((row) => row.status === 'ready');
                    if (!featureEnabled()) {
                        return;
                    }
                    if (!ready.length) {
                        setMessage('重新检查后没有可创建的广告位，同名记录已跳过。', false);
                        return;
                    }
                    if (!win.confirm(`将在应用「${context.app.name}」创建、启用并同步 ${ready.length} 个广告位，是否继续？`)) {
                        return;
                    }

                    preserveResult = true;
                    setMessage('正在顺序创建广告位，每条创建前会检查同名记录，请不要关闭页面。', false);
                    const knownIds = new Set(state.existing.map((item) => String(item.id)));

                    for (let index = 0; index < ready.length; index += 1) {
                        const row = ready[index];
                        row.status = 'running';
                        row.phase = '等待执行';
                        renderRows(preview, state.rows);
                        try {
                            const result = await executePlacementRow(row, {
                                publisherId: context.publisherId,
                                appId: context.app.id,
                                api: api,
                                knownIds: knownIds,
                                findExistingPlacements: (name) => listPlacements(context.publisherId, context.app.id, name),
                                resolveCreatedId: (targetRow, ids) => findCreatedPlacement(context, targetRow, ids),
                                onPhase: (phase) => {
                                    row.phase = phase;
                                    renderRows(preview, state.rows);
                                }
                            });
                            row.placementId = result.placementId;
                            row.status = result.skipped ? 'skipped' : 'success';
                            row.phase = '';
                            row.reason = result.skipped ? result.reason : `广告位 ID：${result.placementId}`;
                        } catch (error) {
                            row.placementId = error.placementId || '';
                            row.status = ['check', 'add'].includes(error.bulkStage) ? 'failed' : 'partial';
                            row.phase = '';
                            const stageLabels = {
                                check: '同名检测失败，未创建广告位',
                                add: '创建广告位失败',
                                resolve: '广告位可能已创建，但无法定位 ID',
                                mode: '广告位已创建，设置结算模式失败',
                                settlement: '广告位及结算模式已创建，创建结算规则失败',
                                activation: '广告位及结算规则已创建，启用失败',
                                sync: '广告位已创建并启用，同步失败'
                            };
                            row.reason = `${stageLabels[error.bulkStage] || '处理失败'}：${error.message}`;
                            if (row.placementId) {
                                row.reason += `；广告位 ID：${row.placementId}`;
                            }
                        }
                        renderRows(preview, state.rows);
                    }

                    const success = state.rows.filter((row) => row.status === 'success').length;
                    const skipped = state.rows.filter((row) => row.status === 'skipped').length;
                    const partial = state.rows.filter((row) => row.status === 'partial').length;
                    const failed = state.rows.filter((row) => row.status === 'failed').length;
                    setMessage(`处理完成：成功 ${success} 条，跳过 ${skipped} 条，部分完成 ${partial} 条，失败 ${failed} 条。`, partial > 0 || failed > 0);
                    triggerNativeQuery(context.table);
                } catch (error) {
                    setMessage(error.message, true);
                } finally {
                    running = false;
                    closeButton.disabled = false;
                    ui.close.disabled = false;
                    if (!preserveResult) {
                        prefixInput.disabled = !includePrefixInput.checked;
                        includePrefixInput.disabled = false;
                        includeTypeInput.disabled = false;
                        fileInput.disabled = false;
                        chooseButton.disabled = false;
                        templateButton.disabled = false;
                    }
                    refreshExecuteButton();
                }
            }
        }

        async function startFlow() {
            if (running || !featureEnabled()) {
                return;
            }
            const placement = findPlacementTable();
            const query = routeQuery();
            if (!placement || !query.id) {
                throw new Error('当前没有打开 SDK 广告位列表。');
            }
            const selection = readSelectedApp(placement.table);
            if ((!selection.id && selection.id !== 0) && !selection.name) {
                throw new Error('请先在广告位列表的“应用”筛选器中选择一个应用。');
            }

            const loading = createModal('SDK 广告位批量上传');
            loading.body.innerHTML = '<div class="apu-tip">正在读取选中应用和广告类型…</div>';
            try {
                const [appBody, typeBody] = await Promise.all([
                    api.appAll(query.id),
                    api.typeAll(query.id)
                ]);
                const app = resolveSelectedApp(selection, listOf(appBody));
                if (!app) {
                    throw new Error('无法唯一确定当前选中的应用，请清空应用筛选后重新选择。');
                }
                openImportModal({
                    publisherId: query.id,
                    app: app,
                    typeList: listOf(typeBody),
                    table: placement.table
                });
            } catch (error) {
                loading.body.innerHTML = `<div class="apu-error">${esc(error.message)}</div>`;
                loading.footer.appendChild(elementButton('关闭', 'el-button--default', () => closeModal(false)));
            }
        }

        function ensureButton() {
            if (!featureEnabled() || !isTargetPage()) {
                if (button && button.parentElement) {
                    button.remove();
                }
                return;
            }
            const placement = findPlacementTable();
            if (!placement) {
                return;
            }
            if (!button) {
                button = elementButton('批量上传', 'el-button--primary', () => {
                    startFlow().catch((error) => {
                        console.error('[广告位批量上传]', error);
                        win.alert('[广告位批量上传] ' + error.message);
                    });
                });
                button.id = BTN_ID;
            }
            if (placement.addButton && button.parentElement !== placement.addButton.parentElement) {
                placement.addButton.insertAdjacentElement('afterend', button);
            } else if (!placement.addButton && button.parentElement !== placement.actionHost) {
                placement.actionHost.appendChild(button);
            }
        }

        function tick() {
            ensureButton();
            if (!featureEnabled() && !running && !preserveResult) {
                closeModal(false);
            }
        }

        function init() {
            if (win.location.hostname !== 'cms.apicmob.com') {
                return;
            }
            if (runtime && runtime.watch) {
                runtime.watch(tick);
                tick();
                return;
            }
            ['pushState', 'replaceState'].forEach((method) => {
                const raw = win.history[method];
                win.history[method] = function () {
                    const result = raw.apply(this, arguments);
                    win.setTimeout(tick, 0);
                    return result;
                };
            });
            win.addEventListener('hashchange', tick);
            win.addEventListener('popstate', tick);
            win.setInterval(tick, 500);
            tick();
        }

        if (win.document.readyState === 'loading') {
            win.document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }

    return {
        HEADERS,
        TYPE_CONFIG,
        TYPE_CONFIG_KEY,
        UNIT,
        cleanText,
        parseSize,
        normalizeTypeConfig,
        readTypeConfig,
        saveTypeConfig,
        normalizeType,
        normalizeMode,
        parseNonNegativeNumber,
        formatNumber,
        buildPlacementName,
        validateHeaders,
        normalizeRows,
        resolveTypeIds,
        buildPlacementPayload,
        buildSettlementPayload,
        normalizeActions,
        matchesExisting,
        classifyRows,
        extractCreatedId,
        executePlacementRow,
        listOf,
        boot
    };
});
