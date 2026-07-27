export async function stringifyJsonOffMainThread(value: unknown, space = 0): Promise<string> {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    return JSON.stringify(value, null, space);
  }

  const workerSource = `
    self.onmessage = function(event) {
      const message = event.data || {};
      try {
        self.postMessage({
          id: message.id,
          json: JSON.stringify(message.value, null, message.space)
        });
      } catch (error) {
        self.postMessage({
          id: message.id,
          error: error && error.message ? error.message : String(error)
        });
      }
    };
  `;

  let url: string | null = null;
  let worker: Worker | null = null;

  try {
    const blob = new Blob([workerSource], { type: "application/javascript" });
    url = URL.createObjectURL(blob);
    worker = new Worker(url);
    const id = crypto.randomUUID();

    return await new Promise<string>((resolve, reject) => {
      if (!worker) {
        reject(new Error("JSON worker was not created"));
        return;
      }

      worker.onmessage = (event: MessageEvent<{ id?: string; json?: string; error?: string }>) => {
        const message = event.data;
        if (message.id !== id) return;

        if (typeof message.json === "string") {
          resolve(message.json);
        } else {
          reject(new Error(message.error || "JSON worker failed"));
        }
      };
      worker.onerror = (event) => {
        reject(new Error(event.message || "JSON worker error"));
      };
      worker.postMessage({ id, value, space });
    });
  } catch {
    return JSON.stringify(value, null, space);
  } finally {
    worker?.terminate();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}
