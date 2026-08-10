import {
  mdLoadScale,
  reprojectStrokesToWidth,
  convertStrokesFromAnnotation,
  toViewportStroke,
  fromViewportStroke,
  toViewportStrokeWithScroll,
  fromViewportStrokeWithScroll
} from "../src/overlay/markdown/markdownGeometry.ts";

let failed = 0;
function assert(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log("  ok:", name);
  } else {
    failed++;
    console.error("  FAIL:", name, "expected", e, "got", a);
  }
}

const mk = (id, x, y, w = 2) => ({ id, tool: "pen", color: "#111111", width: w, points: [{ x, y, t: 0, pressure: 0.5 }] });

// 1. mdLoadScale: 新/旧宽度比例；pageWidth<=0 或 NaN 回退 scale=1
assert("scale normal", mdLoadScale({ pageWidth: 800 }, 1000), 1.25);
assert("scale zero width fallback", mdLoadScale({ pageWidth: 0 }, 1000), 1);
assert("scale NaN width fallback", mdLoadScale({ pageWidth: NaN }, 1000), 1);
assert("scale equal", mdLoadScale({ pageWidth: 500 }, 500), 1);

// 2. reprojectStrokesToWidth: x 与 y 均乘 ratio，宽度不变
const s1 = mk("s1", 100, 200, 2);
const r1 = reprojectStrokesToWidth([s1], 800, 1000)[0];
assert("reproject x", Math.round(r1.points[0].x * 100) / 100, 125);
assert("reproject y", Math.round(r1.points[0].y * 100) / 100, 250);
assert("reproject width", r1.width, 2);

// 2b. 与 mdLoadScale 等价路径：convertStrokesFromAnnotation(strokes, mdLoadScale(...))
const c1 = convertStrokesFromAnnotation([s1], mdLoadScale({ pageWidth: 800 }, 1000))[0];
assert("convert-from-annotation x", Math.round(c1.points[0].x * 100) / 100, 125);
assert("convert-from-annotation y", Math.round(c1.points[0].y * 100) / 100, 250);

// 3. toViewport/fromViewport 往返一致（滚动偏移）
const v = toViewportStroke(s1, 300);
assert("toViewport y", v.points[0].y, -100);
assert("toViewport x unchanged", v.points[0].x, 100);
const back = fromViewportStroke(v, 300);
assert("fromViewport y", back.points[0].y, 200);

// 3b. 横向滚动变体
const v2 = toViewportStrokeWithScroll(s1, 300, 40);
assert("toViewport scrollLeft x", v2.points[0].x, 60);
assert("toViewport scrollLeft y", v2.points[0].y, -100);
const back2 = fromViewportStrokeWithScroll(v2, 300, 40);
assert("fromViewport scrollLeft roundtrip x", back2.points[0].x, 100);

// 4. 边界：宽度为 0 时重投影不产生 NaN
const r2 = reprojectStrokesToWidth([s1], 0, 1000)[0];
assert("reproject zero oldWidth finite", Number.isFinite(r2.points[0].x), true);

if (failed > 0) {
  console.error(`FAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log("OK: all markdown-overlay-geometry assertions passed");