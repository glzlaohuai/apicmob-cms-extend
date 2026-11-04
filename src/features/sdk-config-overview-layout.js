(function (factory) {
    'use strict';

    const core = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = core;
    }
})(function createSdkConfigOverviewLayout() {
    'use strict';

    const STYLE_ID = 'apicmob-sdk-config-overview-layout';
    const ATTRIBUTE = 'data-apicmob-sdk-overview-layout';
    const HEADER = `.app-info[${ATTRIBUTE}]`;
    const PANEL_CLASS = 'apicmob-sdk-activity-min-panel';
    const PANEL = `.${PANEL_CLASS}`;
    const NATIVE_CONTROL = ':scope > .row > .activity-min-item';
    const CSS = `
        ${HEADER} {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 385px));
            gap: 20px 0;
            padding-bottom: 20px !important;
        }
        ${HEADER} > .row {
            display: contents !important;
        }
        ${HEADER} > .row > div {
            min-width: 0 !important;
            overflow-wrap: anywhere;
        }
        ${HEADER} > .row:first-child > div:not(.activity-min-item) {
            grid-row: 1;
        }
        ${HEADER} > .row:nth-child(2) > div {
            grid-row: 2;
        }
        ${PANEL}.appic-table-form-header {
            margin-top: 20px;
            padding: 20px 40px !important;
            color: #606266;
        }
        ${PANEL} > .activity-min-item {
            display: flex !important;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            min-width: 0;
            overflow-wrap: anywhere;
        }
        ${PANEL} .activity-min-input {
            width: 110px;
            flex: 0 0 110px;
        }
        ${PANEL} .activity-min-item > .el-button + .el-button {
            margin-left: 0;
        }
        @media (max-width: 700px) {
            ${HEADER} {
                grid-template-columns: minmax(0, 1fr);
            }
            ${HEADER} > .row:first-child > div:nth-child(2) {
                grid-row: 2;
            }
            ${HEADER} > .row:nth-child(2) > div:first-child {
                grid-row: 3;
            }
            ${HEADER} > .row:nth-child(2) > div:nth-child(2) {
                grid-row: 4;
            }
            ${PANEL}.appic-table-form-header {
                padding: 20px !important;
            }
            ${PANEL} .activity-min-item > span:first-child {
                flex-basis: 100%;
            }
        }
    `;

    function boot(win, runtime) {
        const document = win.document;
        const featureEnabled = runtime && runtime.isEnabled ? runtime.isEnabled : () => true;
        const placements = new Map();
        let observer = null;

        function release(placement, restore = true) {
            const { header, control, placeholder, panel } = placement;
            if (restore && placeholder.parentNode) {
                placeholder.replaceWith(control);
            } else {
                placeholder.remove();
            }
            panel.remove();
            header.removeAttribute(ATTRIBUTE);
            placements.delete(header);
        }

        function updateLayout() {
            const active = featureEnabled()
                && /^#\/sdk\/config\/overview\/?(?:\?|$)/.test(win.location.hash);
            if (!active) {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
                placements.forEach((placement) => release(placement));
                const style = document.getElementById(STYLE_ID);
                if (style) style.remove();
                return;
            }

            if (!observer) {
                observer = new win.MutationObserver(updateLayout);
                observer.observe(document.body, { childList: true, subtree: true });
            }

            placements.forEach((placement) => {
                const { header, control, placeholder, panel } = placement;
                if (!header.isConnected || !header.contains(placeholder)) {
                    release(placement);
                } else if (header.querySelector(NATIVE_CONTROL) || !panel.contains(control)) {
                    release(placement, false);
                } else if (header.nextElementSibling !== panel) {
                    header.after(panel);
                }
            });

            document.querySelectorAll('.app-info').forEach((header) => {
                if (placements.has(header)) return;
                const control = header.querySelector(NATIVE_CONTROL);
                if (!control) return;

                // Keep an anchor so the original Vue-owned element can return to its exact position.
                const placeholder = document.createComment('apicmob-sdk-activity-min');
                const panel = document.createElement('div');
                panel.className = `appic-table-form-header ${PANEL_CLASS}`;
                panel.setAttribute('role', 'group');
                panel.setAttribute('aria-label', '正式模式版本活跃度');
                control.before(placeholder);
                panel.appendChild(control);
                header.after(panel);
                header.setAttribute(ATTRIBUTE, '');
                placements.set(header, { header, control, placeholder, panel });
            });

            const style = document.getElementById(STYLE_ID);
            if (!placements.size) {
                if (style) style.remove();
                return;
            }

            if (!style) {
                const nextStyle = document.createElement('style');
                nextStyle.id = STYLE_ID;
                nextStyle.textContent = CSS;
                document.head.appendChild(nextStyle);
            }
        }

        function init() {
            if (runtime && runtime.watch) {
                runtime.watch(updateLayout);
            } else {
                win.addEventListener('hashchange', updateLayout);
                win.setInterval(updateLayout, 500);
            }
            updateLayout();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
    }

    return { boot };
});
