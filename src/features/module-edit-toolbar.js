(function (factory) {
    'use strict';

    const core = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = core;
    }
})(function createModuleEditToolbar() {
    'use strict';

    const STYLE_ID = 'apicmob-module-edit-toolbar';
    const ATTRIBUTE = 'data-apicmob-module-edit-toolbar';
    const TITLE = '[class*="appic-scope-manage-header-"]';
    const BODY = '[class*="appic-scope-manage-body-"]';
    const ROW = '[class*="appic-scope-manage-body_top-"]';
    const TOOLBAR = '[class*="appic-scope-manage-body_top_right-"]';
    const TITLE_ROW = `${TITLE}[${ATTRIBUTE}]`;
    const ROW_TOOLBAR = `:scope > ${TOOLBAR}`;
    const CSS = `
        .d2-container-full__body:has(> ${TITLE_ROW}) {
            display: flex;
            flex-direction: column;
        }
        ${TITLE_ROW} {
            display: flex;
            flex: none;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px 16px;
            box-sizing: border-box;
            min-height: 49px;
            height: auto;
            padding-block: 4px;
            line-height: 1.4;
            white-space: nowrap;
        }
        ${TITLE_ROW} + ${BODY} {
            min-height: 0;
        }
        ${TITLE_ROW} > ${TOOLBAR} {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            align-items: center;
            gap: 8px;
            max-width: 100%;
            margin-left: auto;
        }
        ${TITLE_ROW} > ${TOOLBAR} > .el-button {
            margin-left: 0 !important;
        }
    `;

    function boot(win, runtime) {
        const document = win.document;
        let placement;

        function restore() {
            const { title, row, toolbar, anchor } = placement;
            if (toolbar.parentElement === title) {
                if (anchor.parentNode === row && !row.querySelector(ROW_TOOLBAR)) {
                    anchor.replaceWith(toolbar);
                } else {
                    toolbar.remove();
                }
            }
            anchor.remove();
            title.removeAttribute(ATTRIBUTE);
            placement = undefined;
        }

        function update() {
            const active = runtime.isEnabled()
                && win.location.hash.split('?')[0] === '#/system/custom-configuration/module-edit';
            if (placement) {
                const { title, body, row, toolbar, anchor } = placement;
                if (!active || !title.isConnected || title.nextElementSibling !== body
                    || row.parentElement !== body || toolbar.parentElement !== title
                    || anchor.parentNode !== row || row.querySelector(ROW_TOOLBAR)) {
                    restore();
                }
            }

            const style = document.getElementById(STYLE_ID);
            if (!active) {
                if (style) style.remove();
                return;
            }
            if (placement || !document.head) return;

            const toolbar = document.querySelector(`.d2-container-full__body > ${TITLE} + ${BODY} > ${ROW} > ${TOOLBAR}`);
            if (!toolbar) return;
            const row = toolbar.parentElement;
            const body = row.parentElement;
            const title = body.previousElementSibling;
            // Keep the Vue-owned button group intact and mark its original slot for restoration.
            const anchor = document.createComment(STYLE_ID);
            toolbar.before(anchor);
            title.appendChild(toolbar);
            title.setAttribute(ATTRIBUTE, '');
            placement = { title, body, row, toolbar, anchor };

            if (!style) {
                const next = document.createElement('style');
                next.id = STYLE_ID;
                next.textContent = CSS;
                document.head.appendChild(next);
            }
        }
        runtime.watch(update);
        update();
    }

    return { boot };
});
