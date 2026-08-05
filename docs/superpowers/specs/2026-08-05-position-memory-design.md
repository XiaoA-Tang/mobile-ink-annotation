# 阅读位置记忆功能 设计文档

日期：2026-08-05
项目：Mobile Ink Annotation Basic（二次开发）

## 背景与目标

用户对 Mobile Ink Annotation 插件进行个性化二次开发。本次开发聚焦一个需求：

**记录批注视图中的阅读位置（PDF 页码 / Markdown 滚动位置），退出后重新打开同一文件时恢复该位置，并且长期持久化——重启 Obsidian 或切换设备后依然有效。**

关于"打开 PDF 自动进入批注视图"的需求：该功能已由 1.0.5 版本内置（设置项"PDF 默认使用标注视图打开"，见 `src/main.ts:170`），无需二次开发。

## 方案选型

采用 **方案 A：插件设置数据持久化**。

在插件 `data.json` 中维护一张"位置记忆表"，键为文件路径，值为该文件的阅读位置。

选型理由：
- 数据存放在库内，随 Obsidian 同步走，天然满足跨端需求；
- 与现有"工具栏位置记忆"（`restoreToolbarPosition`）的实现模式一致；
- 不依赖视图生命周期 state（`getState/setState` 只在视图仍挂在工作区时有效，关闭标签页即丢失，无法满足"重启可恢复"）。

## 数据模型

在 `MobileInkAnnotationSettings`（`src/main.ts:6`）中新增字段：

```ts
type SavedFilePosition =
  | { kind: "pdf"; page: number }
  | { kind: "markdown"; scrollTop: number };

type MobileInkAnnotationSettings = {
  openPdfWithAnnotationByDefault: boolean;
  savedPositions: Record<string, SavedFilePosition>; // 键 = 文件路径
};
```

默认值（`DEFAULT_SETTINGS`）中 `savedPositions: {}`。

## 数据流

### 记录（保存）

| 触发点 | PDF | Markdown |
|---|---|---|
| 滚动（防抖约 800ms） | 记录当前页码 | 记录 `scrollEl.scrollTop` |
| 视图 `onClose()` | 强制落盘一次 | 强制落盘一次 |

读取来源：
- PDF：`this.pdfPageNavigator.getCurrentPageNumber()`
- Markdown：`this.scrollEl.scrollTop`

写入逻辑：
```
settings.savedPositions[filePath] = { kind, page | scrollTop }
await plugin.saveSettings()
```

### 恢复（读取）

`render()` 渲染完成后（`AnnotationView.ts:527` 流程末尾），查 `settings.savedPositions[filePath]`：
- PDF：`this.goToPdfPage(page)`（内部已钳制页码范围，`AnnotationView.ts:3550`）
- Markdown：`this.scrollEl.scrollTo(0, scrollTop)`

## 涉及改动点

| 文件 | 改动 |
|---|---|
| `src/main.ts` | 扩展 settings 类型与默认值，新增 `savedPositions` 字段 |
| `src/views/AnnotationView.ts` | 在 `onAnnotationScroll`（`AnnotationView.ts:2207`）中加入防抖记录逻辑；在 `onClose`（`AnnotationView.ts:479`）中加入强制落盘；在 `render()` 完成后加入恢复逻辑 |

## 错误处理与边界

- **文件重命名/移动**：路径作键，重命名后旧位置缺失，退化为从第 1 页 / 顶部开始，不报错。
- **PDF 页码越界**：`goToPdfPage` 内部 `Math.min/max` 钳制，安全。
- **防抖写入失败**：静默忽略，不影响批注主流程。
- **data.json 损坏**：`loadData()` 与默认值合并时天然兜底。
- **清空时机**：删除文件后保留脏数据无害；暂不实现自动清理（YAGNI）。

## 测试

- 打开 PDF → 翻到第 5 页 → 关闭批注视图 → 重开同一 PDF，验证恢复到第 5 页。
- 打开 Markdown → 滚动到某处 → 关闭 → 重开，验证 scrollTop 恢复。
- 完全重启 Obsidian 后重开，位置仍恢复（验证持久化）。
- 打开一个从未批注过的文件，位置从顶部/第 1 页开始。

## 非目标

- 不修改 PDF 文件本身；不导出笔迹到 PDF。
- 不做"原生 PDF 阅读器上叠加笔迹"。
- 不改动已有批注保存逻辑。
