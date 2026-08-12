/**
 * Can we get validator offences out of the indexer?
 *
 * The operator pages can already say when an operator produced nothing — the
 * chunks carry a null for every era it was not in the active set. What they
 * cannot say is *why*, and the chain does emit the reason: `imOnline.SomeOffline`
 * names the validators that failed to send a heartbeat in a session, and
 * `offences.Offence` records the report that follows. Both are events, so they
 * live in the indexer or nowhere.
 *
 * Four questions:
 *
 *  1. Is there a generic `events` entity at all, or only the staking-shaped
 *     `stakingEvents` we already use?
 *  2. Can it be filtered by module and event id, server-side?
 *  3. Do `imOnline.SomeOffline` rows exist on mainnet, and how many?
 *  4. What do the attributes look like — is the offending validator's stash
 *     recoverable from the row, or only the session index?
 *
 * Read-only. Run with `npm run probe:offences`.
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
    if (detail) console.log(`      ${String(detail).slice(0, 300)}`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`Indexer: ${endpoint}\n`);

  // -- 1. What root fields exist? -------------------------------------------
  console.log('Root query fields mentioning event or offence');
  const root = await try_('introspect Query', () =>
    graphql<any>(
      `
        query {
          __type(name: "Query") {
            fields {
              name
            }
          }
        }
      `,
      {},
      { endpoint },
    ),
  );
  const names: string[] = (root?.__type?.fields ?? []).map((f: any) => f.name);
  const interesting = names.filter((n) => /event|offen|slash|session|heartbeat/i.test(n));
  console.log(`  ${interesting.join(', ') || '(none)'}`);
  console.log(`  (${names.length} root fields in total)\n`);

  // -- 2. What does an Event row look like? ---------------------------------
  console.log('Event fields');
  const fields = await try_('introspect Event', () =>
    graphql<any>(
      `
        query {
          __type(name: "Event") {
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
      { endpoint },
    ),
  );
  for (const field of fields?.__type?.fields ?? []) {
    const type = field.type?.name ?? field.type?.ofType?.name ?? field.type?.kind;
    console.log(`  ${field.name}: ${type}`);
  }
  console.log();

  // -- 3. Are there any offence rows? ---------------------------------------
  for (const [moduleId, eventId] of [
    ['imOnline', 'SomeOffline'],
    ['offences', 'Offence'],
    ['staking', 'Slashed'],
    ['staking', 'Chilled'],
    ['staking', 'SlashingAllowedForChanged'],
  ] as const) {
    console.log(`${moduleId}.${eventId}`);
    // Filtered on the *Text* columns, not on `moduleId`/`eventId`: those are
    // GraphQL enums (`ModuleIdEnum`, `EventIdEnum`), and passing a String
    // variable to them is a 400 before the query ever runs.
    const rows = await try_(`query ${moduleId}.${eventId}`, () =>
      graphql<any>(
        `
          query ($moduleId: String!, $eventId: String!) {
            events(
              filter: {
                moduleIdText: { equalToInsensitive: $moduleId }
                eventIdText: { equalToInsensitive: $eventId }
              }
              orderBy: [BLOCK_ID_DESC]
              first: 3
            ) {
              totalCount
              nodes {
                id
                blockId
                moduleIdText
                eventIdText
                attributes
              }
            }
          }
        `,
        { moduleId, eventId },
        { endpoint },
      ),
    );
    const events = rows?.events;
    if (events) {
      console.log(`      totalCount ${events.totalCount}`);
      for (const node of events.nodes ?? []) {
        console.log(
          `      block ${node.blockId}  ${JSON.stringify(node.attributes).slice(0, 400)}`,
        );
      }
    }
    console.log();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
