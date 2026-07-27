export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function waitForImages(root: HTMLElement, timeoutMs = 1200): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  if (images.length === 0) return;

  const imagePromises = images.map((img) => {
    if (img.complete) return Promise.resolve();
    if (typeof img.decode === "function") {
      return img.decode().catch(() => undefined);
    }
    return new Promise<void>((resolve) => {
      const done = () => resolve();
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
  });

  await Promise.race([
    Promise.all(imagePromises).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))
  ]);
}
