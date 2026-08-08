'use client';

import { useSyncExternalStore } from 'react';
import {
  getServerThemeSnapshot,
  getThemeSnapshot,
  setTheme,
  subscribeToTheme,
  THEMES,
  type Theme,
} from '@/lib/theme';

const LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const ICONS: Record<Theme, string> = {
  light:
    'M12 3v2m0 14v2m9-9h-2M5 12H3m14.7-6.7-1.4 1.4M7.7 16.3l-1.4 1.4m0-11.4 1.4 1.4m8.6 8.6 1.4 1.4',
  dark: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  system: 'M3 5h18v11H3zM8 20h8m-4-4v4',
};

/**
 * Three-state theme control: light, dark, or follow the OS.
 *
 * "System" is a real option, not a default to be resolved away — a user whose OS
 * switches at dusk expects the site to follow. It is a segmented radio group
 * rather than a switch, because a switch cannot represent three states without
 * lying about one of them.
 *
 * The stored preference is read through `useSyncExternalStore`, so `localStorage`
 * stays the single source of truth and other tabs stay in sync.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);

  return (
    <fieldset
      className="flex items-center gap-0.5 rounded-full border p-0.5"
      style={{ borderColor: 'var(--border)' }}
    >
      <legend className="sr-only">Colour theme</legend>
      {THEMES.map((option) => {
        const selected = theme === option;
        return (
          <label
            key={option}
            className="cursor-pointer rounded-full px-2 py-1 transition-colors"
            style={{
              background: selected ? 'var(--surface-1)' : 'transparent',
              color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: selected ? 'var(--shadow-sm)' : 'none',
            }}
            title={LABELS[option]}
          >
            <input
              type="radio"
              name="theme"
              value={option}
              checked={selected}
              onChange={() => setTheme(option)}
              className="sr-only"
            />
            {/* Icon plus a visually-hidden label: never icon-only to a screen reader. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={ICONS[option]} />
            </svg>
            <span className="sr-only">{LABELS[option]}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
