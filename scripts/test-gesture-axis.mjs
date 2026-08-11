import { dominantAxis } from "../src/overlay/pdf/gestureAxis.ts";

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

assert("horizontal dominant", dominantAxis(30, 4, 8), "horizontal");
assert("vertical dominant", dominantAxis(3, 40, 8), "vertical");
assert("below threshold none", dominantAxis(3, 4, 8), "none");
assert("equal treated vertical", dominantAxis(5, 5, 4), "vertical");
assert("zero zero none", dominantAxis(0, 0, 1), "none");

if (failed > 0) {
  console.error(`FAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log("OK: all gesture-axis assertions passed");
