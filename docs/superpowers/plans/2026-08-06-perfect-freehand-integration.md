# Perfect-Freehand 集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 集成 perfect-freehand 的平滑+起始去噪，替换手写笔迹的实时渲染管线，消除卡顿与轨迹抽搐，且不改存储格式。

**Architecture:** 新增 `smoothing.ts`（`getStrokePoints` 因果插值平滑，按原始点数缓存）；`renderer.ts` 的宽度计算改为基于平滑点几何距离（去时间戳依赖），绘制改为画平滑点；`InkEngine.ts` 实时增量绘制改用"已画平滑点数"跟踪，提交时全量重画一次让末点精确落在抬笔处。

**Tech Stack:** TypeScript + perfect-freehand ^1.2.3（已 `npm install`，零依赖，MIT）

## Global Constraints

- 存储格式不变：`InkStroke.points` 仍存**原始采样点**（`InkPoint {x,y,t,pressure}`），橡皮擦/撤销/保存/导出路径零改动
- 平滑参数：`SMOOTH_STREAMLINE = 0.5`（插值 `t = 0.15 + (1-0.5)*0.85 = 0.575`）
- 平滑 `size` = `Math.max(1, Math.min(stroke.width * 2, 8))`（仅起始噪声门，小值防起笔死区）
- 线宽速度因子：`vFactor = max(0.7, 1 - distance * 0.025)`（几何距离，无时间戳）
- 每次改动递增版本号（package.json + manifest.json），本次 → **1.1.13**
- 构建：`npm run build`；发布：tag `v1.1.13-beta` + 更新 beta release 资源
- 中文注释/回复；不添加无关注释

---

### Task 1: 平滑模块 + 因果性测试

**Files:**
- Create: `src/ink/smoothing.ts`
- Create: `scripts/test-smoothing.mjs`
- Modify: `package.json`（已由 `npm install perfect-freehand` 更新，版本待 Task 4 升 1.1.13）

**Interfaces:**
- Produces:
  - `export type SmoothPoint = { x: number; y: number; pressure: number; distance: number }`
  - `export const SMOOTH_STREAMLINE = 0.5`
  - `export function getSmoothSize(width: number): number`
  - `export function smoothStroke(stroke: InkStroke, isComplete: boolean): SmoothPoint[]`（WeakMap 缓存，key=stroke，命中条件 rawCount 与 isComplete 均相同）

- [ ] **Step 1: 写失败测试**

`scripts/test-smoothing.mjs`（node 原生 TS 剥离直接 import 源码）:

```js
import { smoothStroke } from "../src/ink/smoothing.ts";

function makeStroke(points) {
  return {
    id: "test",
    tool: "pen",
    color: "#000000",
    width: 3,
    points: points.map(([x, y, p = 0.5], i) => ({ x, y, t: i, pressure: p })),
  };
}

function finiteAll(pts) {
  return pts.every((p) =>
    [p.x, p.y, p.pressure, p.distance].every((v) => Number.isFinite(v))
  );
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// 1. 因果性：追加新点不改变已有平滑点
{
  const stroke = makeStroke([[0, 0], [2, 1], [4, 2], [6, 1]]);
  const before = smoothStroke(stroke, false);
  const beforeLen = before.length;
  stroke.points.push({ x: 9, y: 3, t: 4, pressure: 0.5 });
  const after = smoothStroke(stroke, false);
  assert(after.length >= beforeLen, "追加点后输出应增长");
  for (let i = 0; i < beforeLen; i++) {
    assert(before[i].x === after[i].x && before[i].y === after[i].y,
      `因果性被破坏于索引 ${i}`);
  }
}

// 2. 抖动快写输入：输出全有限、点数不膨胀
{
  const pts = [];
  for (let i = 0; i < 200; i++) {
    pts.push([i * 2, (i % 2 === 0 ? 1 : -1) * (i % 5), 0.5]);
  }
  const stroke = makeStroke(pts);
  const out = smoothStroke(stroke, true);
  assert(finiteAll(out), "输出必须全有限");
  assert(out.length > 0 && out.length <= 200, "输出点数应在 (0, 200]");
}

// 3. 单点笔迹可用
{
  const stroke = makeStroke([[5, 5]]);
  const out = smoothStroke(stroke, false);
  assert(finiteAll(out) && out.length >= 1, "单点笔迹应可用");
}

// 4. 完成态末点精确落在输入末点（isComplete=true）
{
  const stroke = makeStroke([[0, 0], [3, 3], [7, 7]]);
  const out = smoothStroke(stroke, true);
  const last = out[out.length - 1];
  assert(Math.abs(last.x - 7) < 1e-6 && Math.abs(last.y - 7) < 1e-6,
    "isComplete=true 时末点应精确等于输入末点");
}

console.log("OK: all smoothing assertions passed");
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types scripts/test-smoothing.mjs`
Expected: FAIL，`ERR_MODULE_NOT_FOUND`（`../src/ink/smoothing.ts` 不存在）。

- [ ] **Step 3: 写 `src/ink/smoothing.ts`**

```ts
import { getStrokePoints } from "perfect-freehand";
import type { StrokePoint } from "perfect-freehand";
import type { InkStroke } from "./types";

export type SmoothPoint = {
  x: number;
  y: number;
  pressure: number;
  distance: number;
};

export const SMOOTH_STREAMLINE = 0.5;

type SmoothCacheEntry = {
  rawCount: number;
  isComplete: boolean;
  points: SmoothPoint[];
};

const smoothCache = new WeakMap<InkStroke, SmoothCacheEntry>();

export function getSmoothSize(width: number): number {
  return Math.max(1, Math.min(width * 2, 8));
}

export function smoothStroke(stroke: InkStroke, isComplete: boolean): SmoothPoint[] {
  const cached = smoothCache.get(stroke);
  const rawCount = stroke.points.length;
  if (cached && cached.rawCount === rawCount && cached.isComplete === isComplete) {
    return cached.points;
  }

  const input: number[][] = new Array(rawCount);
  for (let i = 0; i < rawCount; i++) {
    const p = stroke.points[i];
    input[i] = [p.x, p.y, p.pressure];
  }

  const strokePoints: StrokePoint[] = getStrokePoints(input, {
    size: getSmoothSize(stroke.width),
    streamline: SMOOTH_STREAMLINE,
    last: isComplete,
  });

  const points: SmoothPoint[] = new Array(strokePoints.length);
  for (let i = 0; i < strokePoints.length; i++) {
    const sp = strokePoints[i];
    points[i] = {
      x: sp.point[0],
      y: sp.point[1],
      pressure: sp.pressure,
      distance: sp.distance,
    };
  }

  smoothCache.set(stroke, { rawCount, isComplete, points });
  return points;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --experimental-strip-types scripts/test-smoothing.mjs`
Expected: PASS，输出 `OK: all smoothing assertions passed`。
（若 Node 原生 TS 剥离报错，退路：把测试改为直接 `require("perfect-freehand")` 并镜像 20 行转换逻辑，验证库的因果性/有限性保证。）

- [ ] **Step 5: 提交**

```bash
git add src/ink/smoothing.ts scripts/test-smoothing.mjs package.json
git commit -m "feat: add causal stroke smoothing via perfect-freehand (getStrokePoints) with tests"
```

---

### Task 2: renderer.ts 改用平滑点渲染

**Files:**
- Modify: `src/ink/renderer.ts`

**Interfaces:**
- Consumes: `smoothStroke(stroke, isComplete): SmoothPoint[]`、`SmoothPoint`（来自 Task 1）
- Produces:
  - `export function drawStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke): void`（全量，isComplete=true）
  - `export function drawStrokeSegment(ctx, stroke, previousPointCount: number): void`（增量，previousPointCount=**已画平滑点数**，isComplete=false）
  - `export function drawStrokeFromSmooth(ctx, stroke, points: SmoothPoint[], startIndex: number): void`（在给定平滑点上从 startIndex 画）
  - `export function drawStrokes(ctx, strokes: InkStroke[]): void`（不变，内部走 drawStroke）
  - 移除 `clearStrokeWidthCache` 与旧的 `strokeWidthCache`/`strokeSpeedCache`（无调用方）

- [ ] **Step 1: 替换 import 与宽度缓存**

在 `src/ink/renderer.ts` 顶部：

```ts
import { InkPoint, InkStroke } from "./types";
import { smoothStroke } from "./smoothing";
import type { SmoothPoint } from "./smoothing";
```

- [ ] **Step 2: 重写 `computeWidths`（平滑点、几何速度、按数组身份缓存）**

用下面整段替换原 `computeWidths`（第 60-113 行附近）与 `clearStrokeWidthCache`（第 115-118 行）：

```ts
// Per-stroke widths cached by the (stable) smoothed point array identity.
const smoothWidthCache = new WeakMap<SmoothPoint[], Float32Array>();

function computeWidths(points: SmoothPoint[], base: number): Float32Array {
  const cached = smoothWidthCache.get(points);
  const n = points.length;
  if (cached && cached.length === n) return cached;

  const widths = new Float32Array(n);
  let prevW = base * 0.5;

  for (let i = 0; i < n; i++) {
    const p = points[i];

    const pr = Math.max(0, Math.min(1.0, p.pressure));
    const pFactor = 0.4 + pr * 0.8;

    // Geometric velocity: gap between consecutive smoothed points.
    // Larger gap = faster = thinner. No timestamps involved, so jittery
    // event clocks cannot pulse the stroke width.
    let vFactor = 1.0;
    if (p.distance > 0) {
      vFactor = Math.max(0.7, 1.0 - p.distance * 0.025);
    }

    let rawW = base * pFactor * vFactor;

    // Immediate start taper to avoid a "blob" at the very first touch.
    if (i < 3) {
      rawW *= 0.6 + 0.4 * (i / 2);
    }

    widths[i] = i === 0 ? rawW : 0.6 * rawW + 0.4 * prevW;
    prevW = widths[i];
  }

  smoothWidthCache.set(points, widths);
  return widths;
}
```

- [ ] **Step 3: 重写 `drawPen` → `drawPenFromSmooth`**

用下面替换原 `drawPen`（第 124-166 行）：

```ts
function drawPenFromSmooth(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  points: SmoothPoint[],
  startIndex: number
): void {
  const n = points.length;
  if (n === 0 || n <= startIndex) return;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.globalAlpha = 1;

  // lineCap = "round" gives gapless, robust ink (a capsule per segment).
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const widths = computeWidths(points, stroke.width);

  if (n === 1) {
    if (startIndex === 0) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, widths[0] / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  for (let i = startIndex; i < n - 1; i++) {
    ctx.beginPath();
    ctx.moveTo(points[i].x, points[i].y);
    ctx.lineTo(points[i + 1].x, points[i + 1].y);
    ctx.lineWidth = (widths[i] + widths[i + 1]) / 2;
    ctx.stroke();
  }

  ctx.restore();
}
```

- [ ] **Step 4: 重写 `drawHighlighter` → `drawHighlighterFromSmooth`**

用下面替换原 `drawHighlighter`（第 180-204 行）：

```ts
function drawHighlighterFromSmooth(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  points: SmoothPoint[],
  startIndex: number
): void {
  const n = points.length;
  if (n === 0 || n <= startIndex) return;

  ctx.save();
  // Multiply blending mimics real highlighters.
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.35;

  ctx.beginPath();
  ctx.moveTo(points[startIndex].x, points[startIndex].y);
  for (let i = startIndex + 1; i < n; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}
```

- [ ] **Step 5: 重写公共绘制入口**

用下面替换原 `drawStroke`/`drawStrokeSegment`/`drawStrokes`（第 206-230 行）：

```ts
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke): void {
  const points = smoothStroke(stroke, true);
  if (stroke.tool === "highlighter") {
    drawHighlighterFromSmooth(ctx, stroke, points, 0);
  } else {
    drawPenFromSmooth(ctx, stroke, points, 0);
  }
}

export function drawStrokeSegment(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  previousPointCount: number
): void {
  const points = smoothStroke(stroke, false);
  const start = Math.max(0, previousPointCount - 1);
  if (stroke.tool === "highlighter") {
    drawHighlighterFromSmooth(ctx, stroke, points, start);
  } else {
    drawPenFromSmooth(ctx, stroke, points, start);
  }
}

export function drawStrokeFromSmooth(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  points: SmoothPoint[],
  startIndex: number
): void {
  if (stroke.tool === "highlighter") {
    drawHighlighterFromSmooth(ctx, stroke, points, startIndex);
  } else {
    drawPenFromSmooth(ctx, stroke, points, startIndex);
  }
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: InkStroke[]): void {
  for (const stroke of strokes) {
    drawStroke(ctx, stroke);
  }
}
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: 无错误（注意 `InkPoint` 在 `distanceSquared`/`distancePointToSegmentSquared` 中仍在使用，import 保留）。

- [ ] **Step 7: 提交**

```bash
git add src/ink/renderer.ts
git commit -m "feat: render smoothed points with geometric velocity widths (no timestamp jitter)"
```

---

### Task 3: InkEngine 实时路径接入平滑管线

**Files:**
- Modify: `src/ink/InkEngine.ts`

**Interfaces:**
- Consumes: `smoothStroke(stroke, isComplete)`（Task 1）、`drawStrokeFromSmooth(ctx, stroke, points, startIndex)`（Task 2）
- Produces: 无新公共 API；`renderLiveIncrement` 的入参 `previousRawCount` 变为"忽略"，改用内部 `activeSmoothCount`

- [ ] **Step 1: 加 import 与字段**

在 `src/ink/InkEngine.ts` 顶部 import 行加：

```ts
import { smoothStroke } from "./smoothing";
```

在 `renderer` import 行（第 1 行）中把 `drawStrokeSegment` 后追加 `drawStrokeFromSmooth`：

```ts
import { distancePointToSegmentSquared, distanceSquared, drawStroke, drawStrokeFromSmooth, drawStrokeSegment, drawStrokes, setupCanvas } from "./renderer";
```

在类字段区（如第 57 行 `private sampleTime = 0;` 附近）加：

```ts
private activeSmoothCount = 0;
```

- [ ] **Step 2: 起笔重置计数**

在两处 `this.activeStroke = stroke;`（约第 483 行 touch 路径、第 637 行 pointer 路径）之后各加一行：

```ts
    this.activeSmoothCount = 0;
```

- [ ] **Step 3: 重写 `renderLiveIncrement`**

替换第 1165-1169 行：

```ts
  private renderLiveIncrement(stroke: InkStroke, _previousRawCount: number): void {
    this.directlyRenderedStrokeIds.add(stroke.id);
    const points = smoothStroke(stroke, false);
    const start = Math.max(0, this.activeSmoothCount - 1);
    if (points.length > start) {
      drawStrokeFromSmooth(this.committedCtx, stroke, points, start);
    }
    this.activeSmoothCount = points.length;
  }
```

（8 处调用点仍传原始点数，参数改为忽略，无需逐个改动。）

- [ ] **Step 4: 提交时全量重画，末点精确落笔**

在 `commitStroke`（第 1132-1148 行）中，删掉增量绘制块：

```ts
    if (!this.directlyRenderedStrokeIds.delete(stroke.id)) {
      drawStroke(this.committedCtx, stroke);
    }
```

替换为（占位，真正位置在 flush 末尾）：

```ts
    this.directlyRenderedStrokeIds.delete(stroke.id);
```

并在 `flushPendingCommits`（第 1396-1401 行）把末尾的 `this.renderLiveNow();` 改为 `this.renderCommittedNow();`：

```ts
    const strokes = this.pendingCommittedStrokes.splice(0);
    for (const stroke of strokes) {
      this.commitStroke(stroke);
    }

    // Full redraw snaps each committed stroke's end to the exact lift point
    // (live drawing smooths the last point with last:false).
    this.renderCommittedNow();
  }
```

- [ ] **Step 5: 检查 `drawStroke` 是否还有其他直接调用需要保持全量语义**

Run: `rg "drawStroke\(" src/ink/InkEngine.ts`
Expected: 仅 `renderCommittedNow` 内使用（第 1188 行 activeStroke、`drawStrokes` 内部）。确认无误后，`renderCommittedNow` 不变（它本来就是全量重画，走 isComplete=true）。

- [ ] **Step 6: 构建**

Run: `npm run build`
Expected: 构建通过，生成 `main.js`。

- [ ] **Step 7: 提交**

```bash
git add src/ink/InkEngine.ts
git commit -m "feat: route live ink through smoothing pipeline with exact end-point snap on commit"
```

---

### Task 4: 版本升级、构建、发布 v1.1.13-beta

**Files:**
- Modify: `package.json`、`manifest.json`

- [ ] **Step 1: 升版本**

`package.json` 与 `manifest.json` 的 `"version"` 均改为 `"1.1.13"`。

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: `tsc -noEmit` 通过、esbuild 输出 `main.js`（大小约 256KB 上下）。

- [ ] **Step 3: 提交并打 tag**

```bash
git add -A
git commit -m "chore: bump to 1.1.13"
git tag v1.1.13-beta
```

- [ ] **Step 4: 更新 beta release（id 365346021）**

1. 取 token：`("protocol=https`nhost=github.com`nusername=XiaoA-Tang`n" | git credential fill 2>$null | Select-String "^password=").ToString().Substring(9)`
2. PATCH release：`tag_name` → `v1.1.13-beta`，`name` → `v1.1.13-beta`，body 更新（含：集成 perfect-freehand 平滑+几何线宽）
3. 若远端已存在同名 tag，先 `git push --delete refs/tags/v1.1.13-beta`，再 push 本地 tag
4. 删除旧 assets（main.js/manifest.json/styles.css），用 `curl.exe -s -X POST -H "Authorization: token $token" --data-binary "@<file>" "https://uploads.github.com/repos/XiaoA-Tang/mobile-ink-annotation/releases/365346021/assets?name=<file>"` 逐个上传新产物
5. 验证：release `tag_name`/`prerelease` 与 assets 大小

- [ ] **Step 5: 交付说明**

告知用户：真机验证 ① 闪退是否消失 ② 卡顿/抽搐改善 ③ 末点落笔位置 ④ 旧标注外观变化；如需调平滑强度改 `SMOOTH_STREAMLINE`（调大=更顺滑/追笔滞后，调小=更跟手/略抖）。

---

## Self-Review

**1. Spec coverage:**
- 平滑模块+缓存 → Task 1 ✓
- 宽度改几何距离、去时间戳 → Task 2 ✓
- 实时增量保留（因果发现）→ Task 3 ✓
- 提交末点精确 → Task 3 Step 4 ✓
- 高亮笔固定宽+单路径 → Task 2 Step 4/5 ✓
- 存储/橡皮擦不变 → Global Constraints ✓
- 版本 1.1.13 + beta 发布 → Task 4 ✓
- 测试（Node 脚本）→ Task 1 ✓

**2. Placeholder scan:** 无 TBD/TODO；每步含完整代码/命令。

**3. Type consistency:**
- `smoothStroke(stroke, isComplete): SmoothPoint[]` — 全计划一致
- `drawStrokeFromSmooth(ctx, stroke, points, startIndex)` — Task 2 定义，Task 3 使用一致
- `activeSmoothCount` 字段名统一
- `drawStrokeSegment` 的 previousPointCount 语义 = 平滑点数，Task 3 传入 activeSmoothCount ✓

**4. 风险备注（计划内已涵盖）：**
- Node 原生 TS 剥离不可用时测试有退路（Task 1 Step 4）
- `renderLiveIncrement` 调用点 8 处参数变占位，不影响行为（Step 3 说明）
- 提交时 `renderCommittedNow` 全量重画一次，成本 O(全部笔画)，每次抬笔一次，可接受
