/** Lightweight loading bus — works outside React for fetch interceptors */

let depth = 0;
const listeners = new Set();

export function getLoadingDepth() {
  return depth;
}

export function subscribeLoading(fn) {
  listeners.add(fn);
  try {
    fn(depth > 0, depth);
  } catch (_) {}
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try {
      fn(depth > 0, depth);
    } catch (_) {}
  }
}

export function startLoading(_reason = "") {
  depth += 1;
  emit();
}

export function stopLoading() {
  depth = Math.max(0, depth - 1);
  emit();
}

export function resetLoading() {
  depth = 0;
  emit();
}

export async function withLoading(promise) {
  startLoading();
  try {
    return await promise;
  } finally {
    stopLoading();
  }
}
