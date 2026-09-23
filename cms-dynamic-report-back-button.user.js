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

(function () {
    'use strict';

    const BASE_URL = 'https://cms.apicmob.com/#/data-statistics/dynamic-report';
    const pattern = /https:\/\/cms\.apicmob\.com\/#\/data-statistics\/dynamic-report\/.+/;
    let backButton = null;

    // 检查是否应该显示返回按钮
    function shouldShowButton() {
        return pattern.test(window.location.href);
    }

    // 创建返回按钮
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
            right: 20px;
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
            window.location.href = BASE_URL;
        });
    }

    // 更新按钮显示状态
    function updateButton() {
        if (shouldShowButton()) {
            createBackButton();
            if (backButton.parentElement !== document.body) {
                document.body.appendChild(backButton);
            }
            backButton.style.display = 'block';
        } else {
            if (backButton) {
                backButton.style.display = 'none';
            }
        }
    }

    // 监听 hash 变化
    window.addEventListener('hashchange', updateButton);

    // 轮询检测（应对某些 SPA 框架不触发 hashchange 的情况）
    setInterval(updateButton, 500);

    // 初始检查
    updateButton();
})();