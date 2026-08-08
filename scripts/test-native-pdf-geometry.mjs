import { computePageSizeFromPdf, buildUniformPageLayout, screenToLogical, logicalToScreen } from "../src/pdf/nativePdfGeometry.ts";
import { assignStrokeToPage, splitStrokesByPage, convertStrokesToScreen, convertStrokesToLogical } from "../src/pdf/overlayInkData.ts";
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

// 5. overlay ink data layer: assign / split / screen-logical conversion
const layout2 = buildUniformPageLayout(960, 1242, 2);
const mk = (id, y) => ({ id, tool: "pen", color: "#111111", width: 2, points: [{ x: 100, y, t: 0, pressure: 0.5 }] });
const strokeP1 = mk("s1", 500);
const strokeP2 = mk("s2", 1242 + PDF_BACKGROUND_PAGE_GAP + 100);
assert("assign page1", assignStrokeToPage(strokeP1, layout2)?.pageNumber, 1);
assert("assign page2", assignStrokeToPage(strokeP2, layout2)?.pageNumber, 2);

const byPage = splitStrokesByPage([strokeP1, strokeP2], layout2);
assert("split count", byPage.size, 2);
assert("page1 strokes", byPage.get(1)?.length, 1);
assert("page2 strokes", byPage.get(2)?.length, 1);

const rect2 = { left: 0, top: 0, width: 480, height: 621 };
const screenStrokes = convertStrokesToScreen([strokeP1], layout2.pages[0], rect2);
const screenX = (screenStrokes[0].points[0].x);
const screenY = (screenStrokes[0].points[0].y);
assert("toScreen x scale", Math.round(screenX * 100) / 100, 50);
assert("toScreen y scale", Math.round(screenY * 100) / 100, 250);
assert("toScreen width scale", Math.round(screenStrokes[0].width * 100) / 100, 1);

const back = convertStrokesToLogical(screenStrokes, layout2.pages[0], rect2);
assert("toLogical x", Math.round(back[0].points[0].x), 100);
assert("toLogical y", Math.round(back[0].points[0].y), 500);
assert("toLogical width", Math.round(back[0].width), 2);

// 5b. 画布嵌入 .page 局部坐标：convertStrokes* 必须忽略 rect.left/top（视口偏移），
//     只按页面内缩放换算。缩放居中后 rect.left/top 变负，若仍带偏移会导致笔画朝左上漂移。
const rect3 = { left: 50, top: 30, width: 480, height: 621 };
const screen3 = convertStrokesToScreen([strokeP1], layout2.pages[0], rect3);
assert("toScreen x ignores rect.left", Math.round(screen3[0].points[0].x * 100) / 100, 50);
assert("toScreen y ignores rect.top", Math.round(screen3[0].points[0].y * 100) / 100, 250);
const back3 = convertStrokesToLogical(screen3, layout2.pages[0], rect3);
assert("toLogical x roundtrip", Math.round(back3[0].points[0].x), 100);
assert("toLogical y roundtrip", Math.round(back3[0].points[0].y), 500);

if (failed > 0) {
  console.error(`FAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log("OK: all native-pdf-geometry assertions passed");
