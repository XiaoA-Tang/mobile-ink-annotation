# Mobile Ink Annotation Basic

Handwritten annotation for Obsidian, built for phones, tablets and styluses.

Write, highlight and mark up your Markdown notes and PDFs with a pen, exactly where the content is — without ever modifying the source file. Ink is stored as separate annotation data, so your notes and PDFs stay byte-for-byte untouched.

**English** · [简体中文](#简体中文)

---

## Highlights

- **Ink on top of Markdown** — your note is rendered as a stable background layer, and handwriting is drawn on an overlay above it. The Markdown source is never rewritten.
- **Ink on top of PDFs** — write and circle directly on PDF pages, with page-aware rendering for long documents.
- **PDF text annotation** — switch to text-selection mode to copy selected text, or add **highlight**, **underline**, **strikethrough** and **note** annotations, each with its own color.
- **Stylus-first input model** — a pen or mouse writes; a finger scrolls and pans the page. No palm-rejection gymnastics needed.
- **Draggable, collapsible toolbar** — move it wherever your hand rests, or collapse it into a single floating button. The position is remembered.
- **Automatic saving** — strokes are written asynchronously shortly after you stop drawing, and flushed when you close the view.
- **Works offline** — no account, no network access, no telemetry.

## Requirements

- Obsidian **1.5.0** or newer
- Desktop and mobile are both supported (iOS / iPadOS / Android / Windows / macOS / Linux)
- A stylus (Apple Pencil, S Pen, MPP/AES pen…) is recommended, but a mouse or trackpad works too

## Installation

### From the Community Plugins browser

1. Open **Settings → Community plugins** and turn off Restricted mode.
2. Click **Browse**, search for *Mobile Ink Annotation*, and install it.
3. Enable the plugin.

### Manual installation

Copy `manifest.json`, `main.js` and `styles.css` into:

```text
<your vault>/.obsidian/plugins/mobile-ink-annotation-basic/
```

Then reload Obsidian and enable the plugin under **Settings → Community plugins**.

### Building from source

```bash
npm install
npm run build
```

## Getting started

1. Open a Markdown note or a PDF file.
2. Start the annotation view in either way:
   - click the **pencil** icon in the left ribbon, or
   - run the command **Open mobile ink annotation for current note** from the command palette.
3. Pick the pen or the highlighter in the toolbar and write.
4. Your ink is saved automatically. To save explicitly, open the tab's **More options** menu and choose *Save annotation*; choose *Exit annotation* to leave the view.

Only Markdown (`.md`) and PDF (`.pdf`) files can be annotated. The command is hidden for any other file type.

## The toolbar

The floating toolbar can be dragged by its handle and collapsed with the chevron button.

| Tool | What it does |
| --- | --- |
| **Pen** | Regular writing tool. |
| **Highlighter** | Semi-transparent marker for emphasis. |
| **Eraser** | Erases strokes. Its panel also contains *Clear all annotations*. |
| **Select text** | PDF only — enters text-selection mode for copying and text annotation. |
| **Stroke width** | Slider plus numeric input, from 1 to 36 px in 0.5 steps. |
| **Color** | Six presets (black, blue, green, yellow, red, purple) plus a custom color picker. |

**Undo**, **Redo**, **Zoom out**, **Reset zoom** and **Zoom in** live in the view's title bar so they stay reachable while the toolbar is collapsed.

## Annotating PDFs

Open a PDF and start the annotation view. You can write on the page straight away with the pen or highlighter.

To work with the PDF's own text, tap **Select text** and drag across a passage. A menu appears with:

- **Copy** — copy the selected text to the clipboard.
- **Highlight** / **Underline** / **Strikethrough** — each button applies its current color; tap the chevron next to it to pick a different one.
- **Note** — attach a written comment to the selected text.

Tap an existing text annotation to reopen it: you can copy its text, edit the attached note, change its color, or delete it.

To make Obsidian open PDFs in the annotation view automatically, enable the setting described below.

## Settings

| Setting | Description |
| --- | --- |
| **Open PDFs in the annotation view by default** | When enabled, opening a PDF switches straight to this plugin's annotation view, showing any saved ink, highlights, underlines and notes. When disabled, PDFs open in Obsidian's native PDF viewer. Off by default. |

## Where your data lives

Annotations are stored **outside** your notes, in the plugin's own folder:

```text
<your vault>/.obsidian/plugins/mobile-ink-annotation-basic/annotations/
```

Each annotated source file gets one `.ink.json` file there, named after the source file plus a short hash of its path. The file holds the strokes, the layout snapshot used to position them, and any PDF text annotations.

Because these files live inside your vault, they sync and back up along with everything else — but if you move your vault or reinstall the plugin manually, remember to carry the `annotations/` folder with you.

## Known limitations

- Markdown ink is anchored to a snapshot of the rendered layout. If you substantially rewrite the note afterwards, existing strokes are **not** re-flowed and may need to be adjusted or redrawn.
- Handwriting is never written back into the Markdown source; it only exists as separate annotation data.
- Uninstalling the plugin, or deleting the `annotations/` folder, removes the ink. Back up your vault before large-scale changes.
- The in-app interface is currently labelled in Simplified Chinese.

## Feedback and support

- **Email** — [jepicaju862@gmail.com](mailto:jepicaju862@gmail.com). Best for bug reports; please include your Obsidian version, platform (iOS / Android / desktop), and whether the note being annotated is Markdown or PDF.
- **QQ group** — `1094620986` — for usage questions, tips and release announcements.

## Pro version

A separate commercial build, **Mobile Ink Annotation Pro**, adds standalone handwritten notes, an annotation center for searching and organising annotations across Markdown, PDF and handwritten pages, licensed activation with device management, and private updates. Basic and Pro install side by side as independent plugins, so a Basic update never overwrites a Pro build.

Details, licensing options and downloads: **<https://peyote.info/plugins/mobile-ink-annotation-pro/>**

This Basic edition is free and fully usable on its own; Pro is entirely optional.

## License

Licensed under the **GNU General Public License, version 3 or later (GPL-3.0-or-later)**. The full text is in [LICENSE](LICENSE).

This applies to the Basic edition in this repository. Mobile Ink Annotation Pro is a separate, independently built commercial product and is not covered by this license.

---

<a id="简体中文"></a>

# Mobile Ink Annotation Basic（简体中文）

面向手机、平板与触控笔的 Obsidian 原笔迹批注插件。

在 Markdown 笔记和 PDF 上直接手写、圈画、标重点，笔迹叠加在内容之上，**不会改写源文件**。所有手写内容都作为独立的批注数据保存，笔记和 PDF 原文保持不变。

[English](#mobile-ink-annotation-basic) · **简体中文**

## 核心特性

- **Markdown 手写批注** —— 先把当前笔记渲染成稳定背景层，再在上层叠加手写笔迹；Markdown 正文不会被改写。
- **PDF 手写批注** —— 直接在 PDF 页面上书写和圈画，按页渲染，长文档也能流畅使用。
- **PDF 文本批注** —— 切换到文本选择模式后，可复制选中文本，或添加**高亮**、**下划线**、**删除线**和**批注**，每种类型都有独立配色。
- **触控笔优先** —— 触控笔或鼠标用于书写，手指用于滚动和拖动画布，不必反复关闭手掌误触。
- **可拖动、可收起的工具栏** —— 拖到顺手的位置，或收起成一个悬浮按钮；位置会被记住。
- **自动保存** —— 停笔后短暂延迟即异步写入，关闭视图时强制落盘。
- **完全离线** —— 无需账号，不联网，不收集任何使用数据。

## 环境要求

- Obsidian **1.5.0** 或更高版本
- 桌面端与移动端均支持（iOS / iPadOS / Android / Windows / macOS / Linux）
- 推荐搭配触控笔（Apple Pencil、S Pen、MPP/AES 笔等），使用鼠标或触控板同样可用

## 安装方式

### 从社区插件市场安装

1. 打开 **设置 → 第三方插件**，关闭安全模式。
2. 点击 **浏览**，搜索 *Mobile Ink Annotation* 并安装。
3. 启用插件。

### 手动安装

将 `manifest.json`、`main.js` 和 `styles.css` 复制到：

```text
<你的库>/.obsidian/plugins/mobile-ink-annotation-basic/
```

然后重新加载 Obsidian，并在 **设置 → 第三方插件** 中启用。

### 从源码构建

```bash
npm install
npm run build
```

## 快速开始

1. 打开一个 Markdown 笔记或 PDF 文件。
2. 用以下任一方式进入批注视图：
   - 点击左侧边栏的**铅笔**图标；
   - 或在命令面板中运行 **Open mobile ink annotation for current note**。
3. 在工具栏中选择画笔或记号笔，开始书写。
4. 笔迹会自动保存。如需手动保存，打开标签页的**更多选项**菜单并选择*保存标注*；选择*退出标注*可离开批注视图。

目前仅支持 Markdown（`.md`）和 PDF（`.pdf`）文件，其他文件类型下该命令不会出现。

## 工具栏说明

悬浮工具栏可以通过拖动手柄移动，也可以用折叠按钮收起。

| 工具 | 说明 |
| --- | --- |
| **画笔** | 普通书写工具。 |
| **记号笔** | 半透明标记工具，适合标重点。 |
| **橡皮擦** | 擦除笔迹；其面板中还提供*清除全部标注*。 |
| **选择文本** | 仅 PDF 可用，进入文本选择模式，用于复制和文本批注。 |
| **线条粗细** | 滑块加数值输入，范围 1–36 px，步进 0.5。 |
| **调色盘** | 六种预设颜色（黑、蓝、绿、黄、红、紫）以及自定义取色。 |

**撤销**、**重做**、**缩小**、**重置缩放**、**放大**位于视图标题栏，工具栏收起时依然可用。

## PDF 批注用法

打开 PDF 并进入批注视图后，即可用画笔或记号笔直接书写。

若要处理 PDF 自身的文本，点击**选择文本**并拖选一段内容，会弹出操作菜单：

- **复制** —— 将选中文本复制到剪贴板。
- **高亮** / **下划线** / **删除线** —— 按钮直接应用当前颜色，点击旁边的箭头可切换配色。
- **批注** —— 为选中文本添加文字注释。

点击已有的文本批注可再次唤出菜单：复制原文、编辑附注、修改颜色或删除。

若希望 PDF 默认以批注视图打开，可开启下方设置项。

## 设置项

| 设置 | 说明 |
| --- | --- |
| **PDF 默认使用标注视图打开** | 开启后，点击 PDF 会自动切换到本插件的批注视图，并显示已保存的手写标注、高亮、下划线和批注。关闭后 PDF 继续使用 Obsidian 原生阅读器。默认关闭。 |

## 数据保存位置

批注数据保存在插件自己的目录中，**不写入笔记内部**：

```text
<你的库>/.obsidian/plugins/mobile-ink-annotation-basic/annotations/
```

每个被批注的源文件对应一个 `.ink.json` 文件，文件名由源文件名加上路径哈希构成，其中保存笔迹、用于定位笔迹的版面快照，以及 PDF 文本批注。

这些文件位于库内，因此可以随库一起同步和备份；但如果你迁移库或手动重装插件，请记得一并保留 `annotations/` 目录。

## 已知限制

- Markdown 笔迹锚定在渲染版面的快照上。如果之后大幅改写笔记正文，已有笔迹**不会**自动重排，可能需要手动调整或重新书写。
- 手写内容不会写回 Markdown 正文，仅以独立批注数据存在。
- 卸载插件或删除 `annotations/` 目录会一并丢失笔迹，大规模操作前请先备份库。
- 插件内界面文案目前为简体中文。

## 反馈与支持

- **邮箱** —— [jepicaju862@gmail.com](mailto:jepicaju862@gmail.com)。提交问题时，请附上 Obsidian 版本、所用平台（iOS / Android / 桌面端），以及被批注的是 Markdown 还是 PDF。
- **QQ 群** —— `1094620986` —— 用于使用交流、技巧分享和版本更新通知。

## Pro 版本

**Mobile Ink Annotation Pro** 是独立的商业构建版本，在基础版之上提供独立手写笔记、可跨 Markdown / PDF / 手写页集中搜索整理批注的批注中心、激活码与设备许可管理，以及私有更新渠道。Basic 与 Pro 作为两个独立插件分开安装，基础版更新不会覆盖商业版。

功能介绍、授权方案与下载：**<https://peyote.info/plugins/mobile-ink-annotation-pro/>**

基础版本身完全免费且功能完整可用，是否升级 Pro 完全可选。

## 许可协议

本项目采用 **GNU 通用公共许可证第 3 版或更高版本（GPL-3.0-or-later）** 授权，完整条款见 [LICENSE](LICENSE)。

该协议适用于本仓库中的基础版。Mobile Ink Annotation Pro 为独立构建的商业产品，不在本协议覆盖范围内。
