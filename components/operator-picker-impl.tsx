'use client';

import { Command } from 'cmdk';
import { useState } from 'react';
import { truncateAddress } from '@/lib/format';
import type { OperatorPickerProps } from './operator-picker';

/**
 * Search-and-add for the comparison.
 *
 * `cmdk` supplies the combobox behaviour — filtering, the aria wiring, the
 * roving active-item, keyboard selection. That is exactly the class of work
 * worth taking from a library: fiddly, well-specified, and nothing to do with
 * our visual identity. The styling is entirely ours, so this restyles with the
 * rest of the app.
 *
 * Filtering is `cmdk`'s own, but over a haystack we build: name, node label and
 * address, so pasting an address from an explorer finds the operator even
 * though nobody reads addresses.
 *
 * **Import `./operator-picker`, not this file.** That module code-splits this
 * one, which is what keeps 13.3 KB of `cmdk` off the critical path — see the
 * note there.
 */
export function OperatorPickerImpl({
  rows,
  selected,
  onSelect,
  disabled = false,
  disabledReason,
}: OperatorPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const available = rows.filter((row) => !selected.has(row.address));

  if (disabled) {
    return (
      <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
        {disabledReason}
      </p>
    );
  }

  return (
    <div className="relative w-full max-w-sm">
      <Command
        label="Add an operator to the comparison"
        // Our own haystack: `value` carries the address so selection is
        // unambiguous, while the searchable text includes the readable name.
        filter={(value, query) => {
          if (query.trim() === '') return 1;
          return value.toLowerCase().includes(query.trim().toLowerCase()) ? 1 : 0;
        }}
        className="rounded-[var(--radius-md)] border"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <Command.Input
          value={search}
          onValueChange={setSearch}
          onFocus={() => setOpen(true)}
          // Blur is deferred so a click on an item lands before the list closes.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Add an operator…"
          className="w-full bg-transparent px-3 py-2 text-sm outline-none"
        />

        {open ? (
          <Command.List
            className="max-h-64 overflow-y-auto border-t p-1"
            style={{ borderColor: 'var(--border)' }}
          >
            <Command.Empty className="px-2 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
              No operator matches “{search}”.
            </Command.Empty>

            {available.map((row) => (
              <Command.Item
                key={row.address}
                value={`${row.nodeLabel} ${row.name} ${row.address}`}
                onSelect={() => {
                  onSelect(row.address);
                  setSearch('');
                }}
                className="flex cursor-pointer items-baseline justify-between gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm data-[selected=true]:bg-[var(--surface-2)]"
              >
                <span className="truncate">{row.nodeLabel}</span>
                <span
                  className="shrink-0 text-xs"
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  {truncateAddress(row.address)}
                </span>
              </Command.Item>
            ))}
          </Command.List>
        ) : null}
      </Command>
    </div>
  );
}
