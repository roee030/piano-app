/**
 * Bring-your-own-key storage for the static (GitHub Pages) build, which has
 * no server to hold an API key. The key stays on this device and is sent only
 * to api.anthropic.com, directly from the browser.
 *
 * By default it lives in sessionStorage (cleared when the tab closes); the
 * student can opt in to localStorage ("remember on this device").
 */
const KEY = 'pianotutor.anthropicKey';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function getBrowserKey(): string | null {
  return safe(() => sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY), null);
}

export function isKeyRemembered(): boolean {
  return safe(() => localStorage.getItem(KEY) !== null, false);
}

export function setBrowserKey(key: string, remember: boolean) {
  forgetBrowserKey();
  safe(() => (remember ? localStorage : sessionStorage).setItem(KEY, key.trim()), undefined);
}

export function forgetBrowserKey() {
  safe(() => sessionStorage.removeItem(KEY), undefined);
  safe(() => localStorage.removeItem(KEY), undefined);
}

export const looksLikeKey = (k: string) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k.trim());
