(function (factory) {
    'use strict';

    const core = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = core;
    }
})(function createModuleEditToolbar() {
    'use strict';

    const STYLE_ID = 'apicmob-module-edit-toolbar';
    const TOOLBAR = '[class*="appic-scope-manage-body_top_right-"]';
    const CONTENT = '[class*="appic-scope-manage-body-content-"]';
    const HEADER = `[class*="appic-scope-manage-body_top-"]:has(> ${TOOLBAR}):has(+ ${CONTENT})`;
    // Remove only the header's layout box so sticky positioning can span the editor scroll area.
    const CSS = `
        ${HEADER} {
            display: contents;
        }
        ${HEADER} > form {
            float: left;
            max-width: 100%;
            margin: 10px 16px 10px 0;
        }
        ${HEADER} > ${TOOLBAR} {
            float: right;
            position: sticky;
            top: 0;
            z-index: 10;
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            align-items: center;
            gap: 8px;
            box-sizing: border-box;
            max-width: 100%;
            padding: 10px 0;
            background: #fff;
        }
        ${HEADER} > ${TOOLBAR} > .el-button {
            margin-left: 0 !important;
        }
        ${HEADER} + ${CONTENT} {
            clear: both;
        }
    `;

    function boot(win, runtime) {
        const document = win.document;
        function update() {
            const active = runtime.isEnabled()
                && win.location.hash.split('?')[0] === '#/system/custom-configuration/module-edit';
            const style = document.getElementById(STYLE_ID);
            if (!active) {
                if (style) style.remove();
            } else if (!style && document.head) {
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
