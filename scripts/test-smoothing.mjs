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
