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
        ${HEADER} > .row > .activity-min-item {
            grid-column: 1 / -1;
            grid-row: 3;
            display: flex !important;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }
        ${HEADER} .activity-min-input {
            flex: 0 0 110px;
        }
        ${HEADER} .activity-min-item > .el-button + .el-button {
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
            ${HEADER} > .row > .activity-min-item {
                grid-row: 5;
            }
            ${HEADER} .activity-min-item > span:first-child {
                flex-basis: 100%;
            }
        }
    `;

    function boot(win, runtime) {
        const document = win.document;
        const featureEnabled = runtime && runtime.isEnabled ? runtime.isEnabled : () => true;

        function updateLayout() {
            const active = featureEnabled()
                && /^#\/sdk\/config\/overview\/?(?:\?|$)/.test(win.location.hash);
            const headers = new Set(active
                ? Array.from(document.querySelectorAll('.app-info')).filter((header) =>
                    header.querySelector(':scope > .row > .activity-min-item'))
                : []);

            document.querySelectorAll(HEADER).forEach((header) => {
                if (!headers.has(header)) {
                    header.removeAttribute(ATTRIBUTE);
                }
            });

            const style = document.getElementById(STYLE_ID);
            if (!headers.size) {
                if (style) style.remove();
                return;
            }

            if (!style) {
                const nextStyle = document.createElement('style');
                nextStyle.id = STYLE_ID;
                nextStyle.textContent = CSS;
                document.head.appendChild(nextStyle);
            }
            headers.forEach((header) => {
                if (!header.hasAttribute(ATTRIBUTE)) {
                    header.setAttribute(ATTRIBUTE, '');
                }
            });
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
