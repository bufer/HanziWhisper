// ==UserScript==
// @name         识字释文 HanziWhisper
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  按住Alt键选中汉字，显示拼音、笔画、部首和释义
// @author       HanziWhisper
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      fastly.jsdelivr.net
// @require      https://fastly.jsdelivr.net/npm/cnchar-all/cnchar.all.min.js
// @require      https://fastly.jsdelivr.net/npm/cnchar-draw/cnchar.draw.min.js
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 默认配置
    const DEFAULT_CONFIG = {
        hotkey: 'Shift+Alt+Z',
        enabled: true,
        showPinyin: true,
        showStroke: true,
        showRadical: true,
        showExplain: true,
        showTrad: false,
        autoPlayAudio: false,
        popupPosition: 'auto',
        theme: 'auto',
        popupWidth: 280,
        fontSize: 14,
        autoClose: false,
        closeDelay: 3000
    };

    // 获取配置
    function getConfig() {
        const config = GM_getValue('hanziwhisper_config', DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG, ...config };
    }

    // 保存配置
    function saveConfig(config) {
        GM_setValue('hanziwhisper_config', config);
    }

    // 全局状态
    let isShiftPressed = false;
    let isAltPressed = false;
    let isZPressed = false;
    let popup = null;
    let shadowHost = null;
    let shadowRoot = null;
    let configShadowHost = null;
    let configShadowRoot = null;
    let configModal = null;
    const config = getConfig();

    // 防抖函数
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 检测背景色亮度 (返回 'light' 或 'dark')
    function detectBackgroundBrightness() {
        // 获取 body 背景色
        const bgColor = window.getComputedStyle(document.body).backgroundColor;

        // 解析 rgb 或 rgba
        const rgbMatch = bgColor.match(/\d+/g);
        if (!rgbMatch || rgbMatch.length < 3) {
            // 默认返回 light
            return 'light';
        }

        const r = parseInt(rgbMatch[0]);
        const g = parseInt(rgbMatch[1]);
        const b = parseInt(rgbMatch[2]);

        // 计算亮度 (使用相对亮度公式)
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;

        // 如果亮度 > 128，认为是浅色背景
        return brightness > 128 ? 'light' : 'dark';
    }

    // 检测是否为中文
    function isChinese(text) {
        return /[\u4e00-\u9fa5]/.test(text);
    }

    // 获取汉字信息
    async function getHanziInfo(text) {
        if (!text || !isChinese(text)) {
            return null;
        }

        try {
            const info = {
                text: text,
                pinyin: config.showPinyin ? cnchar.spell(text, 'tone') : '',
                stroke: config.showStroke ? cnchar.stroke(text, 'array') : 0,
                radical: config.showRadical ? await cnchar.radical(text) : '',
                explain: config.showExplain ? await cnchar.explain(text) : '',
                trad: config.showTrad ? cnchar.convert(text, 'trad') : ''
            };
            return info;
        } catch (e) {
            console.error('HanziWhisper: 获取汉字信息失败', e);
            return null;
        }
    }

    // 创建弹窗样式
    function createPopupStyles() {
        return `
            .hw-popup {
                position: fixed;
                z-index: 2147483647;
                background: #ffffff;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                padding: 16px;
                min-width: 200px;
                max-width: 300px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
                font-size: 14px;
                line-height: 1.6;
                color: #333;
            }
            .hw-popup.dark {
                background: #1e1e1e;
                border-color: #333;
                color: #e0e0e0;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            }
            .hw-popup-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
                padding-bottom: 8px;
                border-bottom: 1px solid #f0f0f0;
            }
            .hw-popup.dark .hw-popup-header {
                border-bottom-color: #333;
            }
            .hw-popup-title {
                font-size: 24px;
                font-weight: bold;
                color: #1976d2;
            }
            .hw-popup.dark .hw-popup-title {
                color: #64b5f6;
            }
            .hw-popup-close {
                cursor: pointer;
                color: #999;
                font-size: 18px;
                padding: 4px;
                line-height: 1;
            }
            .hw-popup-close:hover {
                color: #333;
            }
            .hw-popup.dark .hw-popup-close {
                color: #999;
            }
            .hw-popup.dark .hw-popup-close:hover {
                color: #fff;
            }
            .hw-popup-content {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .hw-popup-row {
                display: flex;
                align-items: baseline;
            }
            .hw-popup-label {
                color: #666;
                min-width: 60px;
                font-weight: 500;
            }
            .hw-popup.dark .hw-popup-label {
                color: #aaa;
            }
            .hw-popup-value {
                color: #333;
                flex: 1;
            }
            .hw-popup.dark .hw-popup-value {
                color: #e0e0e0;
            }
            .hw-popup-pinyin {
                color: #1976d2;
                font-size: 16px;
            }
            .hw-popup.dark .hw-popup-pinyin {
                color: #64b5f6;
            }
            .hw-popup-explain {
                color: #555;
                font-size: 13px;
                line-height: 1.5;
            }
            .hw-popup.dark .hw-popup-explain {
                color: #ccc;
            }
            .hw-popup-non-chinese {
                color: #f44336;
                text-align: center;
                padding: 20px 0;
            }
            .hw-popup.dark .hw-popup-non-chinese {
                color: #ff7043;
            }
            .hw-popup-loading {
                text-align: center;
                color: #999;
                padding: 20px 0;
            }
            .hw-popup.dark .hw-popup-loading {
                color: #888;
            }
            .hw-popup-stroke-container {
                display: flex;
                justify-content: center;
                margin: 12px 0;
                border-top: 1px solid #f0f0f0;
                padding-top: 12px;
            }
            .hw-popup.dark .hw-popup-stroke-container {
                border-top-color: #333;
            }
            .hw-popup-stroke-item {
                margin: 0 8px;
            }
            .hanzi-writer {
                display: inline-block;
            }
        `;
    }

    // 创建弹窗
    function createPopup() {
        if (shadowHost) {
            return;
        }

        shadowHost = document.createElement('div');
        shadowHost.id = 'hw-shadow-host';
        document.body.appendChild(shadowHost);

        shadowRoot = shadowHost.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = createPopupStyles();
        shadowRoot.appendChild(style);

        popup = document.createElement('div');
        popup.className = 'hw-popup';
        popup.style.display = 'none';
        shadowRoot.appendChild(popup);
    }

    // 显示弹窗
    function showPopup(x, y, info, selectedText) {
        if (!popup) {
            createPopup();
        }

        let content = '';
        // 检查选中文本长度
        if (selectedText && selectedText.length > 50) {
            content = `<div class="hw-popup-non-chinese" style="color:#ff9800;white-space:normal;">内容过长 (超过50字)<br>请缩减选中内容为单字、词语或诗句</div>`;
        } else if (info && info.text && !info.pinyin) {
            content = `
                <div class="hw-popup-header">
                    <span class="hw-popup-title">${info.text}</span>
                    <span class="hw-popup-close">×</span>
                </div>
                <div class="hw-popup-content">
                    <div class="hw-popup-loading">加载中...</div>
                </div>`;
        } else if (info && info.text) {
            content = `
                <div class="hw-popup-header">
                    <span class="hw-popup-title">${info.text}</span>
                    <span class="hw-popup-close">×</span>
                </div>
                <div class="hw-popup-content">
                    ${config.showPinyin && info.pinyin ? `<div class="hw-popup-row">
                        <span class="hw-popup-label">拼音:</span>
                        <span class="hw-popup-value hw-popup-pinyin">${info.pinyin}</span>
                    </div>` : ''}
                    ${config.showStroke && info.stroke ? `<div class="hw-popup-row">
                        <span class="hw-popup-label">笔画:</span>
                        <span class="hw-popup-value">${Array.isArray(info.stroke) ? info.stroke.join(' ') : info.stroke}</span>
                    </div>` : ''}
                    ${config.showRadical && info.radical ? `<div class="hw-popup-row">
                        <span class="hw-popup-label">部首:</span>
                        <span class="hw-popup-value">${Array.isArray(info.radical) ? info.radical.map(item => item.radical).join(' ') : info.radical}</span>
                    </div>` : ''}
                    ${config.showTrad && info.trad ? `<div class="hw-popup-row">
                        <span class="hw-popup-label">繁体:</span>
                        <span class="hw-popup-value">${info.trad}</span>
                    </div>` : ''}
                    ${config.showExplain && info.explain ? `<div class="hw-popup-row">
                        <span class="hw-popup-label">释义:</span>
                        <span class="hw-popup-value hw-popup-explain">${Array.isArray(info.explain) ? info.explain.join('<br>') : info.explain}</span>
                    </div>` : ''}
                </div>
                ${info.drawContainer ? info.drawContainer : ''}
            `;
        } else {
            content = '<div class="hw-popup-non-chinese">无有效信息</div>';
        }

        popup.innerHTML = content;

        // 确定弹窗主题
        let themeClass = '';
        if (config.theme === 'auto') {
            const detectedTheme = detectBackgroundBrightness();
            themeClass = detectedTheme === 'dark' ? 'dark' : '';
        } else if (config.theme === 'dark') {
            themeClass = 'dark';
        }

        // 应用主题类
        popup.className = 'hw-popup' + (themeClass ? ' ' + themeClass : '');

        // 使用 addEventListener 绑定 Shadow DOM 内的关闭按钮
        const popupCloseBtn = popup.querySelector('.hw-popup-close');
        if (popupCloseBtn) {
            popupCloseBtn.addEventListener('click', hidePopup);
        }
        popup.style.display = 'block';

        // 计算弹窗位置
        const popupRect = popup.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let finalX = x + 10;
        let finalY = y + 10;

        // 防止超出右边界
        if (finalX + popupRect.width > viewportWidth) {
            finalX = x - popupRect.width - 10;
        }

        // 防止超出下边界
        if (finalY + popupRect.height > viewportHeight) {
            finalY = y - popupRect.height - 10;
        }

        // 确保不超出左边界和上边界
        finalX = Math.max(10, finalX);
        finalY = Math.max(10, finalY);

        popup.style.left = finalX + 'px';
        popup.style.top = finalY + 'px';

        // 如果有绘制动画回调，执行它
        if (info && info.onRenderComplete) {
            setTimeout(() => {
                info.onRenderComplete();
            }, 50);
        }
    }

    // 隐藏弹窗
    function hidePopup() {
        if (popup) {
            popup.style.display = 'none';
        }
    }

    // 创建配置页面样式
    function createConfigStyles() {
        return `
            .hw-config-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                z-index: 2147483646;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .hw-config-modal {
                background: #ffffff;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                width: 90%;
                max-width: 500px;
                max-height: 85vh;
                overflow-y: auto;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            }
            .hw-config-modal.dark {
                background: #1e1e1e;
                color: #e0e0e0;
            }
            .hw-config-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px 24px;
                border-bottom: 1px solid #e0e0e0;
            }
            .hw-config-modal.dark .hw-config-header {
                border-bottom-color: #333;
            }
            .hw-config-title {
                font-size: 20px;
                font-weight: 600;
                color: #1976d2;
            }
            .hw-config-modal.dark .hw-config-title {
                color: #64b5f6;
            }
            .hw-config-close {
                cursor: pointer;
                color: #999;
                font-size: 24px;
                line-height: 1;
                padding: 4px;
                transition: color 0.2s;
            }
            .hw-config-close:hover {
                color: #333;
            }
            .hw-config-modal.dark .hw-config-close:hover {
                color: #fff;
            }
            .hw-config-body {
                padding: 20px 24px;
            }
            .hw-config-section {
                margin-bottom: 24px;
            }
            .hw-config-section:last-child {
                margin-bottom: 0;
            }
            .hw-config-section-title {
                font-size: 14px;
                font-weight: 600;
                color: #666;
                margin-bottom: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .hw-config-modal.dark .hw-config-section-title {
                color: #999;
            }
            .hw-config-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 0;
                border-bottom: 1px solid #f0f0f0;
            }
            .hw-config-item:last-child {
                border-bottom: none;
            }
            .hw-config-modal.dark .hw-config-item {
                border-bottom-color: #333;
            }
            .hw-config-label {
                font-size: 14px;
                color: #333;
            }
            .hw-config-modal.dark .hw-config-label {
                color: #e0e0e0;
            }
            .hw-config-description {
                font-size: 12px;
                color: #999;
                margin-top: 4px;
            }
            .hw-config-select,
            .hw-config-input {
                padding: 6px 10px;
                border: 1px solid #ddd;
                border-radius: 6px;
                font-size: 14px;
                background: #fff;
                color: #333;
                min-width: 120px;
            }
            .hw-config-modal.dark .hw-config-select,
            .hw-config-modal.dark .hw-config-input {
                background: #2d2d2d;
                border-color: #444;
                color: #e0e0e0;
            }
            .hw-config-select:focus,
            .hw-config-input:focus {
                outline: none;
                border-color: #1976d2;
            }
            .hw-config-toggle {
                position: relative;
                width: 44px;
                height: 24px;
            }
            .hw-config-toggle input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            .hw-config-toggle-slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: #ccc;
                transition: 0.3s;
                border-radius: 24px;
            }
            .hw-config-toggle-slider:before {
                position: absolute;
                content: "";
                height: 18px;
                width: 18px;
                left: 3px;
                bottom: 3px;
                background: white;
                transition: 0.3s;
                border-radius: 50%;
            }
            .hw-config-toggle input:checked + .hw-config-toggle-slider {
                background: #1976d2;
            }
            .hw-config-toggle input:checked + .hw-config-toggle-slider:before {
                transform: translateX(20px);
            }
            .hw-config-footer {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding: 16px 24px;
                border-top: 1px solid #e0e0e0;
            }
            .hw-config-modal.dark .hw-config-footer {
                border-top-color: #333;
            }
            .hw-config-btn {
                padding: 8px 20px;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
            }
            .hw-config-btn-cancel {
                background: #f5f5f5;
                color: #666;
            }
            .hw-config-btn-cancel:hover {
                background: #e0e0e0;
            }
            .hw-config-modal.dark .hw-config-btn-cancel {
                background: #333;
                color: #999;
            }
            .hw-config-modal.dark .hw-config-btn-cancel:hover {
                background: #444;
            }
            .hw-config-btn-save {
                background: #1976d2;
                color: white;
            }
            .hw-config-btn-save:hover {
                background: #1565c0;
            }
            .hw-config-btn-reset {
                background: #f44336;
                color: white;
            }
            .hw-config-btn-reset:hover {
                background: #d32f2f;
            }
        `;
    }

    // 创建配置页面 HTML
    function createConfigHTML(currentConfig) {
        return `
            <div class="hw-config-overlay">
                <div class="hw-config-modal ${currentConfig.theme === 'dark' ? 'dark' : ''}">
                    <div class="hw-config-header">
                        <span class="hw-config-title">⚙️ 识字释文配置</span>
                        <span class="hw-config-close">×</span>
                    </div>
                    <div class="hw-config-body">
                        <div class="hw-config-section">
                            <div class="hw-config-section-title">基本设置</div>
                            <div class="hw-config-item">
                                <div>
                                    <div class="hw-config-label">启用识字释文</div>
                                    <div class="hw-config-description">是否启用汉字信息显示功能</div>
                                </div>
                                <label class="hw-config-toggle">
                                    <input type="checkbox" id="hw-config-enabled" ${currentConfig.enabled ? 'checked' : ''}>
                                    <span class="hw-config-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="hw-config-item">
                                <div>
                                    <div class="hw-config-label">快捷键</div>
                                    <div class="hw-config-description">按住快捷键选中汉字时显示信息</div>
                                </div>
                                <select class="hw-config-select" id="hw-config-hotkey">
                                    <option value="Shift+Alt" ${currentConfig.hotkey === 'Shift+Alt+Z' ? 'selected' : ''}>Shift + Alt + Z</option>
                                    <option value="Ctrl+Alt" ${currentConfig.hotkey === 'Shift+Ctrl+Alt+Z' ? 'selected' : ''}>Shift + Ctrl + Alt + Z</option>
                                    <option value="Ctrl+Alt" ${currentConfig.hotkey === 'Ctrl+Alt+Z' ? 'selected' : ''}>Ctrl + Alt + Z</option>
                                    <option value="Alt" ${currentConfig.hotkey === 'Alt+Z' ? 'selected' : ''}>Alt + Z</option>
                                </select>
                            </div>
                        </div>
                        <div class="hw-config-section">
                            <div class="hw-config-section-title">显示内容</div>
                            <div class="hw-config-item">
                                <div class="hw-config-label">显示拼音</div>
                                <label class="hw-config-toggle">
                                    <input type="checkbox" id="hw-config-showPinyin" ${currentConfig.showPinyin ? 'checked' : ''}>
                                    <span class="hw-config-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="hw-config-item">
                                <div class="hw-config-label">显示笔画</div>
                                <label class="hw-config-toggle">
                                    <input type="checkbox" id="hw-config-showStroke" ${currentConfig.showStroke ? 'checked' : ''}>
                                    <span class="hw-config-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="hw-config-item">
                                <div class="hw-config-label">显示部首</div>
                                <label class="hw-config-toggle">
                                    <input type="checkbox" id="hw-config-showRadical" ${currentConfig.showRadical ? 'checked' : ''}>
                                    <span class="hw-config-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="hw-config-item">
                                <div class="hw-config-label">显示释义</div>
                                <label class="hw-config-toggle">
                                    <input type="checkbox" id="hw-config-showExplain" ${currentConfig.showExplain ? 'checked' : ''}>
                                    <span class="hw-config-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="hw-config-item">
                                <div class="hw-config-label">显示繁体字</div>
                                <label class="hw-config-toggle">
                                    <input type="checkbox" id="hw-config-showTrad" ${currentConfig.showTrad ? 'checked' : ''}>
                                    <span class="hw-config-toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        <div class="hw-config-section">
                            <div class="hw-config-section-title">外观设置</div>
                            <div class="hw-config-item">
                                <div>
                                    <div class="hw-config-label">主题</div>
                                    <div class="hw-config-description">显示主题（自动、浅色、深色）</div>
                                </div>
                                <select class="hw-config-select" id="hw-config-theme">
                                    <option value="auto" ${currentConfig.theme === 'auto' ? 'selected' : ''}>自动</option>
                                    <option value="light" ${currentConfig.theme === 'light' ? 'selected' : ''}>浅色</option>
                                    <option value="dark" ${currentConfig.theme === 'dark' ? 'selected' : ''}>深色</option>
                                </select>
                            </div>
                            <div class="hw-config-item">
                                <div>
                                    <div class="hw-config-label">弹窗宽度</div>
                                    <div class="hw-config-description">设置信息弹窗的宽度（像素）</div>
                                </div>
                                <input type="number" class="hw-config-input" id="hw-config-popupWidth" value="${currentConfig.popupWidth}" min="200" max="500" step="10">
                            </div>
                            <div class="hw-config-item">
                                <div>
                                    <div class="hw-config-label">字体大小</div>
                                    <div class="hw-config-description">设置信息弹窗的字体大小（像素）</div>
                                </div>
                                <input type="number" class="hw-config-input" id="hw-config-fontSize" value="${currentConfig.fontSize}" min="12" max="20" step="1">
                            </div>
                        </div>
                        <div class="hw-config-section">
                            <div class="hw-config-section-title">高级设置</div>
                            <div class="hw-config-item">
                                <div>
                                    <div class="hw-config-label">自动播放读音</div>
                                    <div class="hw-config-description">显示汉字信息时自动播放读音</div>
                                </div>
                                <label class="hw-config-toggle">
                                    <input type="checkbox" id="hw-config-autoPlayAudio" ${currentConfig.autoPlayAudio ? 'checked' : ''}>
                                    <span class="hw-config-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="hw-config-item">
                                <div>
                                    <div class="hw-config-label">自动关闭弹窗</div>
                                    <div class="hw-config-description">显示一段时间后自动关闭弹窗</div>
                                </div>
                                <label class="hw-config-toggle">
                                    <input type="checkbox" id="hw-config-autoClose" ${currentConfig.autoClose ? 'checked' : ''}>
                                    <span class="hw-config-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="hw-config-item">
                                <div>
                                    <div class="hw-config-label">关闭延迟</div>
                                    <div class="hw-config-description">自动关闭弹窗的延迟时间（毫秒）</div>
                                </div>
                                <input type="number" class="hw-config-input" id="hw-config-closeDelay" value="${currentConfig.closeDelay}" min="1000" max="10000" step="500">
                            </div>
                        </div>
                    </div>
                    <div class="hw-config-footer">
                        <button class="hw-config-btn hw-config-btn-reset">重置默认</button>
                        <button class="hw-config-btn hw-config-btn-cancel">取消</button>
                        <button class="hw-config-btn hw-config-btn-save">保存</button>
                    </div>
                </div>
            </div>
        `;
    }

    // 打开配置页面
    function openConfig() {
        if (configShadowHost) {
            return;
        }

        configShadowHost = document.createElement('div');
        configShadowHost.id = 'hw-config-shadow-host';
        document.body.appendChild(configShadowHost);

        configShadowRoot = configShadowHost.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = createConfigStyles();
        configShadowRoot.appendChild(style);

        const wrapper = document.createElement('div');
        wrapper.innerHTML = createConfigHTML(config);
        configShadowRoot.appendChild(wrapper);

        configModal = wrapper.querySelector('.hw-config-overlay');
        // 在 Shadow DOM 中使用 addEventListener 绑定配置对话框按钮
        const cfgCloseBtn = wrapper.querySelector('.hw-config-close');
        if (cfgCloseBtn) cfgCloseBtn.addEventListener('click', closeConfig);

        const cfgResetBtn = wrapper.querySelector('.hw-config-btn-reset');
        if (cfgResetBtn) cfgResetBtn.addEventListener('click', resetConfig);

        const cfgCancelBtn = wrapper.querySelector('.hw-config-btn-cancel');
        if (cfgCancelBtn) cfgCancelBtn.addEventListener('click', closeConfig);

        const cfgSaveBtn = wrapper.querySelector('.hw-config-btn-save');
        if (cfgSaveBtn) cfgSaveBtn.addEventListener('click', saveConfigFromUI);
    }

    // 关闭配置页面
    function closeConfig() {
        if (configShadowHost) {
            configShadowHost.remove();
            configShadowHost = null;
            configShadowRoot = null;
            configModal = null;
        }
    }

    // 从 UI 保存配置
    function saveConfigFromUI() {
        // 从 Shadow DOM 中查找元素（回退到 document 以防未在 Shadow DOM 中）
        const $ = (sel) => (configShadowRoot ? configShadowRoot.querySelector(sel) : document.querySelector(sel));

        const newConfig = {
            hotkey: ($('#hw-config-hotkey') && $('#hw-config-hotkey').value) || config.hotkey,
            enabled: !!($('#hw-config-enabled') && $('#hw-config-enabled').checked),
            showPinyin: !!($('#hw-config-showPinyin') && $('#hw-config-showPinyin').checked),
            showStroke: !!($('#hw-config-showStroke') && $('#hw-config-showStroke').checked),
            showRadical: !!($('#hw-config-showRadical') && $('#hw-config-showRadical').checked),
            showExplain: !!($('#hw-config-showExplain') && $('#hw-config-showExplain').checked),
            showTrad: !!($('#hw-config-showTrad') && $('#hw-config-showTrad').checked),
            autoPlayAudio: !!($('#hw-config-autoPlayAudio') && $('#hw-config-autoPlayAudio').checked),
            popupPosition: config.popupPosition,
            theme: ($('#hw-config-theme') && $('#hw-config-theme').value) || config.theme,
            popupWidth: parseInt(($('#hw-config-popupWidth') && $('#hw-config-popupWidth').value) || config.popupWidth || 280),
            fontSize: parseInt(($('#hw-config-fontSize') && $('#hw-config-fontSize').value) || config.fontSize || 14),
            autoClose: !!($('#hw-config-autoClose') && $('#hw-config-autoClose').checked),
            closeDelay: parseInt(($('#hw-config-closeDelay') && $('#hw-config-closeDelay').value) || config.closeDelay || 3000)
        };

        saveConfig(newConfig);
        Object.assign(config, newConfig);
        closeConfig();
        // alert('配置已保存！');
    }

    // 重置配置为默认值
    function resetConfig() {
        if (confirm('确定要重置所有配置为默认值吗？')) {
            saveConfig(DEFAULT_CONFIG);
            Object.assign(config, DEFAULT_CONFIG);
            closeConfig();
            openConfig();
            alert('配置已重置为默认值！');
        }
    }

    // 处理文本选择
    const handleSelection = debounce(async () => {
        if (!config.enabled) {
            return;
        }

        const selection = window.getSelection();
        const text = selection.toString().trim();

        if (!text) {
            hidePopup();
            return;
        }

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // 检查文本长度是否超过50字
        if (text.length > 50) {
            showPopup(rect.left, rect.bottom, null, text);
            return;
        }

        // 立即显示加载状态弹窗（只显示选中文本）
        showPopup(rect.left, rect.bottom, { text: text, pinyin: '', stroke: '', radical: '', explain: '', trad: '' }, text);

        // 异步获取详细信息
        const info = await getHanziInfo(text);

        if (info) {
            // 如果字符数 <= 4，生成笔画绘制容器
            let drawId = 'hw-draw-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
            let drawContainer = '';
            if (text.length <= 4) {
                drawContainer = `<div class="hw-popup-stroke-container" id="${drawId}"></div>`;
            }
            info.drawContainer = drawContainer;
            info.onRenderComplete = () => {
                // 绘制完成后再进行笔画绘制
                if (text.length <= 4 && typeof cnchar !== 'undefined' && cnchar.draw) {
                    try {
                        setTimeout(() => {
                            const drawEl = shadowRoot.querySelector('#' + drawId);
                            if (drawEl) {
                                cnchar.draw(text, {
                                    el: drawEl,
                                    type: 'animation',
                                    clear: true,
                                    style: {
                                        length: 50,
                                        padding: 10,
                                        outlineColor: '#ddd',
                                        strokeColor: '#555',
                                        backgroundColor: '#fff'
                                    },
                                    animation: {
                                        strokeAnimationSpeed: 1,
                                        delayBetweenStrokes: 200,
                                        autoAnimate: true
                                    }
                                });
                            }
                        }, 0);
                    } catch (e) {
                        console.error('HanziWhisper: 绘制笔画失败', e);
                    }
                }
            };
        }

        // 更新弹窗显示完整信息
        showPopup(rect.left, rect.bottom, info, text);
    }, 100);

    // 快捷键事件监听 (Shift+Alt+Z 组合键)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Shift' || e.shiftKey) isShiftPressed = true;
        if (e.key === 'Alt' || e.altKey) isAltPressed = true;
        if ((e.key === 'z' || e.key === 'Z') && e.shiftKey && e.altKey) {
            isZPressed = true;
            e.preventDefault();
            handleSelection();
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') isShiftPressed = false;
        if (e.key === 'Alt') isAltPressed = false;
        if (e.key === 'z' || e.key === 'Z') isZPressed = false;
    });

    // 点击页面其他地方隐藏弹窗
    document.addEventListener('click', (e) => {
        if (shadowHost && !shadowHost.contains(e.target)) {
            hidePopup();
        }
    });

    // 暴露全局方法
    window.hanziwhisper = {
        hidePopup: hidePopup,
        getConfig: getConfig,
        saveConfig: saveConfig,
        openConfig: openConfig,
        closeConfig: closeConfig,
        saveConfigFromUI: saveConfigFromUI,
        resetConfig: resetConfig
    };

    // 注册菜单命令
    GM_registerMenuCommand('⚙️ 打开配置页面', () => {
        openConfig();
    });

    GM_registerMenuCommand('🔄 切换启用状态', () => {
        config.enabled = !config.enabled;
        saveConfig(config);
        alert(`识字释文已${config.enabled ? '启用' : '禁用'}`);
    });

    console.log('识字释文 HanziWhisper v0.1.0 已加载');
})();
