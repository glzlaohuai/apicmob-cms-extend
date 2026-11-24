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
    const TREE = '[class*="appic-scope-manage-body-content-"] form.fk-appic-tree .vtl-root';
    const GROUPS = '.vtl-list > .vtl-tree-margin:has(> .vtl-list)';
    const NODE_CONTENT = ':scope > .vtl-node-main > .vtl-node-content';
    const COLLAPSED = 'data-apicmob-module-group-collapsed';
    const CONTROL = 'apicmob-module-fold-control';
    const BULK = 'apicmob-module-fold-actions';
    // Lucide icon paths (ISC).
    const ICONS = {
        group: '<path d="m9 18 6-6-6-6"/>',
        open: '<path d="m7 10 5-5 5 5m-10 4 5 5 5-5"/>',
        close: '<path d="m7 5 5 5 5-5m-10 14 5-5 5 5"/>'
    };
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
        ${TITLE_ROW} + ${BODY} ${TREE} textarea {
            max-width: min(100%, 600px);
            max-height: min(240px, 40vh);
            overflow: auto;
        }
        [${COLLAPSED}] {
            display: none !important;
        }
        .${BULK} {
            display: inline-flex;
            gap: 4px;
        }
        .${CONTROL} {
            box-sizing: border-box;
            display: inline-grid;
            place-items: center;
            flex: none;
            width: 24px;
            height: 24px;
            padding: 0;
            border: 1px solid transparent;
            border-radius: 4px;
            background: transparent;
            color: #606266;
            cursor: pointer;
        }
        .${BULK} > .${CONTROL} {
            width: 32px;
            height: 32px;
            border-color: #dcdfe6;
        }
        .${CONTROL}:hover, .${CONTROL}:focus-visible {
            color: #337ecc;
            background: #ecf5ff;
        }
        .${CONTROL}:focus-visible {
            outline: 2px solid #337ecc;
            outline-offset: 1px;
        }
        .${CONTROL}[aria-expanded="true"] svg {
            transform: rotate(90deg);
        }
    `;

    function mountGroups(win, toolbar, tree) {
        const document = win.document;
        const groups = new Map();

        function makeButton(icon, action) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = CONTROL;
            button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                action();
            });
            return button;
        }

        function labelButton(button, label) {
            button.title = label;
            button.setAttribute('aria-label', label);
        }

        function setExpanded(group, expanded) {
            const { panel, button, name } = group;
            panel.toggleAttribute(COLLAPSED, !expanded);
            button.setAttribute('aria-expanded', String(expanded));
            labelButton(button, `${expanded ? '折叠' : '展开'}${name ? `「${name}」` : '设置项'}`);
        }

        const bulk = document.createElement('div');
        bulk.className = BULK;
        bulk.setAttribute('role', 'group');
        bulk.setAttribute('aria-label', '设置项');
        for (const [icon, label, expanded] of [['open', '全部展开', true], ['close', '全部折叠', false]]) {
            const button = makeButton(icon, () => groups.forEach((group) => setExpanded(group, expanded)));
            labelButton(button, label);
            bulk.appendChild(button);
        }

        function release(group) {
            group.button.remove();
            group.panel.removeAttribute(COLLAPSED);
            groups.delete(group.panel);
        }

        function sync() {
            const current = new Set(tree.querySelectorAll(GROUPS));
            for (const group of groups.values()) {
                if (!current.has(group.panel) || !tree.contains(group.button)) release(group);
            }
            for (const panel of current) {
                if (groups.has(panel)) continue;
                const content = panel.previousElementSibling?.querySelector(NODE_CONTENT);
                if (!content) continue;
                const name = content.querySelector('.appic-labels button')?.textContent.trim();
                const button = makeButton('group', () => setExpanded(group, panel.hasAttribute(COLLAPSED)));
                const group = { panel, button, name };
                content.before(button);
                groups.set(panel, group);
                setExpanded(group, true);
            }
            if (!groups.size) bulk.remove();
            else if (bulk.parentElement !== toolbar) toolbar.prepend(bulk);
        }

        sync();
        const observer = new win.MutationObserver(sync);
        observer.observe(tree, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
            bulk.remove();
            groups.forEach(release);
        };
    }

    function boot(win, runtime) {
        const document = win.document;
        let placement;

        function restore() {
            const { title, row, toolbar, anchor } = placement;
            if (placement.unmountGroups) placement.unmountGroups();
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

        function syncTree() {
            const tree = placement.body.querySelector(TREE);
            if (tree === placement.tree && placement.unmountGroups) return;
            if (placement.unmountGroups) placement.unmountGroups();
            placement.tree = tree;
            placement.unmountGroups = tree ? mountGroups(win, placement.toolbar, tree) : null;
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
            if (placement) {
                syncTree();
                return;
            }
            if (!document.head) return;

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
            syncTree();
        }
        runtime.watch(update);
        update();
    }

    return { boot };
});
