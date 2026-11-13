// Transfer a slot only after its previous worker has exited, including cancellation.
let active = 0;
const pending: Array<() => void> = [];
export function cancelled() { return new Error("Template render cancelled"); }
export function acquireRenderSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = pending.indexOf(start);
      if (index >= 0) pending.splice(index, 1);
      reject(cancelled());
    };
    const start = () => {
      signal?.removeEventListener("abort", abort);
      active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        active--;
        pending.shift()?.();
      });
    };
    if (active < 2) start();
    else if (pending.length >= 16) reject(new Error("Template render queue full; retry shortly"));
    else { pending.push(start); signal?.addEventListener("abort", abort, { once: true }); }
  });
}
