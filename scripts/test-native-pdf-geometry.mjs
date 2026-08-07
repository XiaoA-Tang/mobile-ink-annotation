import { computePageSizeFromPdf, buildUniformPageLayout, screenToLogical, logicalToScreen } from "../src/pdf/nativePdfGeometry.ts";
import { PDF_BACKGROUND_PAGE_GAP } from "../src/views/annotationConstants.ts";

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

const fakeViewport = { width: 612, height: 792 };
const fakePdf = {
  numPages: 3,
  async getPage(n) {
    return { getViewport: (o) => (o.scale === 1 ? fakeViewport : { width: fakeViewport.width * o.scale, height: fakeViewport.height * o.scale }) };
  }
};

// 1. computePageSizeFromPdf: scroll 宽度 984 → available=960 → target=960, scale=960/612≈1.5686
const size = await computePageSizeFromPdf(fakePdf, 984);
assert("page width from pdf", size.width, 960);
assert("page height from pdf", size.height, Math.ceil(792 * (960 / 612)));

// 2. uniform layout: offsetY 含 gap，页内高度一致
const layout = buildUniformPageLayout(960, 1242, 3);
assert("page count", layout.pages.length, 3);
assert("page1 offsetY", layout.pages[0].offsetY, 0);
assert("page2 offsetY", layout.pages[1].offsetY, 1242 + PDF_BACKGROUND_PAGE_GAP);
assert("page3 offsetY", layout.pages[2].offsetY, (1242 + PDF_BACKGROUND_PAGE_GAP) * 2);

// 3. screenToLogical / logicalToScreen 往返一致（page2，含 gap 偏移）
const rect = { left: 10, top: 20, width: 480, height: 621 };
const logical = screenToLogical(layout.pages[1], rect, 10 + 240, 20 + 310.5);
assert("logical x", logical.x, 480);
assert("logical y", logical.y, 1242 + PDF_BACKGROUND_PAGE_GAP + 621);
const screen = logicalToScreen(layout.pages[1], rect, logical.x, logical.y);
assert("roundtrip x", Math.round(screen.x), 250);
assert("roundtrip y", Math.abs(screen.y - 330.5) < 0.001, true);

// 4. 非零保护：width/height 为 0 时返回原坐标不 NaN
const zero = screenToLogical(layout.pages[0], { left: 0, top: 0, width: 0, height: 0 }, 5, 5);
assert("zero rect finite", [zero.x, zero.y].every(Number.isFinite), true);

if (failed > 0) {
  console.error(`FAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log("OK: all native-pdf-geometry assertions passed");
