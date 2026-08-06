# Perfect-Freehand 集成设计

日期：2026-08-06
状态：已批准（用户：可以）

## 背景与目标

手写笔迹在华为平板上存在两类问题：
1. **卡顿**：长笔画 O(n²) 线宽重算 + 逐段绘制开销大
2. **轨迹抽搐**：依赖事件时间戳计算速度（华为笔时间戳抖动 → 线宽脉动），预测段在大曲率/噪声下前后跳

目标：引入成熟开源库 perfect-freehand（MIT、零依赖、tldraw/Excalidraw 同款算法），在不改变存储格式、橡皮擦、撤销/保存行为的前提下，解决卡顿与抽搐。

### 关键决策
- 采用 **平滑点 + 现有圆帽分段渲染**（用户拍板），而非原生轮廓多边形填充：
  - 保留无缝、无锐角沙漏（upstream #112）、无小字号气泡（#88）特性
  - 中文锐角笔画不受 perfect-freehand 已知 issue 影响
  - 复用已调好的线宽逻辑，改动最小、风险最低
- 存储仍存**原始采样点**，向后兼容既有标注文件

### 实现期发现（重要）
- 核对 `perfect-freehand` 源码（`getStrokePoints.ts`）确认：输出点 = `lerp(上一个输出点, 当前输入点, t)`，是**因果递归插值**——输出点 i 只依赖输入点 0..i。新增输入点不会改变已产生的输出点。
- 因此**实时增量绘制可直接保留**（无需尾窗重画），`renderLiveIncrement`/`drawStrokeSegment(previousPointCount)` 语义不变，只需把 previousPointCount 从"原始点数"改为"平滑点数"。
- `size` 选项仅用于**起始段噪声过滤**（runningLength < size 时跳过中间点），非整体去重；取小值（≈笔宽）避免起笔"死区"。
- `streamline` 控制插值 t（`t = 0.15 + (1-streamline)*0.85`）；streamline=0.5 → t≈0.575（中等平滑）。
- `simulatePressure` 对 `getStrokePoints` 无效（未使用），压力直接透传真实值。

## 架构

```
原始 InkPoint[] (存储)  ──getStrokePoints──▶  SmoothPoint[] (渲染)
   ↑ 追加点                  去重+平滑           ↓
   InkEngine ──append── InkStroke          drawPen/drawHighlighter
   │                                          │
   └── live: drawStrokeTail (尾窗重画)         └── widths: 因果 EMA (压力+几何距离)
```

### 组件

**1. 新增 `src/ink/smoothing.ts`**
- `smoothStroke(stroke): SmoothPoint[]`
  - 输入转 `[x, y, pressure]`，调 `getStrokePoints(input, { size, streamline: 0.5, simulatePressure: false })`
  - 输出 `SmoothPoint { x, y, distance }`（distance 用于速度因子）
  - `size` 由 `stroke.width` 推导（去重半径）
- 缓存：WeakMap<InkStroke, { rawCount, points }>，原始点数未变则复用

**2. `src/ink/renderer.ts`**
- `computeWidths(smoothPoints, base)`：改用平滑点
  - 删除时间戳 EMA 速度逻辑
  - `pFactor = 0.4 + pressure * 0.8`
  - `vFactor = max(0.8, 1 - distance/size * 0.02)`（几何速度，无时间戳抖动）
  - 保留因果前向 EMA（0.6/0.4）平滑线宽
- `drawPen` / `drawHighlighter`：画平滑点
  - 高亮笔保持固定宽 + multiply 单路径
- 新增 `drawStrokeTail(ctx, stroke, fromIndex)`：从平滑点索引开始重画（圆帽不透明，覆盖重画正确）

**3. `src/ink/InkEngine.ts`**
- `renderLiveIncrement` 的 `previousPointCount` 改为"已画平滑点数"（`activeSmoothCount`），起笔重置为 0
- `renderPredictedStroke`：改为在已清空的 live canvas 上全量重画平滑后的预测笔迹
- 提交时调 `renderCommittedNow()` 全量重画一次（用 `last: true` 让末点精确落在抬笔处）
- 橡皮擦命中测试不变（基于原始点）

## 常量

- `SMOOTH_STREAMLINE = 0.5`（t ≈ 0.575）
- 平滑 `size` = `Math.max(1, Math.min(stroke.width * 2, 8))`（起始噪声门，小值防起笔死区）
- 因平滑因果，无需尾窗常量

## 数据流与错误处理

- 追加原始点 → 下帧 `smoothStroke`（按原始点数缓存）重算平滑点 → `drawStrokeSegment` 只画新平滑段
- 平滑输出异常（空/NaN）时回退到原始点直画，避免白屏
- `getStrokePoints` 对 1 点/2 点笔迹会内部补点，渲染器沿用现有逻辑

## 测试

Node 脚本验证（`scripts/` 或临时脚本）：
1. 抖动合成点输入 → 去重后点数显著减少
2. 输出无 NaN/Infinity
3. 追加新点后，窗口之前的平滑点不变化（稳定性）
4. 线宽序列有限且为正

## 兼容性

- 存储格式 `InkStroke.points`（原始点）不变 → 旧标注可读
- 旧标注经平滑管线渲染，外观基本一致（仅更平滑）
- 橡皮擦、撤销、保存、导出路径均不涉及存储变更

## 版本与发布

- 版本升 **1.1.13**（package.json + manifest.json）
- `npm run build` 通过后提交，tag `v1.1.13-beta`，更新 beta release 资源

## 风险

- 平滑强度（streamline）需真机调优：过大则笔画追笔滞后，过小则抖动复现 → 先用 0.5，真机反馈后再调
- perfect-freehand 选项语义已核对源码（size=起始噪声门、streamline 控制插值 t、last 控制末点精确）
