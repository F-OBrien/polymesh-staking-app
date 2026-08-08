'use client';

import { parseAsInteger, useQueryState } from 'nuqs';
import { useCallback, useMemo } from 'react';
import { DEFAULT_ERA_WINDOW } from '@/config/site';
import type { Manifest } from '@/lib/schemas/data';

/**
 * The era-range control, and the hook behind it.
 *
 * **The range lives in the URL.** Every view on this site must be linkable —
 * the previous app kept zoom, pan and its period selector in component state,
 * so you could not send anyone what you were looking at. A shared link is the
 * main way analysis actually travels.
 *
 * Encoded as a window length (`?eras=90`) rather than a pair of absolute era
 * indices. A link then still means "the last 90 days" a week later, which is
 * almost always what the sender meant. Absolute ranges are for permalinks to a
 * specific incident, and are a later addition if anyone asks.
 */

/** Presets, in eras. An era is 24 hours on mainnet. */
export const RANGE_PRESETS = [
  { eras: 30, label: '30d' },
  { eras: 90, label: '90d' },
  { eras: 180, label: '6m' },
  { eras: 365, label: '1y' },
] as const;

/** Sentinel for "everything we hold". */
export const ALL_ERAS = 0;

export function useEraWindow() {
  const [eras, setEras] = useQueryState(
    'eras',
    parseAsInteger.withDefault(DEFAULT_ERA_WINDOW).withOptions({
      // A range change is navigation within a view, not a new destination:
      // pushing history would make Back step through every range the reader
      // tried rather than returning them to the previous page.
      history: 'replace',
      shallow: true,
    }),
  );

  return [eras, setEras] as const;
}

/**
 * Resolves the window to a concrete era range against the manifest.
 *
 * Clamped to available history, so a `?eras=365` link on a chain with 84 eras
 * of data yields what exists rather than an error. Charts state their actual
 * coverage separately.
 */
export function useResolvedRange(manifest: Manifest | undefined) {
  const [window] = useEraWindow();

  return useMemo(() => {
    if (!manifest) return undefined;

    const toEra = manifest.lastCompleteEra;
    const fromEra =
      window === ALL_ERAS ? manifest.firstEra : Math.max(manifest.firstEra, toEra - window + 1);

    return { fromEra, toEra };
  }, [manifest, window]);
}

export function EraRangeControl({ manifest }: { manifest: Manifest | undefined }) {
  const [window, setWindow] = useEraWindow();

  const available = manifest ? manifest.lastCompleteEra - manifest.firstEra + 1 : 0;

  const select = useCallback(
    (value: number) => {
      void setWindow(value === DEFAULT_ERA_WINDOW ? null : value);
    },
    [setWindow],
  );

  return (
    <fieldset
      className="flex flex-wrap items-center gap-0.5 rounded-full border p-0.5 text-xs"
      style={{ borderColor: 'var(--border)' }}
    >
      <legend className="sr-only">Time range</legend>

      {RANGE_PRESETS.map(({ eras, label }) => {
        // A preset longer than the history we hold would silently show the same
        // data as "All" — disabling it says so instead of implying otherwise.
        const unavailable = manifest != null && eras > available;
        return (
          <RangeOption
            key={eras}
            label={label}
            selected={window === eras}
            disabled={unavailable}
            title={
              unavailable
                ? `Only ${available} eras of history are available so far`
                : `Last ${label}`
            }
            onSelect={() => select(eras)}
          />
        );
      })}

      <RangeOption
        label="All"
        selected={window === ALL_ERAS}
        title={manifest ? `All ${available} eras held` : 'All available history'}
        onSelect={() => select(ALL_ERAS)}
      />
    </fieldset>
  );
}

function RangeOption({
  label,
  selected,
  disabled = false,
  title,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  title: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={`rounded-full px-2.5 py-1 transition-colors ${
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      }`}
      style={{
        background: selected ? 'var(--surface-2)' : 'transparent',
        color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
        fontWeight: selected ? 600 : 400,
        boxShadow: selected ? 'var(--shadow-sm)' : 'none',
      }}
      title={title}
    >
      <input
        type="radio"
        name="era-range"
        className="sr-only"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
      />
      {label}
    </label>
  );
}
