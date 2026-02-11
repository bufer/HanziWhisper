// ==UserScript==
// @name         识字释文 HanziWhisper
// @namespace    http://tampermonkey.net/
// @version      0.2.0
// @description  按住Alt键选中汉字，显示拼音、笔画、部首和释义；支持手写输入
// @author       HanziWhisper
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      fastly.jsdelivr.net
// @connect      api.easyocr.org
// @require      https://fastly.jsdelivr.net/npm/cnchar-all/cnchar.all.min.js
// @require      https://fastly.jsdelivr.net/npm/cnchar-draw/cnchar.draw.min.js
// @require      https://cdn.jsdelivr.net/npm/tesseract.js@5.0.0/dist/tesseract.min.js
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
    let handwritingShadowHost = null;
    let handwritingShadowRoot = null;
    let handwritingCanvas = null;
    let handwritingContext = null;
    let isDrawing = false;
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
                    <span class="hw-popup-play" title="播放读音" style="cursor:pointer;font-size:18px;margin-left:8px;">🔊</span>
                    <span class="hw-popup-close">×</span>
                </div>
                <div class="hw-popup-content">
                    <div class="hw-popup-loading">加载中...</div>
                </div>`;
        } else if (info && info.text) {
            content = `
                <div class="hw-popup-header">
                    <span class="hw-popup-title">${info.text}</span>
                    <span class="hw-popup-play" title="播放读音" style="cursor:pointer;font-size:18px;margin-left:8px;">🔊</span>
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
        // 绑定播放按钮
        const popupPlayBtn = popup.querySelector('.hw-popup-play');
        if (popupPlayBtn && info && info.text) {
            popupPlayBtn.addEventListener('click', () => {
                playHanziAudio(info.text);
            });
        }
        popup.style.display = 'block';
    // 播放汉字读音
    function playHanziAudio(text) {
        if (!text) return;
        // 优先使用浏览器SpeechSynthesis
        if ('speechSynthesis' in window) {
            const utter = new SpeechSynthesisUtterance(text);
            utter.lang = 'zh-CN';
            utter.rate = 1;
            utter.pitch = 1;
            window.speechSynthesis.speak(utter);
        } else {
            // 兼容方案：可扩展为调用第三方API
            alert('当前浏览器不支持语音播放功能');
        }
    }

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

    // 创建手写识别页面样式
    function createHandwritingStyles() {
        return `
            .hw-handwriting-overlay {
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
            .hw-handwriting-modal {
                background: #ffffff;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                width: 90%;
                max-width: 600px;
                max-height: 90vh;
                overflow-y: auto;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
                display: flex;
                flex-direction: column;
            }
            .hw-handwriting-modal.dark {
                background: #1e1e1e;
                color: #e0e0e0;
            }
            .hw-handwriting-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px 24px;
                border-bottom: 1px solid #e0e0e0;
            }
            .hw-handwriting-modal.dark .hw-handwriting-header {
                border-bottom-color: #333;
            }
            .hw-handwriting-title {
                font-size: 20px;
                font-weight: 600;
                color: #1976d2;
            }
            .hw-handwriting-modal.dark .hw-handwriting-title {
                color: #64b5f6;
            }
            .hw-handwriting-close {
                cursor: pointer;
                color: #999;
                font-size: 24px;
                line-height: 1;
                padding: 4px;
                transition: color 0.2s;
            }
            .hw-handwriting-close:hover {
                color: #333;
            }
            .hw-handwriting-modal.dark .hw-handwriting-close:hover {
                color: #fff;
            }
            .hw-handwriting-body {
                padding: 20px 24px;
                flex: 1;
                overflow-y: auto;
            }
            .hw-handwriting-canvas-wrapper {
                border: 2px solid #ddd;
                border-radius: 8px;
                margin-bottom: 20px;
                background: #fff;
                overflow: hidden;
            }
            .hw-handwriting-modal.dark .hw-handwriting-canvas-wrapper {
                background: #2d2d2d;
                border-color: #444;
            }
            #hw-handwriting-canvas {
                display: block;
                cursor: crosshair;
                background: white;
                touch-action: none;
            }
            .hw-handwriting-modal.dark #hw-handwriting-canvas {
                background: #2d2d2d;
            }
            .hw-handwriting-results {
                margin-top: 20px;
            }
            .hw-handwriting-result-title {
                font-size: 14px;
                font-weight: 600;
                color: #666;
                margin-bottom: 10px;
            }
            .hw-handwriting-modal.dark .hw-handwriting-result-title {
                color: #aaa;
            }
            .hw-handwriting-result-items {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .hw-handwriting-result-item {
                padding: 8px 12px;
                background: #f5f5f5;
                border: 1px solid #ddd;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
            }
            .hw-handwriting-modal.dark .hw-handwriting-result-item {
                background: #333;
                border-color: #444;
                color: #e0e0e0;
            }
            .hw-handwriting-result-item:hover {
                background: #1976d2;
                color: white;
                border-color: #1976d2;
            }
            .hw-handwriting-result-item.selected {
                background: #1976d2;
                color: white;
                border-color: #1976d2;
            }
            .hw-handwriting-controls {
                display: flex;
                gap: 12px;
                margin-bottom: 20px;
                flex-wrap: wrap;
            }
            .hw-handwriting-btn {
                padding: 8px 16px;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
            }
            .hw-handwriting-btn-primary {
                background: #1976d2;
                color: white;
            }
            .hw-handwriting-btn-primary:hover {
                background: #1565c0;
            }
            .hw-handwriting-btn-secondary {
                background: #f5f5f5;
                color: #666;
                border: 1px solid #ddd;
            }
            .hw-handwriting-modal.dark .hw-handwriting-btn-secondary {
                background: #333;
                color: #aaa;
                border-color: #444;
            }
            .hw-handwriting-btn-secondary:hover {
                background: #e0e0e0;
            }
            .hw-handwriting-modal.dark .hw-handwriting-btn-secondary:hover {
                background: #444;
            }
            .hw-handwriting-footer {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding: 16px 24px;
                border-top: 1px solid #e0e0e0;
            }
            .hw-handwriting-modal.dark .hw-handwriting-footer {
                border-top-color: #333;
            }
            .hw-handwriting-btn-cancel {
                background: #f5f5f5;
                color: #666;
            }
            .hw-handwriting-btn-cancel:hover {
                background: #e0e0e0;
            }
            .hw-handwriting-modal.dark .hw-handwriting-btn-cancel {
                background: #333;
                color: #999;
            }
            .hw-handwriting-modal.dark .hw-handwriting-btn-cancel:hover {
                background: #444;
            }
            .hw-handwriting-btn-confirm {
                background: #1976d2;
                color: white;
            }
            .hw-handwriting-btn-confirm:hover {
                background: #1565c0;
            }
            .hw-handwriting-info {
                font-size: 12px;
                color: #999;
                margin-top: 10px;
            }
            .hw-handwriting-modal.dark .hw-handwriting-info {
                color: #777;
            }
        `;
    }

    // 创建手写识别页面 HTML
    function createHandwritingHTML() {
        return `
            <div class="hw-handwriting-overlay">
                <div class="hw-handwriting-modal ${config.theme === 'dark' ? 'dark' : ''}">
                    <div class="hw-handwriting-header">
                        <span class="hw-handwriting-title">✍️ 手写识别汉字</span>
                        <span class="hw-handwriting-close">×</span>
                    </div>
                    <div class="hw-handwriting-body">
                        <div class="hw-handwriting-controls">
                            <button class="hw-handwriting-btn hw-handwriting-btn-primary" id="hw-handwriting-recognize">🔍 识别</button>
                            <button class="hw-handwriting-btn hw-handwriting-btn-secondary" id="hw-handwriting-clear">🗑️ 清除</button>
                            <button class="hw-handwriting-btn hw-handwriting-btn-secondary" id="hw-handwriting-manual">⌨️ 手动输入</button>
                        </div>
                        <div class="hw-handwriting-manual-tip" style="margin-bottom:12px;color:#1976d2;font-size:13px;">
                            ℹ️ 如果不认识的汉字手写无法识别或识别不正确，可点击“手动输入”按钮，<br>
                            并尝试打开系统虚拟键盘的手写输入，或使用输入法的U模式（如“u+拆分笔画”）输入。
                        </div>
                        <div class="hw-handwriting-canvas-wrapper">
                            <canvas id="hw-handwriting-canvas" width="550" height="350"></canvas>
                        </div>
                        <div class="hw-handwriting-info">
                            💡 <strong>使用提示：</strong>在画布中央手写单个汉字（尽量写大、清晰），点击"识别"查看结果<br>
                            📌 参考辅助线书写，识别后点击汉字即可查看详细信息
                        </div>
                        <div class="hw-handwriting-results">
                            <div class="hw-handwriting-result-title">识别结果（点击查看详情）：</div>
                            <div class="hw-handwriting-result-items" id="hw-handwriting-result-items">
                                <span style="color: #999;">暂无结果</span>
                            </div>
                        </div>
                    </div>
                    <div class="hw-handwriting-footer">
                        <button class="hw-handwriting-btn hw-handwriting-btn-cancel" id="hw-handwriting-cancel">关闭</button>
                    </div>
                </div>
            </div>
        `;
    }

    // 打开手写识别页面
    function openHandwriting() {
        if (handwritingShadowHost) {
            return;
        }

        handwritingShadowHost = document.createElement('div');
        handwritingShadowHost.id = 'hw-handwriting-shadow-host';
        document.body.appendChild(handwritingShadowHost);

        handwritingShadowRoot = handwritingShadowHost.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = createHandwritingStyles();
        handwritingShadowRoot.appendChild(style);

        const wrapper = document.createElement('div');
        wrapper.innerHTML = createHandwritingHTML();
        handwritingShadowRoot.appendChild(wrapper);

        // 绑定事件
        const closeBtn = wrapper.querySelector('.hw-handwriting-close');
        if (closeBtn) closeBtn.addEventListener('click', closeHandwriting);

        const cancelBtn = wrapper.querySelector('#hw-handwriting-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', closeHandwriting);

        const clearBtn = wrapper.querySelector('#hw-handwriting-clear');
        if (clearBtn) clearBtn.addEventListener('click', clearCanvas);

        const manualBtn = wrapper.querySelector('#hw-handwriting-manual');
        if (manualBtn) manualBtn.addEventListener('click', showManualInputOption);

        const recognizeBtn = wrapper.querySelector('#hw-handwriting-recognize');
        if (recognizeBtn) recognizeBtn.addEventListener('click', recognizeHandwriting);

        // 初始化画布
        const canvasEl = handwritingShadowRoot.querySelector('#hw-handwriting-canvas');
        handwritingCanvas = canvasEl;
        handwritingContext = canvasEl.getContext('2d', { willReadFrequently: true });
        // 填充白色背景
        handwritingContext.fillStyle = '#fff';
        handwritingContext.fillRect(0, 0, handwritingCanvas.width, handwritingCanvas.height);
        // 绘制辅助线
        drawGuideLines();
        // 设置画布样式
        handwritingContext.strokeStyle = '#000';
        handwritingContext.lineWidth = 5;
        handwritingContext.lineCap = 'round';
        handwritingContext.lineJoin = 'round';

        // 绑定画布事件
        initCanvasEvents();
    }

    // 关闭手写识别页面
    function closeHandwriting() {
        if (handwritingShadowHost) {
            handwritingShadowHost.remove();
            handwritingShadowHost = null;
            handwritingShadowRoot = null;
            handwritingCanvas = null;
            handwritingContext = null;
        }
    }

    // 初始化画布事件
    function initCanvasEvents() {
        const canvas = handwritingCanvas;
        
        canvas.addEventListener('mousedown', (e) => {
            isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            handwritingContext.beginPath();
            handwritingContext.moveTo(x, y);
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!isDrawing) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            handwritingContext.lineTo(x, y);
            handwritingContext.stroke();
        });

        canvas.addEventListener('mouseup', () => {
            isDrawing = false;
        });

        canvas.addEventListener('mouseleave', () => {
            isDrawing = false;
        });

        // 触屏支持
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            handwritingContext.beginPath();
            handwritingContext.moveTo(x, y);
        });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!isDrawing) return;
            const rect = canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            handwritingContext.lineTo(x, y);
            handwritingContext.stroke();
        });

        canvas.addEventListener('touchend', () => {
            isDrawing = false;
        });
    }

    // 清除画布
    function clearCanvas() {
        if (handwritingContext) {
            // 填充白色背景
            handwritingContext.fillStyle = '#fff';
            handwritingContext.fillRect(0, 0, handwritingCanvas.width, handwritingCanvas.height);
            // 重新绘制辅助线
            drawGuideLines();
            // 重设画笔
            handwritingContext.strokeStyle = '#000';
            handwritingContext.lineWidth = 5;
            handwritingContext.lineCap = 'round';
            handwritingContext.lineJoin = 'round';
            if (handwritingShadowRoot) {
                const resultItems = handwritingShadowRoot.querySelector('#hw-handwriting-result-items');
                if (resultItems) {
                    resultItems.innerHTML = '<span style="color: #999;">暂无结果</span>';
                }
                const insertBtn = handwritingShadowRoot.querySelector('#hw-handwriting-insert');
                if (insertBtn) insertBtn.style.display = 'none';
            }
        }
    }

    // 撤销
    function undoCanvas() {
        // 简单的撤销实现，重新绘制（仅作演示）
        clearCanvas();
    }

    // 高级图像预处理函数
    function preprocessImage(canvas) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        tempCtx.drawImage(canvas, 0, 0);
        
        let imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imgData.data;
        
        // 步骤1: 转换为灰度图
        const grayData = new Uint8Array(tempCanvas.width * tempCanvas.height);
        for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            grayData[i / 4] = gray;
        }
        
        // 步骤2: 计算Otsu阈值（自适应二值化）
        const histogram = new Array(256).fill(0);
        for (let i = 0; i < grayData.length; i++) {
            histogram[grayData[i]]++;
        }
        
        const total = grayData.length;
        let sum = 0;
        for (let i = 0; i < 256; i++) {
            sum += i * histogram[i];
        }
        
        let sumB = 0;
        let wB = 0;
        let wF = 0;
        let maxVariance = 0;
        let threshold = 0;
        
        for (let t = 0; t < 256; t++) {
            wB += histogram[t];
            if (wB === 0) continue;
            
            wF = total - wB;
            if (wF === 0) break;
            
            sumB += t * histogram[t];
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;
            const variance = wB * wF * (mB - mF) * (mB - mF);
            
            if (variance > maxVariance) {
                maxVariance = variance;
                threshold = t;
            }
        }
        
        // 步骤3: 应用二值化（反色处理，黑字白底）
        for (let i = 0; i < grayData.length; i++) {
            const value = grayData[i] > threshold ? 255 : 0;
            const idx = i * 4;
            data[idx] = data[idx + 1] = data[idx + 2] = value;
        }
        
        // 步骤4: 形态学处理 - 去除噪点（可选的中值滤波）
        const filterRadius = 1;
        const filtered = new Uint8ClampedArray(data);
        for (let y = filterRadius; y < tempCanvas.height - filterRadius; y++) {
            for (let x = filterRadius; x < tempCanvas.width - filterRadius; x++) {
                const values = [];
                for (let fy = -filterRadius; fy <= filterRadius; fy++) {
                    for (let fx = -filterRadius; fx <= filterRadius; fx++) {
                        const idx = ((y + fy) * tempCanvas.width + (x + fx)) * 4;
                        values.push(data[idx]);
                    }
                }
                values.sort((a, b) => a - b);
                const median = values[Math.floor(values.length / 2)];
                const idx = (y * tempCanvas.width + x) * 4;
                filtered[idx] = filtered[idx + 1] = filtered[idx + 2] = median;
            }
        }
        
        imgData.data.set(filtered);
        tempCtx.putImageData(imgData, 0, 0);
        
        return tempCanvas;
    }

    // 调用云端API识别手写汉字
    async function recognizeWithCloudAPI(imageDataUrl) {
        try {
            // 将 base64 图片转换为 Blob
            const response = await fetch(imageDataUrl);
            const blob = await response.blob();
            
            // 创建 FormData
            const formData = new FormData();
            formData.append('file', blob, 'handwriting.png');
            
            // 调用云端API (EasyOCR)
            const apiResponse = await fetch('https://api.easyocr.org/ocr', {
                method: 'POST',
                body: formData
            });
            
            if (!apiResponse.ok) {
                throw new Error(`API请求失败: ${apiResponse.status}`);
            }
            
            const result = await apiResponse.json();
            
            // 解析新的返回格式: { "words": [{ "text": "十", "rate": 0.93, ... }] }
            if (result && result.words && Array.isArray(result.words) && result.words.length > 0) {
                // 提取所有识别到的文字，按识别率排序
                const sortedWords = result.words.sort((a, b) => (b.rate || 0) - (a.rate || 0));
                const recognizedTexts = sortedWords.map(word => word.text);
                const recognizedText = recognizedTexts.join('');
                console.log('HanziWhisper: 云端API识别结果:', recognizedText, '| 识别率:', sortedWords[0]?.rate);
                return recognizedText;
            } else {
                throw new Error('API未返回有效结果');
            }
        } catch (error) {
            console.warn('HanziWhisper: 云端API识别失败，将使用本地识别', error);
            throw error;
        }
    }

    // 使用本地Tesseract.js识别手写汉字
    async function recognizeWithLocalOCR(imageUrl, resultItems) {
        if (typeof Tesseract === 'undefined') {
            throw new Error('OCR库加载失败，请刷新页面后重试');
        }

        // 初始化Worker（如果尚未初始化）
        if (!window.hwTesseractWorker) {
            let createWorker = null;
            if (typeof Tesseract.createWorker === 'function') {
                createWorker = Tesseract.createWorker;
            } else if (Tesseract.default && typeof Tesseract.default.createWorker === 'function') {
                createWorker = Tesseract.default.createWorker;
            }
            
            if (createWorker) {
                if (resultItems) {
                    resultItems.innerHTML = '<span style="color: #999;">首次加载本地OCR引擎，请稍候...</span>';
                }
                window.hwTesseractWorker = await createWorker('chi_sim+chi_tra', 1, {
                    logger: m => console.log('OCR:', m)
                });
                
                // 设置优化参数，提高手写汉字识别率
                await window.hwTesseractWorker.setParameters({
                    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, // 单个文字块模式
                    tessedit_char_whitelist: '', // 不限制字符集
                    preserve_interword_spaces: '0',
                });
            }
        }

        // 执行识别
        let text = '';
        if (window.hwTesseractWorker && typeof window.hwTesseractWorker.recognize === 'function') {
            if (resultItems) {
                resultItems.innerHTML = '<span style="color: #999;">正在使用本地引擎识别...</span>';
            }
            const result = await window.hwTesseractWorker.recognize(imageUrl);
            text = result.data.text || '';
        } else if (typeof Tesseract.recognize === 'function') {
            // 降级方案：使用静态API
            const result = await Tesseract.recognize(imageUrl, 'chi_sim+chi_tra', {
                logger: m => console.log('OCR:', m)
            });
            text = (result.data && result.data.text) || result.text || '';
        } else {
            throw new Error('Tesseract.js 加载失败或API不兼容');
        }
        
        return text;
    }

    // 识别手写汉字（优先使用云端API，失败时使用本地Tesseract.js）
    async function recognizeHandwriting() {
        if (!handwritingCanvas) {
            alert('画布初始化失败');
            return;
        }

        // 检查是否有绘制内容
        const imageData = handwritingContext.getImageData(0, 0, handwritingCanvas.width, handwritingCanvas.height);
        const hasContent = imageData.data.some((val, idx) => idx % 4 === 3 && val > 128);
        if (!hasContent) {
            alert('请先在画布上手写汉字');
            return;
        }

        // 显示识别中状态
        const resultItems = handwritingShadowRoot.querySelector('#hw-handwriting-result-items');
        if (resultItems) {
            resultItems.innerHTML = '<span style="color: #999;">识别中，请稍候...</span>';
        }

        try {
            let text = '';
            let recognitionMethod = '';
            
            // 优先尝试云端API识别（使用原始画布图片，云端API有自己的预处理）
            try {
                if (resultItems) {
                    resultItems.innerHTML = '<span style="color: #999;">正在使用云端API识别...</span>';
                }
                // 云端API使用原始画布图片
                const originalImageUrl = handwritingCanvas.toDataURL('image/png');
                text = await recognizeWithCloudAPI(originalImageUrl);
                recognitionMethod = 'cloud';
                console.log('HanziWhisper: 使用云端API识别成功');
            } catch (apiError) {
                // 云端API失败，使用本地识别（使用预处理后的图片以提高准确率）
                console.log('HanziWhisper: 云端API识别失败，切换到本地识别');
                if (resultItems) {
                    resultItems.innerHTML = '<span style="color: #999;">云端识别失败，使用本地引擎...</span>';
                }
                // 本地识别使用预处理后的图片
                const processedCanvas = preprocessImage(handwritingCanvas);
                const processedImageUrl = processedCanvas.toDataURL('image/png');
                text = await recognizeWithLocalOCR(processedImageUrl, resultItems);
                recognitionMethod = 'local';
                console.log('HanziWhisper: 使用本地引擎识别成功');
            }

            // 提取汉字并去重
            const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
            if (chineseChars.length === 0) {
                if (resultItems) {
                    resultItems.innerHTML = `<span style="color: #f44336;">未识别到汉字（${recognitionMethod === 'cloud' ? '云端' : '本地'}识别）。<br>提示：请写大一些、清晰一些，或点击下方手动输入</span>`;
                }
                // 显示手动输入按钮
                showManualInputOption();
                return;
            }
            const uniqueChars = [...new Set(chineseChars)].slice(0, 15);
            displayRecognitionResults(uniqueChars);
            
            // 在控制台显示识别方式
            console.log(`HanziWhisper: 识别完成（${recognitionMethod === 'cloud' ? '云端API' : '本地引擎'}），识别到 ${uniqueChars.length} 个汉字:`, uniqueChars.join(''));
        } catch (e) {
            console.error('HanziWhisper: 手写识别失败', e);
            if (resultItems) {
                resultItems.innerHTML = '<span style="color: #f44336;">识别出错：' + (e.message || e) + '<br>请尝试重新书写或使用手动输入</span>';
            }
            // 识别失败时也显示手动输入选项
            setTimeout(() => {
                showManualInputOption();
            }, 2000);
        }
    }

    // 显示手动输入选项
    function showManualInputOption() {
        if (!handwritingShadowRoot) return;

        const resultItems = handwritingShadowRoot.querySelector('#hw-handwriting-result-items');
        if (!resultItems) return;

        resultItems.innerHTML = `
            <div style="margin: 10px 0;">
                <input type="text" id="hw-manual-input" placeholder="请手动输入汉字"
                    style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 18px; font-family: inherit;"
                    maxlength="1">
                <button id="hw-manual-confirm" style="margin-top: 8px; padding: 8px 16px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                    确认输入
                </button>
            </div>
        `;

        const manualInput = handwritingShadowRoot.querySelector('#hw-manual-input');
        const manualConfirm = handwritingShadowRoot.querySelector('#hw-manual-confirm');

        if (manualConfirm) {
            manualConfirm.addEventListener('click', () => {
                const char = manualInput.value.trim();
                if (char && isChinese(char)) {
                    displayRecognitionResults([char]);
                } else {
                    alert('请输入有效的汉字');
                }
            });
        }

        if (manualInput) {
            manualInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    manualConfirm.click();
                }
            });
            manualInput.focus();
        }
    }

    // 显示识别结果
    function displayRecognitionResults(results) {
        if (!handwritingShadowRoot) return;

        const resultItems = handwritingShadowRoot.querySelector('#hw-handwriting-result-items');
        const insertBtn = handwritingShadowRoot.querySelector('#hw-handwriting-insert');
        
        if (!resultItems) return;

        // 取前10个结果
        const topResults = results.slice(0, 10);
        resultItems.innerHTML = topResults.map((char, index) =>
            `<span class="hw-handwriting-result-item" data-char="${char}" data-index="${index}">${char}</span>`
        ).join('');

        // 绑定结果项点击事件 - 点击后显示该汉字的详细信息
        const items = resultItems.querySelectorAll('.hw-handwriting-result-item');
        items.forEach(item => {
            item.addEventListener('click', async () => {
                items.forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                
                const char = item.getAttribute('data-char');
                // 直接显示汉字信息弹窗
                if (char) {
                    const info = await getHanziInfo(char);
                    if (info) {
                        // 关闭手写窗口
                        // closeHandwriting();
                        // 显示汉字信息
                        showPopup(window.innerWidth / 2, window.innerHeight / 2, info, char);
                    }
                }
            });
        });

        // 自动选择第一个结果
        if (items.length > 0) {
            items[0].classList.add('selected');
        }
    }

    // 在画布上绘制辅助网格线
    function drawGuideLines() {
        if (!handwritingCanvas || !handwritingContext) return;
        
        const ctx = handwritingContext;
        const width = handwritingCanvas.width;
        const height = handwritingCanvas.height;
        
        ctx.save();
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        
        // 绘制中心十字线
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        
        // 绘制九宫格
        ctx.beginPath();
        ctx.moveTo(width / 3, 0);
        ctx.lineTo(width / 3, height);
        ctx.moveTo(width * 2 / 3, 0);
        ctx.lineTo(width * 2 / 3, height);
        ctx.moveTo(0, height / 3);
        ctx.lineTo(width, height / 3);
        ctx.moveTo(0, height * 2 / 3);
        ctx.lineTo(width, height * 2 / 3);
        ctx.stroke();
        
        ctx.restore();
    }


    // 注册菜单命令
    GM_registerMenuCommand('⚙️ 打开配置页面', () => {
        openConfig();
    });

    GM_registerMenuCommand('✍️ 手写识别', () => {
        openHandwriting();
    });

    GM_registerMenuCommand('🔄 切换启用状态', () => {
        config.enabled = !config.enabled;
        saveConfig(config);
        alert(`识字释文已${config.enabled ? '启用' : '禁用'}`);
    });

    console.log('识字释文 HanziWhisper v0.2.0 已加载 - 已优化手写识别');
})();
