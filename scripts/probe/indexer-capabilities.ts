/**
 * What the indexer can do that we are not using.
 *
 * Three questions, all of which change the design if the answer is yes:
 *
 *  1. Does `StakingEvent` carry an era directly? Reward rows currently export a
 *     blank era column because we map block -> era from our own chunks, and we
 *     only hold ~84 eras against histories that run for years.
 *  2. Will the endpoint return more than 100 rows, or aggregate server-side? An
 *     account with 11,858 payouts is 119 sequential round trips today.
 *  3. Are era-transition events (`EraPaid` / `EraPayout`) queryable? That is the
 *     cheap way to build an era -> (block, timestamp) index covering all
 *     history, which both the reward CSV and the archive backfill need.
 *
 * Read-only. Run with `npm run probe:indexer-caps`.
 */
import { graphql } from '../../lib/indexer/client';
import { resolveIndexerUrl } from '../../config/networks';

/* eslint-disable @typescript-eslint/no-explicit-any */

const endpoint = resolveIndexerUrl();

async function try_<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    const result = await run();
    console.log(`  ✓ ${label}`);
    return result;
  } catch (error) {
    console.log(`  ✗ ${label}: ${(error as Error).message}`);
    const detail = (error as any).detail;
    if (detail) console.log(`      ${String(detail).slice(0, 220)}`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`Indexer: ${endpoint}\n`);

  // -- 1. What fields does a StakingEvent actually have? --------------------
  console.log('StakingEvent fields');
  const introspection = await try_('introspect StakingEvent', () =>
    graphql<any>(
      `
        query {
          __type(name: "StakingEvent") {
            fields {
              name
              type {
                name
                kind
                ofType {
                  name
                }
              }
            }
          }
        }
      `,
      {},
    ),
  );
  const fields: { name: string; type: any }[] = introspection?.__type?.fields ?? [];
  console.log('   ', fields.map((f) => f.name).join(', ') || '(none)');
  const eraField = fields.find((f) => /era/i.test(f.name));
  console.log(`    era-bearing field: ${eraField ? eraField.name : 'NONE'}`);

  // -- 2. Page size and server-side aggregation -----------------------------
  console.log('\nPagination and aggregation');
  for (const first of [100, 500, 1000]) {
    await try_(`first: ${first}`, async () => {
      const data = await graphql<any>(
        `
          query ($first: Int!) {
            stakingEvents(first: $first, filter: { eventId: { in: [Reward, Rewarded] } }) {
              nodes {
                id
              }
            }
          }
        `,
        { first },
      );
      const n = data.stakingEvents.nodes.length;
      console.log(`      returned ${n} rows`);
      return n;
    });
  }

  await try_('totalCount (one request instead of N pages)', async () => {
    const data = await graphql<any>(
      `
        query {
          stakingEvents(filter: { eventId: { in: [Reward, Rewarded] } }) {
            totalCount
          }
        }
      `,
      {},
    );
    console.log(`      totalCount = ${data.stakingEvents.totalCount}`);
    return data;
  });

  await try_('aggregates { sum { amount } } — server-side lifetime total', async () => {
    const data = await graphql<any>(
      `
        query {
          stakingEvents(filter: { eventId: { in: [Reward, Rewarded] } }) {
            aggregates {
              sum {
                amount
              }
            }
          }
        }
      `,
      {},
    );
    console.log(`      sum = ${JSON.stringify(data.stakingEvents.aggregates)}`);
    return data;
  });

  await try_('groupBy — server-side bucketing', async () => {
    const data = await graphql<any>(
      `
        query {
          stakingEvents(filter: { eventId: { in: [Reward, Rewarded] } }, groupBy: [EVENT_ID]) {
            keys
            aggregates {
              sum {
                amount
              }
              distinctCount {
                id
              }
            }
          }
        }
      `,
      {},
    );
    console.log(`      ${JSON.stringify(data.stakingEvents).slice(0, 300)}`);
    return data;
  });

  // -- 3. Era transitions, for an era -> block/time index -------------------
  console.log('\nEra transition events');
  for (const eventId of ['EraPaid', 'EraPayout']) {
    await try_(`events where eventId = ${eventId}`, async () => {
      const data = await graphql<any>(
        `
          query ($e: EventIdEnum!) {
            events(
              filter: { moduleId: { equalTo: staking }, eventId: { equalTo: $e } }
              first: 3
              orderBy: [CREATED_AT_ASC]
            ) {
              totalCount
              nodes {
                id
                blockId
                eventIdx
                eventArgs
                createdAt
              }
            }
          }
        `,
        { e: eventId },
      );
      console.log(`      totalCount = ${data.events.totalCount}`);
      for (const node of data.events.nodes.slice(0, 2)) {
        console.log(`      ${JSON.stringify(node).slice(0, 240)}`);
      }
      return data;
    });
  }

  // What the EventIdEnum actually contains, for era-ish names.
  await try_('EventIdEnum members matching /era/i', async () => {
    const data = await graphql<any>(
      `
        query {
          __type(name: "EventIdEnum") {
            enumValues {
              name
            }
          }
        }
      `,
      {},
    );
    const names: string[] = (data.__type?.enumValues ?? []).map((v: any) => v.name);
    console.log(`      ${names.filter((n) => /era|session|slash/i.test(n)).join(', ')}`);
    return data;
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
