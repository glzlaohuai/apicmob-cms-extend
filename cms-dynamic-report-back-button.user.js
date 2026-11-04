// ==UserScript==
// @name         CMS Dynamic Report Back Button
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  在 dynamic-report 详情页添加返回按钮（支持单页应用）
// @author       You
// @match        https://cms.apicmob.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function (factory) {
    'use strict';

    const core = factory();
    if (typeof window !== 'undefined' && window.document) {
        core.boot(window);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = core;
    }
})(function createDynamicReportBackButton() {
    'use strict';

    function boot(win, runtime) {
        const document = win.document;
        const featureEnabled = runtime && runtime.isEnabled ? runtime.isEnabled : () => true;
        const BASE_URL = 'https://cms.apicmob.com/#/data-statistics/dynamic-report';
        const pattern = /https:\/\/cms\.apicmob\.com\/#\/data-statistics\/dynamic-report\/.+/;
        let backButton = null;

        function createBackButton() {
            if (backButton) {
                return;
            }

            backButton = document.createElement('button');
            backButton.id = 'dynamic-report-back-btn';
            backButton.textContent = '← 返回动态报表列表';
            backButton.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: ${runtime && runtime.right ? runtime.right : '20px'};
                max-width: calc(100vw - 104px);
                z-index: 99999;
                padding: 10px 20px;
                background-color: #1890ff;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                transition: all 0.3s ease;
            `;

            backButton.addEventListener('mouseenter', function () {
                this.style.backgroundColor = '#40a9ff';
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
            });

            backButton.addEventListener('mouseleave', function () {
                this.style.backgroundColor = '#1890ff';
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
            });

            backButton.addEventListener('click', function () {
                win.location.href = BASE_URL;
            });
        }

        function updateButton() {
            if (featureEnabled() && pattern.test(win.location.href)) {
                createBackButton();
                if (backButton.parentElement !== document.body) {
                    document.body.appendChild(backButton);
                }
            } else if (backButton) {
                backButton.remove();
            }
        }

        function init() {
            if (runtime && runtime.watch) {
                runtime.watch(updateButton);
            } else {
                win.addEventListener('hashchange', updateButton);
                win.setInterval(updateButton, 500);
            }
            updateButton();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
    }

    return { boot };
});
