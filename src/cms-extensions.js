(function (factory) {
    'use strict';

    const core = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = core;
    } else if (typeof window !== 'undefined') {
        window.ApicmobCmsExtensions = core;
    }
})(function createCmsExtensions() {
    'use strict';

    const STORAGE_KEY = 'apicmob-cms-extensions::settings';
    const VERSION = '1.2.2';
    const SETTINGS_PARAM = 'apicmob-cms-settings';
    const PENDING_KEY = 'apicmob-apply-template::pending';
    const FEATURES = Object.freeze([
        Object.freeze({ id: 'reportBack', name: '动态报表返回按钮', location: '数据统计 / 动态报表详情', icon: 'arrow-left' }),
        Object.freeze({ id: 'moduleTemplate', name: '模组配置套用模板', location: '系统管理 / 模组配置编辑', icon: 'layers' }),
        Object.freeze({ id: 'placementBulk', name: 'SDK 广告位批量上传', location: 'SSP / 媒体详情 / SDK 广告位', icon: 'upload' }),
        Object.freeze({ id: 'sdkOverviewLayout', name: 'SDK 配置总览布局', location: 'SDK / 配置管理 / 配置总览', icon: 'layers' }),
        Object.freeze({ id: 'integrationControl', name: '集成渠道控量展示', location: 'SDK / 集成 / 集成概览', icon: 'settings' }),
        Object.freeze({ id: 'integrationNaming', name: '集成模组渠道命名', location: 'SDK / 集成 / 集成详情', icon: 'layers' })
    ]);

    // Lucide icons (ISC license); kept inline so the userscript works without a CDN.
    const ICON_PATHS = {
        'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M5 12h14"/>',
        layers: '<path d="m12.83 2.18 8.6 4.3a.58.58 0 0 1 0 1.04l-8.6 4.3a1.86 1.86 0 0 1-1.66 0l-8.6-4.3a.58.58 0 0 1 0-1.04l8.6-4.3a1.86 1.86 0 0 1 1.66 0"/><path d="m22 12-9.17 4.59a1.86 1.86 0 0 1-1.66 0L2 12"/><path d="m22 17-9.17 4.59a1.86 1.86 0 0 1-1.66 0L2 17"/>',
        upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
        settings: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
        check: '<path d="m20 6-11 11-5-5"/>'
    };

    function icon(name) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
    }

    function normalizeSettings(value) {
        const source = value && value.features;
        const features = {};
        FEATURES.forEach(({ id }) => {
            features[id] = source && typeof source[id] === 'boolean' ? source[id] : true;
        });
        return { version: 1, features };
    }

    function readSettings(win) {
        try {
            return normalizeSettings(JSON.parse(win.localStorage.getItem(STORAGE_KEY)));
        } catch (error) {
            return normalizeSettings(null);
        }
    }

    function saveSettings(win, value) {
        const settings = normalizeSettings(value);
        win.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        return settings;
    }

    function settingsUrl() {
        return `https://cms.apicmob.com/?${SETTINGS_PARAM}=1`;
    }

    function isSettingsPage(location) {
        return new URLSearchParams(location.search).get(SETTINGS_PARAM) === '1';
    }

    function mountSettings(win, host) {
        if (host.shadowRoot) {
            return;
        }
        const root = host.attachShadow({ mode: 'open' });
        const settings = readSettings(win);
        root.innerHTML = `
            <style>
                :host { display: block; min-height: 100vh; background: #f7f8fa; color: #25292e; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; letter-spacing: 0; color-scheme: light; }
                *, *::before, *::after { box-sizing: border-box; }
                a { color: inherit; text-decoration: none; }
                svg { display: block; flex: none; }
                .topbar { height: 68px; padding: 0 32px; border-bottom: 1px solid #e5e7eb; background: #fff; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
                .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
                .brand-mark { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid #d9e4f4; border-radius: 6px; color: #2563b8; background: #f0f6ff; }
                .brand-name { font-size: 16px; font-weight: 600; }
                .back { display: flex; align-items: center; gap: 7px; color: #626b76; font-size: 13px; white-space: nowrap; }
                .back:hover { color: #2563b8; }
                main { max-width: 900px; margin: 0 auto; padding: 56px 32px 40px; }
                .heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 28px; }
                h1 { margin: 0; font-size: 26px; line-height: 1.4; font-weight: 600; }
                .count { color: #68717c; font-size: 13px; white-space: nowrap; }
                .section-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #dce1e7; color: #747d88; font-size: 12px; }
                .feature { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 18px; min-height: 106px; padding: 22px 0; border-bottom: 1px solid #e3e7ec; cursor: pointer; }
                .feature-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 6px; }
                .feature:nth-of-type(1) .feature-icon { background: #e9f1fc; color: #3873b9; }
                .feature:nth-of-type(2) .feature-icon { background: #e9f3ed; color: #39805b; }
                .feature:nth-of-type(3) .feature-icon { background: #faedf0; color: #b65a71; }
                .feature:nth-of-type(4) .feature-icon { background: #edf4f5; color: #397b83; }
                .feature:nth-of-type(5) .feature-icon { background: #f1eef8; color: #7961a5; }
                .feature:nth-of-type(6) .feature-icon { background: #edf2fa; color: #4a6eaa; }
                .feature-name { display: block; margin-bottom: 6px; font-size: 15px; font-weight: 500; overflow-wrap: anywhere; }
                .feature-location { display: block; color: #7c8590; font-size: 12px; overflow-wrap: anywhere; }
                .switch-group { display: flex; align-items: center; gap: 12px; }
                .switch-state { min-width: 39px; color: #747d88; font-size: 12px; }
                .switch-control { position: relative; display: block; width: 40px; height: 24px; flex: none; }
                .switch-control input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; z-index: 1; cursor: pointer; }
                .switch-track { display: block; width: 40px; height: 24px; background: #c7cdd5; border-radius: 12px; transition: background 120ms; }
                .switch-track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; background: #fff; border-radius: 50%; box-shadow: 0 1px 3px #0002; transition: transform 120ms; }
                input:checked + .switch-track { background: #3478c8; }
                input:checked + .switch-track::after { transform: translateX(16px); }
                input:focus-visible + .switch-track { outline: 3px solid #a2c7f0; outline-offset: 3px; }
                .footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 20px; color: #818a95; font-size: 12px; }
                .save-status { display: flex; align-items: center; gap: 6px; min-height: 20px; }
                .save-status[data-error="true"] { color: #bd3449; }
                .save-status svg { width: 15px; height: 15px; color: #428260; }
                @media (prefers-reduced-motion: reduce) { .switch-track, .switch-track::after { transition: none; } }
                @media (max-width: 540px) {
                    .topbar { height: 60px; padding: 0 20px; }
                    main { padding: 36px 20px; }
                    h1 { font-size: 23px; }
                    .heading { align-items: center; }
                    .feature { grid-template-columns: 34px minmax(0, 1fr) 40px; gap: 12px; }
                    .feature-icon { width: 34px; height: 34px; }
                    .feature-name { font-size: 14px; }
                    .switch-state { display: none; }
                }
            </style>
            <header class="topbar">
                <div class="brand"><span class="brand-mark">${icon('settings')}</span><span class="brand-name">CMS 扩展</span></div>
                <a class="back" href="https://cms.apicmob.com/">${icon('arrow-left')}<span>返回 CMS</span></a>
            </header>
            <main>
                <div class="heading"><h1>功能设置</h1><span class="count" data-count></span></div>
                <div class="section-head"><span>功能</span><span>启用状态</span></div>
                <div role="group" aria-label="功能开关">
                    ${FEATURES.map((feature) => `
                        <label class="feature" for="${feature.id}">
                            <span class="feature-icon">${icon(feature.icon)}</span>
                            <span><span class="feature-name">${feature.name}</span><span class="feature-location">${feature.location}</span></span>
                            <span class="switch-group"><span class="switch-state" data-state="${feature.id}"></span><span class="switch-control"><input id="${feature.id}" type="checkbox" role="switch" aria-label="${feature.name}"><span class="switch-track"></span></span></span>
                        </label>`).join('')}
                </div>
                <footer class="footer"><span class="save-status" role="status" aria-live="polite">${icon('check')}<span data-message>设置已加载</span></span><span>v${VERSION}</span></footer>
            </main>`;

        function render(next) {
            FEATURES.forEach(({ id }) => {
                root.getElementById(id).checked = next.features[id];
                root.querySelector(`[data-state="${id}"]`).textContent = next.features[id] ? '已启用' : '已关闭';
            });
            const count = FEATURES.filter(({ id }) => next.features[id]).length;
            root.querySelector('[data-count]').textContent = `${count} / ${FEATURES.length} 已启用`;
        }

        render(settings);
        FEATURES.forEach(({ id }) => {
            root.getElementById(id).addEventListener('change', (event) => {
                const status = root.querySelector('.save-status');
                try {
                    // Read again so a different settings tab cannot overwrite unrelated switches.
                    const next = readSettings(win);
                    next.features[id] = event.target.checked;
                    render(saveSettings(win, next));
                    status.dataset.error = 'false';
                    root.querySelector('[data-message]').textContent = '已保存';
                } catch (error) {
                    render(readSettings(win));
                    status.dataset.error = 'true';
                    root.querySelector('[data-message]').textContent = '保存失败，请检查浏览器存储权限后重试';
                }
            });
        });
        win.addEventListener('storage', (event) => {
            if (event.key === STORAGE_KEY || event.key === null) {
                render(readSettings(win));
                root.querySelector('[data-message]').textContent = '设置已同步';
                root.querySelector('.save-status').dataset.error = 'false';
            }
        });
        win.document.title = 'CMS 扩展 - 功能设置';
    }

    function hasPendingMigration(win) {
        try {
            const pending = JSON.parse(win.sessionStorage.getItem(PENDING_KEY));
            const params = new URLSearchParams(win.location.hash.split('?')[1] || '');
            return Boolean(pending && pending.moduleId && String(pending.moduleId) === params.get('id')
                && Date.now() - pending.ts <= 5 * 60 * 1000);
        } catch (error) {
            return false;
        }
    }

    function boot(win, factories) {
        if (win.location.hostname !== 'cms.apicmob.com' || win.__apicmobCmsExtensions) {
            return;
        }
        win.__apicmobCmsExtensions = true;
        win.__apicmobCmsExtensionsVersion = VERSION;

        const document = win.document;
        const ready = (callback) => {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', callback, { once: true });
            } else {
                callback();
            }
        };

        if (isSettingsPage(win.location)) {
            const hideCms = () => {
                if (!document.documentElement) return;
                const style = document.createElement('style');
                style.textContent = 'html body { margin: 0 !important; padding: 0 !important; background: #f7f8fa !important; } body > :not(#apicmob-cms-settings) { display: none !important; }';
                document.documentElement.appendChild(style);
            };
            hideCms();
            ready(() => {
                hideCms();
                const host = document.createElement('div');
                host.id = 'apicmob-cms-settings';
                document.body.appendChild(host);
                mountSettings(win, host);
            });
            return;
        }

        let settings = readSettings(win);
        const started = new Set();
        const watchers = new Set();
        const watch = (callback) => watchers.add(callback);
        const tick = () => watchers.forEach((callback) => {
            try {
                callback();
            } catch (error) {
                win.console.error('[CMS 扩展]', error);
            }
        });

        function applySettings() {
            FEATURES.forEach(({ id }) => {
                if (started.has(id) || (!settings.features[id] && !(id === 'moduleTemplate' && hasPendingMigration(win)))) {
                    return;
                }
                try {
                    factories[id]({ isEnabled: () => settings.features[id], watch, right: '76px' });
                    started.add(id);
                } catch (error) {
                    win.console.error(`[CMS 扩展] ${id} 启动失败`, error);
                }
            });
            tick();
        }

        applySettings();
        win.addEventListener('storage', (event) => {
            if (event.key === STORAGE_KEY || event.key === null) {
                settings = readSettings(win);
                applySettings();
            }
        });

        ready(() => {
            const host = document.createElement('div');
            host.id = 'apicmob-cms-extensions-launcher';
            host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:99998;width:40px;height:40px;';
            const root = host.attachShadow({ mode: 'open' });
            root.innerHTML = `<style>:host { color-scheme: light; } a { display:grid;place-items:center;box-sizing:border-box;width:40px;height:40px;color:#4b5e74;background:#fff;border:1px solid #dce2e9;border-radius:6px;box-shadow:0 2px 8px #0001; } a:hover { color:#2563b8;border-color:#82afe2; } a:focus-visible { outline:3px solid #a2c7f0;outline-offset:2px; }</style><a href="${settingsUrl()}" target="_blank" rel="noopener" title="CMS 扩展设置" aria-label="CMS 扩展设置">${icon('settings')}</a>`;
            document.body.appendChild(host);

            ['pushState', 'replaceState'].forEach((method) => {
                const original = win.history[method];
                win.history[method] = function () {
                    const result = original.apply(this, arguments);
                    win.setTimeout(tick, 0);
                    return result;
                };
            });
            win.addEventListener('hashchange', tick);
            win.addEventListener('popstate', tick);
            win.setInterval(tick, 500);
            tick();
        });
    }

    return { STORAGE_KEY, VERSION, SETTINGS_PARAM, FEATURES, normalizeSettings, readSettings, saveSettings, settingsUrl, isSettingsPage, mountSettings, hasPendingMigration, boot };
});
