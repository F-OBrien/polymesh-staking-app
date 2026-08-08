/**
 * Theme handling. Three states, matching tokens.css:
 *   'light' | 'dark'  -> stamped on <html data-theme>, wins over the OS
 *   'system'          -> no attribute, OS preference applies via media query
 */

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'pm-staking-theme';
export const DEFAULT_THEME: Theme = 'system';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Applies a theme to the document root. Safe to call repeatedly. */
export function applyTheme(theme: Theme, root: HTMLElement): void {
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // localStorage throws in private-browsing modes and sandboxed frames.
    return DEFAULT_THEME;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Non-fatal: the theme still applies for this session.
  }
}

/**
 * Runs before first paint to stamp the saved theme, preventing a flash of the
 * wrong palette. Inlined in <head> as a blocking script — it must execute
 * before the body renders, so it cannot be a normal module.
 *
 * Deliberately tiny and dependency-free; it is duplicated logic from
 * `readStoredTheme`/`applyTheme` only because it has to run standalone.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

// ---------------------------------------------------------------------------
// External store adapter
// ---------------------------------------------------------------------------

/**
 * `localStorage` is external state, so components read it through
 * `useSyncExternalStore` rather than copying it into React state inside an
 * effect. That avoids the cascading render an effect-then-setState would cause,
 * and gives cross-tab synchronisation for free via the `storage` event.
 */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToTheme(onChange: () => void): () => void {
  listeners.add(onChange);

  // Another tab changing the theme should update this one.
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      applyTheme(readStoredTheme(), document.documentElement);
      notify();
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Returns a primitive, so `useSyncExternalStore` can compare snapshots by
 * value and will not loop.
 */
export function getThemeSnapshot(): Theme {
  return readStoredTheme();
}

/**
 * The server cannot know the stored preference, so it reports the default. The
 * pre-paint script in the document head has already applied the real theme by
 * the time anything is visible, so only this control's own highlight settles
 * after hydration — there is no flash of the wrong palette.
 */
export function getServerThemeSnapshot(): Theme {
  return DEFAULT_THEME;
}

/** Persists a theme, applies it, and notifies subscribers. */
export function setTheme(theme: Theme): void {
  storeTheme(theme);
  applyTheme(theme, document.documentElement);
  notify();
}
