# 识字释文 HanziWhisper

一款Tampermonkey油猴插件，支持快捷键查询汉字信息和手写汉字识别。

## 功能特性

- **快捷查询**：按住 `Shift+Alt+Z` 选中汉字，立即显示详细信息
- **手写识别**：支持手写输入汉字并识别（自适应二值化+去噪，提升识别率）
- **播放读音**：弹窗标题旁点击🔊图标，自动朗读当前汉字（浏览器原生语音）
- **丰富信息**：显示拼音、笔画数、部首、词组、释义、笔画动画
- **个性化配置**：支持自定义快捷键、显示选项、主题切换
- **样式隔离**：使用Shadow DOM防止与页面样式冲突
- **全站适配**：适用于所有中文网站

## 安装方法

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击 [hanziwhisper.user.js](hanziwhisper.user.js) 文件
3. 在Tampermonkey中点击"安装此脚本"

## 使用说明

# 识字释文 HanziWhisper

一款 Tampermonkey 油猴插件，支持快捷键查询汉字信息、手写识别、播放读音，适用于所有中文网站。

## 当前版本

- 版本：v0.2.0
- 更新时间：2026-02-11

## 功能特性

- **快捷查询**：按住 Shift+Alt+Z 选中汉字，弹窗显示拼音、笔画、部首、词组、释义等信息
- **手写识别**：支持画布手写输入汉字，自动识别并显示结果
- **播放读音**：弹窗标题旁点击🔊图标，自动朗读当前汉字（浏览器原生语音）
- **笔画动画**：支持汉字笔画顺序动画展示
- **个性化配置**：可自定义快捷键、显示内容、主题、弹窗宽度、字体大小等
- **样式隔离**：使用 Shadow DOM 防止与页面样式冲突
- **全站适配**：适用于所有中文网站

## 安装方法

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 打开 hanziwhisper.user.js 文件，点击安装
3. 刷新网页即可使用

## 使用说明

### 快捷键查询

1. 在任意网页按住 Shift+Alt+Z
2. 用鼠标选中汉字
3. 松开鼠标，弹窗显示汉字详细信息

### 手写识别

1. 点击 Tampermonkey 图标 → 识字释文 → ✍️ 手写识别
2. 在画布中央手写单个汉字（参考辅助线，写大、清晰）
3. 点击“识别”按钮，查看结果
4. 结果不准确可点击“手动输入”直接输入汉字
5. 不认识的字可参考说明，使用系统手写输入法或输入法 U 模式（如 u+拼音）辅助输入

### 播放读音

- 弹窗标题旁点击🔊图标，自动朗读当前汉字
- 可在配置中设置自动播放读音

### 配置页面

- 点击菜单“⚙️ 打开配置页面”可自定义快捷键、显示内容、主题、弹窗宽度、字体大小、自动播放读音、自动关闭弹窗等

### 菜单命令

- ⚙️ 打开配置页面
- ✍️ 手写识别
- 🔄 切换启用状态

## 技术实现

- [cnchar](https://github.com/theajack/cnchar)：汉字拼音、笔画、部首、释义、简繁转换、笔画动画等
- [Tesseract.js](https://github.com/naptha/tesseract.js)：OCR 手写识别，支持中文，自动检测 API 兼容

### 主要模块

- 配置管理（GM_setValue/GM_getValue）
- 快捷键检测（Shift+Alt+Z）
- 汉字信息获取（拼音、笔画、部首、词组、释义）
- 弹窗显示（Shadow DOM 隔离）
- 手写识别（Canvas 画布、Otsu 二值化、中值滤波、Tesseract OCR）
- 播放读音（SpeechSynthesis）
- 笔画动画（cnchar.draw）

### 性能与体验优化

- 防抖处理，避免频繁触发
- 缓存已查询汉字信息
- 懒加载 cnchar 库功能
- Tesseract Worker 复用
- 手写识别结果支持一键朗读
- 手动输入区提示 U 模式/手写输入法

## 项目结构

```
HanziWhisper/
├── hanziwhisper.user.js    # 主用户脚本文件
├── README.md               # 项目说明文档
├── plans/
│   └── design.md           # 设计文档
├── test/
│   └── test.html           # 测试页面
```

## 浏览器兼容性

- Chrome/Edge (推荐)
- Firefox
- Safari
- Opera

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

- GitHub: [HanziWhisper](https://github.com/bufer/HanziWhisper)
- Email: buferlee@gmail.com

## 更新日志

### v0.1.0 (2026-02-05)

- 初始版本发布
- 实现基础汉字查询功能
- 支持拼音、笔画、部首、词组、释义显示
- 支持自定义配置

### v0.2.0 (2026-02-12)

- 实现可视化配置页面
- 支持手写识别、弹窗播放读音、U模式输入提示
- 优化图像预处理（Otsu 二值化、中值滤波、对比度增强）
- 兼容 Tesseract.js 多版本 API
- 支持配置页面、主题切换、自动关闭弹窗
- 支持笔画动画、丰富汉字信息展示
