import { graphql, INDEXER_PAGE_SIZE, type GraphQlOptions } from './client';
import type { OffenceReport } from '@/lib/schemas/data';

/**
 * Offences reported against validators, from the indexer.
 *
 * The one record of an operator misbehaving that exists anywhere. Chain state
 * has `validatorSlashInEra`, which records what was *taken* — and Polymesh has
 * `slashingAllowedFor` set so that nothing is, so that storage is empty and a
 * real outage leaves no trace in it. The event fires anyway.
 *
 * **Why not `imOnline.SomeOffline`.** It is the obvious source and the one the
 * block explorer shows, and querying it against mainnet returns zero rows: the
 * indexer does not carry that module. `staking.SlashReported` is the downstream
 * record of the same offence and it is carried — 145 rows over the chain's life
 * — with the offender, the fraction and the era in the first three event args.
 *
 * Measured, the eras line up with what the chunks already show. The earliest
 * reports name Calico Capital in era 1130, and that operator's points columns
 * are null for eras 1131–1137. A later pair sits in era 1670, where its points
 * fell from ~3,200 to 180 before it vanished for 1671–1672. The event is
 * describing the outage the charts draw.
 */

/**
 * `slash_era` — the era the offence happened in, not the era it was reported.
 *
 * They differ: reports arrive over the following sessions, so a single era's
 * offence produces several events spread across later blocks. Grouping on the
 * event's own era rather than the block's is what makes "era 1130" line up with
 * the gap the chunks show at 1131.
 */
interface RawEvent {
  /** Offending validator's stash, as a 32-byte hex public key. */
  eventArg0: string | null;
  /** Slash fraction, as a Perbill in string form. */
  eventArg1: string | null;
  /** The era the offence occurred in. */
  eventArg2: string | null;
  blockId: string;
}

interface EventsResponse {
  events: { totalCount: number; nodes: RawEvent[] };
}

const OFFENCES_QUERY = `
  query SlashReports($first: Int!, $offset: Int!) {
    events(
      filter: {
        moduleId: { equalTo: staking }
        eventId: { equalTo: SlashReported }
      }
      orderBy: [BLOCK_ID_ASC]
      first: $first
      offset: $offset
    ) {
      totalCount
      nodes {
        eventArg0
        eventArg1
        eventArg2
        blockId
      }
    }
  }
`;

/** A Perbill, as the indexer hands it over: an integer string of parts per 1e9. */
const PERBILL = 1_000_000_000;

export interface RawOffence {
  /** Hex public key, not SS58 — encoding needs a chain prefix the caller has. */
  publicKey: string;
  fraction: number;
  era: number;
  block: number;
}

/** Walks every report, oldest first. Two requests on mainnet today. */
export async function fetchSlashReports(
  options: GraphQlOptions & { onProgress?: (loaded: number, total: number) => void } = {},
): Promise<RawOffence[]> {
  const { onProgress, ...graphqlOptions } = options;
  const reports: RawOffence[] = [];
  let total = Infinity;

  for (let offset = 0; offset < total; offset += INDEXER_PAGE_SIZE) {
    const data = await graphql<EventsResponse>(
      OFFENCES_QUERY,
      { first: INDEXER_PAGE_SIZE, offset },
      graphqlOptions,
    );

    total = data.events.totalCount;
    if (data.events.nodes.length === 0) break;

    for (const node of data.events.nodes) {
      const report = toOffence(node);
      if (report) reports.push(report);
    }
    onProgress?.(reports.length, total);
  }

  return reports;
}

/** A row we cannot read is dropped rather than defaulted. */
export function toOffence(node: RawEvent): RawOffence | null {
  const publicKey = node.eventArg0;
  const fraction = Number.parseInt(node.eventArg1 ?? '', 10);
  const era = Number.parseInt(node.eventArg2 ?? '', 10);
  const block = Number.parseInt(node.blockId, 10);

  if (!publicKey || !publicKey.startsWith('0x')) return null;
  if (!Number.isFinite(fraction) || !Number.isFinite(era) || !Number.isFinite(block)) return null;
  if (era < 0) return null;

  return { publicKey, fraction: fraction / PERBILL, era, block };
}

/**
 * Collapses raw events into one row per (operator, era).
 *
 * One offence is reported once per session until the era ends, so mainnet's 145
 * events describe far fewer incidents — three consecutive blocks naming the same
 * validator and era in April are one node being down, not three offences. A
 * table of the raw events would triple-count every one of them.
 *
 * The kept fraction is the largest seen, and the kept block the earliest: the
 * worst thing reported, and when it started.
 */
export function groupOffences(
  raw: readonly RawOffence[],
  encode: (publicKey: string) => string | null,
): OffenceReport[] {
  const byKey = new Map<string, OffenceReport>();

  for (const report of raw) {
    const address = encode(report.publicKey);
    // An offender we cannot name is dropped: an SS58 encoding failure means the
    // arg was not an account, and a malformed address would join to nothing
    // downstream anyway.
    if (!address) continue;

    const key = `${address}:${report.era}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        era: report.era,
        address,
        fraction: report.fraction,
        count: 1,
        block: report.block,
      });
      continue;
    }

    existing.count += 1;
    existing.fraction = Math.max(existing.fraction, report.fraction);
    existing.block = Math.min(existing.block, report.block);
  }

  return [...byKey.values()].sort((a, b) => b.era - a.era || a.address.localeCompare(b.address));
}
