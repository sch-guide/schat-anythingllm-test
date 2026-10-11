import { useSyncExternalStore } from "react";
import Brand from "@/models/schatBrand";
import { defaultBrand } from "@/utils/schatBrand";

// One shared public request for all logo/subtitle/notice consumers. Schedule
// boundaries locally so an open employee page hides an expired notice.
export function createBrandStore(
  api,
  clock = { now: Date.now, setTimeout, clearTimeout }
) {
  let state = { brand: defaultBrand(), now: clock.now() };
  let refreshTimer = null,
    boundaryTimer = null,
    pending = null;
  const listeners = new Set();
  function emit() {
    listeners.forEach((fn) => fn());
  }
  function scheduleBoundary() {
    clock.clearTimeout(boundaryTimer);
    if (!listeners.size) return;
    const next = [state.brand.announcement.start, state.brand.announcement.end]
      .filter(Boolean)
      .map(Date.parse)
      .filter((n) => n > clock.now())
      .sort((a, b) => a - b)[0];
    if (next !== undefined)
      boundaryTimer = clock.setTimeout(
        () => {
          state = { ...state, now: clock.now() };
          emit();
          scheduleBoundary();
        },
        Math.min(next - clock.now(), 2147483647)
      );
  }
  function publish(brand) {
    state = { brand, now: clock.now() };
    emit();
    scheduleBoundary();
  }
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      try {
        publish(await api.read());
      } catch {
        /* Keep the last successful brand. */
      } finally {
        pending = null;
        if (listeners.size) {
          clock.clearTimeout(refreshTimer);
          refreshTimer = clock.setTimeout(refresh, 30000);
        }
      }
    })();
    return pending;
  }
  const onUpdate = (event) => publish(event.detail);
  const onFocus = () => {
    state = { ...state, now: clock.now() };
    emit();
    scheduleBoundary();
    refresh();
  };
  return {
    getSnapshot: () => state,
    refresh,
    subscribe(fn) {
      listeners.add(fn);
      if (listeners.size === 1) {
        if (typeof window !== "undefined") {
          window.addEventListener?.("schat-brand-updated", onUpdate);
          window.addEventListener?.("focus", onFocus);
        }
        refresh();
        scheduleBoundary();
      }
      return () => {
        listeners.delete(fn);
        if (!listeners.size) {
          clock.clearTimeout(refreshTimer);
          clock.clearTimeout(boundaryTimer);
          if (typeof window !== "undefined") {
            window.removeEventListener?.("schat-brand-updated", onUpdate);
            window.removeEventListener?.("focus", onFocus);
          }
        }
      };
    },
  };
}
const store = createBrandStore(Brand);
export default function useSchatBrand() {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
}
