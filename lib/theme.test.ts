import { describe, expect, it, beforeEach } from 'vitest';
import { applyTheme, isTheme, readStoredTheme, storeTheme, THEME_STORAGE_KEY } from './theme';

describe('isTheme', () => {
  it.each(['light', 'dark', 'system'])('accepts %s', (value) => {
    expect(isTheme(value)).toBe(true);
  });

  it.each([['sepia'], [''], [null], [undefined], [42]])('rejects %s', (value) => {
    expect(isTheme(value)).toBe(false);
  });
});

describe('applyTheme', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('html');
  });

  it('stamps an explicit choice so it beats the OS preference', () => {
    applyTheme('dark', root);
    expect(root.getAttribute('data-theme')).toBe('dark');

    applyTheme('light', root);
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('removes the attribute for "system" so the media query applies', () => {
    applyTheme('dark', root);
    applyTheme('system', root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('theme persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a stored theme', () => {
    storeTheme('dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('falls back to "system" when nothing is stored', () => {
    expect(readStoredTheme()).toBe('system');
  });

  it('falls back to "system" when the stored value is not a theme', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    expect(readStoredTheme()).toBe('system');
  });
});
