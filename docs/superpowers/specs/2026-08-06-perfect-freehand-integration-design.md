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
- `renderLiveIncrement` → `renderLiveTail`：重算平滑点 + 画尾窗（`LIVE_TAIL_WINDOW = 12`）
- `renderPredictedStroke`：改用平滑管线（点数少，开销可忽略）
- 橡皮擦命中测试不变（基于原始点）

## 常量

- `SMOOTH_STREAMLINE = 0.5`
- `LIVE_TAIL_WINDOW = 12`
- 尾窗需覆盖平滑窗口 + 去重余量（上游平滑窗口约 streamline*2，12 点足够）

## 数据流与错误处理

- 追加原始点 → 标记需要重算 → 下帧 `renderLiveTail` 重算平滑点并重画尾窗
- 平滑输出异常（空/NaN）时回退到原始点直画，避免白屏
- `getStrokePoints` 对 1 点/2 点笔迹返回少量点，渲染器需处理（沿用现有 n===1 圆点逻辑）

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

- 非因果平滑导致尾窗大小不合适 → 用 Node 脚本验证稳定性，必要时增大 `LIVE_TAIL_WINDOW`
- perfect-freehand 选项语义（size 与去重半径关系）需读库源码确认 → 实现时核对
