import { describe, expect, it } from 'vitest';
import { buildLabeller } from './operator-label';
import type { OperatorRegistry } from '@/lib/schemas/data';

const record = (name: string) => ({
  did: null,
  name,
  website: null,
  firstSeenEra: 1,
  lastSeenEra: 2,
  status: 'active' as const,
});

const registry: OperatorRegistry = {
  '2HW34bz2Ue9RicxMGfPH6HaFRQKM416cJivXdciXTYsNz3Dz': record('DigiClear'),
  '2Fxv2duCy49TBJZMyZScNacJgBC5Rnn5FRmLgtNttnbBwjM5': record('DigiClear'),
  '2DK6iDQ3fcP9BDtLzPE9DcmTpkMq8JpwE3sLZvPWQnP7SaFf': record('Assetera'),
};

describe('buildLabeller', () => {
  const label = buildLabeller(registry);

  it('uses the bare name when only one node carries it', () => {
    expect(label('2DK6iDQ3fcP9BDtLzPE9DcmTpkMq8JpwE3sLZvPWQnP7SaFf')).toBe('Assetera');
  });

  it('appends the address when a name is shared', () => {
    // A legend reading "DigiClear" three times identifies nothing, and §8.1
    // rule 5 forbids leaning on colour to tell series apart.
    const a = label('2HW34bz2Ue9RicxMGfPH6HaFRQKM416cJivXdciXTYsNz3Dz');
    const b = label('2Fxv2duCy49TBJZMyZScNacJgBC5Rnn5FRmLgtNttnbBwjM5');
    expect(a).toMatch(/^DigiClear \(.+\)$/);
    expect(b).toMatch(/^DigiClear \(.+\)$/);
    expect(a).not.toBe(b);
  });

  it('judges ambiguity against the whole registry, not the current selection', () => {
    // Otherwise a label would change as a filter or pin selection changed, and
    // the same operator would read differently on two pages.
    const single = buildLabeller({
      '2HW34bz2Ue9RicxMGfPH6HaFRQKM416cJivXdciXTYsNz3Dz': record('DigiClear'),
    });
    expect(single('2HW34bz2Ue9RicxMGfPH6HaFRQKM416cJivXdciXTYsNz3Dz')).toBe('DigiClear');
    // Same address, registry that knows about its sibling.
    expect(label('2HW34bz2Ue9RicxMGfPH6HaFRQKM416cJivXdciXTYsNz3Dz')).not.toBe('DigiClear');
  });

  it('never invents a per-node number', () => {
    // The whole point. Numbering by position in a sort of an identity's
    // addresses is not stable: adding a stash that sorts earlier renumbers
    // every node after it, so a noted "DigiClear 2" becomes a different node.
    for (const address of Object.keys(registry)) {
      expect(label(address)).not.toMatch(/\s\d+$/);
    }
  });

  it('falls back to a truncated address for an unknown operator', () => {
    expect(label('2Unknown000000000000000000000000000000000000000')).toMatch(/…/);
  });

  it('survives having no registry at all', () => {
    expect(buildLabeller(undefined)('2Whatever0000000000000000000000000000000000000')).toMatch(/…/);
  });
});
