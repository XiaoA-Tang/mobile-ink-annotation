// Regression test for the ink canvas backing-store budget.
//
// Root cause this guards against: canvas backing grows as pageW*pageH*dpr^2
// with dpr = deviceDpr * displayScale (displayScale tracks zoom up to 4).
// Under the old mobile cap (72M px) a single PDF page's committed+live
// canvases reached ~550MB at zoom 4, OOM-ing the WebView renderer on tablets
// (annotations vanish, then the app freezes and crashes).
//
// Assertions (realistic device profiles only):
//   1. Bounded: at max zoom (displayScale 4) the backing stays within budget.
//      (a 0.1% tolerance absorbs the ceil() rounding overshoot in setupCanvas)
//   2. Crisp at zoom 1: on common tablet devicePixelRatios (<=2.5) the backing
//      is never capped below the native device resolution at zoom 1.
//   3. No NaN/Infinity in the resulting dpr / backing sizes.

import { resolveInkCanvasBudget } from "../src/ink/inkBudget.ts";

function backingFor(pageW, pageH, deviceDpr, displayScale, budget) {
  const maxDpr = 3;
  const baseDpr = Math.min(deviceDpr, maxDpr);
  const targetDpr = baseDpr * displayScale;
  const maxByPixels = Math.sqrt(budget / Math.max(1, pageW * pageH));
  const dpr = Math.max(1, Math.min(targetDpr, maxByPixels));
  const bw = Math.max(1, Math.ceil(pageW * dpr));
  const bh = Math.max(1, Math.ceil(pageH * dpr));
  return { dpr, pixels: bw * bh, mb: (bw * bh * 4) / 1048576 };
}

// Mobile page widths are capped at 960 (PDF target width & markdown max width).
const MOBILE_PAGES = [
  { w: 960, h: 1357 }, // A4 PDF page
  { w: 960, h: 2000 } // tall markdown note
];
const MOBILE_DPRS = [1.5, 2, 2.5];

const DESKTOP_PAGES = [
  { w: 1600, h: 2264 } // max markdown page
];
const DESKTOP_DPRS = [1, 2];

const failures = [];
let checks = 0;

function check(name, cond, detail) {
  checks++;
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    failures.push(`${name}: ${detail}`);
    console.log(`  FAIL: ${name}: ${detail}`);
  }
}

function runProfile(mobile) {
  const budget = resolveInkCanvasBudget(mobile);
  const label = mobile ? "mobile (16M budget)" : "desktop (48M budget)";
  const pages = mobile ? MOBILE_PAGES : DESKTOP_PAGES;
  const dprs = mobile ? MOBILE_DPRS : DESKTOP_DPRS;
  console.log(`\n== ${label} ==`);

  for (const dpr of dprs) {
    for (const page of pages) {
      const name = `dpr=${dpr} page=${page.w}x${page.h}`;
      const atMax = backingFor(page.w, page.h, dpr, 4, budget);
      const atOne = backingFor(page.w, page.h, dpr, 1, budget);

      check(
        `${name} @zoom4 within budget`,
        atMax.pixels <= budget * 1.001,
        `backing ${(atMax.pixels / 1e6).toFixed(2)}Mpx > budget ${(budget / 1e6).toFixed(0)}Mpx (${atMax.mb.toFixed(0)}MB/canvas)`
      );

      check(
        `${name} @zoom1 native-crisp`,
        atOne.dpr >= dpr - 1e-9,
        `dpr ${atOne.dpr.toFixed(2)} < deviceDpr ${dpr}`
      );

      check(
        `${name} finite`,
        [atMax, atOne].every((r) => Number.isFinite(r.dpr) && Number.isFinite(r.pixels) && r.pixels > 0),
        `non-finite sizes: ${JSON.stringify([atMax, atOne])}`
      );
    }
  }
}

runProfile(true);
runProfile(false);

console.log("\n----------------------------------------");
console.log(`checked ${checks} assertions`);
if (failures.length > 0) {
  console.error(`FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("OK: all canvas budget assertions passed");
