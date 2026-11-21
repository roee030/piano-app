import { useSyncExternalStore } from 'react';
import type { Store } from '../app/store';

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function fmtPct(v: number | null | undefined, digits = 0) {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;
}

export function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export function percentile(arr: number[], p: number) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
