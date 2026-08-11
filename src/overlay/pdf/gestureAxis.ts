export type GestureAxis = "horizontal" | "vertical" | "none";

export function dominantAxis(dx: number, dy: number, threshold: number): GestureAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= threshold && ay <= threshold) return "none";
  if (ax > ay) return "horizontal";
  return "vertical";
}
