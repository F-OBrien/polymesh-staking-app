import type { Metadata } from 'next';
import Link from 'next/link';
import { REWARD_CURVE } from '@/lib/metrics/staking';
import { SITE } from '@/config/site';

export const metadata: Metadata = {
  title: 'Methodology & glossary',
  description:
    'How every number on this site is calculated, where the data comes from, and what the staking terms mean.',
};

/**
 * Methodology and glossary.
 *
 * Exists because the previous app assumed fluency in Substrate staking
 * vocabulary — era, points, exposure, oversubscription, stash versus controller
 * — while its audience includes people deciding whether to stake at all. Every
 * formula the site uses is written out here, so a reader can check our
 * arithmetic rather than trust it.
 */

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mt-12 mb-3 text-[22px] leading-7 font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="mt-4 font-semibold">{term}</dt>
      <dd className="mt-1 ms-0" style={{ color: 'var(--text-secondary)' }}>
        {children}
      </dd>
    </>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <pre
      className="my-3 overflow-x-auto rounded-[var(--radius-sm)] border p-3 text-sm"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface-1)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </pre>
  );
}

export default function AboutPage() {
  const pct = (ratio: number) => `${(ratio * 100).toFixed(1).replace(/\.0$/, '')}%`;

  return (
    <main id="main" className="max-w-[70ch]">
      <h1 className="text-3xl leading-9 font-semibold tracking-tight">
        Methodology &amp; glossary
      </h1>
      <p className="mt-3" style={{ color: 'var(--text-secondary)' }}>
        Everything here is derived from public Polymesh chain data. This page states where it comes
        from and how each figure is calculated, so you can check the arithmetic rather than take it
        on trust.
      </p>

      <Section id="data" title="Where the data comes from">
        <p>
          Completed eras are read from the chain once, by a scheduled job, and published as static
          files. Your browser downloads those files — it never queries the chain to rebuild history.
          That is the main reason this site loads quickly: an era, once finished, never changes, so
          there is no reason for every visitor to re-derive it.
        </p>
        <dl>
          <Term term="Completed eras">
            Read hourly. The job exits immediately when no new era has finished, which on Polymesh
            is most of the time — an era lasts 24 hours.
          </Term>
          <Term term="Active era">
            Snapshotted every 15 minutes: reward points accrued so far, current stake, the validator
            set, and the election phase. Anything from this snapshot is labelled <em>as of</em> a
            time, so you can see how fresh it is.
          </Term>
          <Term term="Era progress and countdowns">
            Calculated in your browser from the era&rsquo;s start time and the chain&rsquo;s block
            timing. These tick continuously and require no network requests.
          </Term>
          <Term term="Operator names">
            From the registry maintained by the Polymesh Association, matched to stash accounts
            through their on-chain identity. Where no name is registered, the address is shown.
          </Term>
        </dl>
      </Section>

      <Section id="returns" title="How returns are calculated">
        <p>
          Each era, the chain mints a reward and splits it between operators in proportion to the{' '}
          <strong>reward points</strong> they earned. An operator keeps its commission and the rest
          goes to its nominators.
        </p>
        <Formula>{`operator reward = era reward × (operator points ÷ total points)`}</Formula>
        <p>
          We use integer division here, exactly as the chain does, so a reward summed over many eras
          matches what was actually paid rather than accumulating rounding error.
        </p>

        <h3 className="mt-6 mb-2 text-[17px] leading-6 font-semibold">
          APR, before and after commission
        </h3>
        <Formula>{`APR (gross) = (operator reward ÷ total stake) × eras per year
APR (net)   = APR (gross) × (1 − commission)`}</Formula>
        <p>
          <strong>Gross</strong> reflects how well the node performed. <strong>Net</strong> is what
          a nominator actually earns. Where an operator earned points in an era but has no
          commission on record, we show the gross figure and leave the net one blank — assuming zero
          commission would overstate your return.
        </p>

        <h3 className="mt-6 mb-2 text-[17px] leading-6 font-semibold">APR versus APY</h3>
        <Formula>{`APY = (1 + APR ÷ eras per year) ^ eras per year − 1`}</Formula>
        <p>
          APR assumes you withdraw rewards; APY assumes you re-stake them every era. On Polymesh
          that is a setting on your account, so the difference is real money rather than a
          presentational choice.
        </p>

        <h3 className="mt-6 mb-2 text-[17px] leading-6 font-semibold">Averages</h3>
        <p>
          The <strong>network average APR</strong> is total nominator rewards over total stake — not
          the average of each operator&rsquo;s APR, which would weight a small operator the same as
          a large one and overstate what the network actually paid.
        </p>
        <p>
          The <strong>average commission</strong> is weighted by reward points, so a tiny operator
          charging 100% does not move it as much as a large, productive one charging 5%.
        </p>
      </Section>

      <Section id="inflation" title="Inflation and the reward curve">
        <p>
          Annual inflation depends on what fraction of the total supply is staked. Below the ideal
          ratio inflation rises to attract stake; above it, inflation decays to discourage
          over-staking.
        </p>
        <Formula>{`x        = fraction of supply staked
I(x)     = I₀ + (I_ideal − I₀) × x ÷ x_ideal                for x ≤ x_ideal
         = I₀ + (I_ideal − I₀) × 2 ^ ((x_ideal − x) ÷ decay) for x > x_ideal

I₀       = ${pct(REWARD_CURVE.i0)}    inflation with nothing staked
x_ideal  = ${pct(REWARD_CURVE.xIdeal)}     the ratio the curve targets
I_ideal  = ${pct(REWARD_CURVE.iIdeal)}     inflation at the ideal ratio (the maximum)
decay    = ${pct(REWARD_CURVE.decay)}      decay constant above the ideal`}</Formula>
        <p>
          Polymesh also caps total annual issuance at a fixed amount, so realised inflation is the{' '}
          <em>lesser</em> of the curve and that cap. Ignoring the cap overstates APR whenever supply
          is large enough for it to bind, which is the regime the network is currently in — so every
          figure on this site applies it.
        </p>
        <Formula>{`inflation = min( I(x), fixed yearly reward ÷ total issuance )
APR       = inflation ÷ x`}</Formula>
      </Section>

      <Section id="charts" title="How to read the charts">
        <dl>
          <Term term="The shaded band">
            The range from the 10th to the 90th percentile across all operators. It shows what
            &ldquo;normal&rdquo; looked like that era, so a single operator&rsquo;s line can be
            judged against the field rather than in isolation.
          </Term>
          <Term term="Why only a few operators are drawn">
            Around a hundred operators are active. Drawing them all as separate coloured lines
            produces something unreadable, so we draw the distribution as a band, plus up to eight
            operators you choose. Use <em>Show all operators</em> for a grid of small charts when
            you want to scan everyone at once.
          </Term>
          <Term term="Colours are stable">
            An operator keeps the same colour across every chart and does not change when you filter
            or reorder. Colour is never the only way a series is identified — there is always a
            label or a table.
          </Term>
          <Term term="Every chart has a table">
            Switch any chart to <em>Table</em> to read the underlying numbers, or to copy them.
          </Term>
          <Term term="Absent is not zero">
            Where an operator was not in the active set, its line breaks rather than dropping to
            zero. Those two things mean different things and averaging them together would be wrong.
          </Term>
        </dl>
      </Section>

      <Section id="glossary" title="Glossary">
        <dl>
          <Term term="Era">
            The accounting period for staking rewards — 24 hours on Polymesh mainnet. Rewards, and
            any penalties, are calculated per era.
          </Term>
          <Term term="Session (epoch)">
            A shorter period within an era, used to rotate block-production duties. Several sessions
            make up one era.
          </Term>
          <Term term="Operator (validator)">
            A node that produces blocks and validates the chain. On Polymesh, operators are
            permissioned — they must be approved before they can run.
          </Term>
          <Term term="Nominator">
            A POLYX holder who backs one or more operators with their stake and shares in the
            rewards those operators earn.
          </Term>
          <Term term="Reward points">
            Credit an operator earns for producing blocks and other useful work in an era. An
            operator&rsquo;s share of the era reward is its share of total points.
          </Term>
          <Term term="Commission">
            The share of rewards an operator keeps before distributing the rest to its nominators.
          </Term>
          <Term term="Exposure">
            The total stake backing an operator in a given era: its own stake plus everything
            nominated to it.
          </Term>
          <Term term="Own stake (self-stake)">
            The portion of an operator&rsquo;s exposure that is its own POLYX — a rough measure of
            how much skin it has in the game.
          </Term>
          <Term term="Oversubscribed">
            Only a limited number of nominators per operator are paid each era. Beyond that limit a
            nominator earns <strong>nothing</strong>, so this is the difference between staking and
            only appearing to stake.
          </Term>
          <Term term="Stash and controller">
            The stash account holds the bonded funds; the controller account manages them. They are
            often the same account.
          </Term>
          <Term term="Bonding and unbonding">
            Bonding locks POLYX for staking. Unbonding starts a waiting period before the funds can
            be withdrawn.
          </Term>
          <Term term="Chilled">
            An operator that has stopped declaring an intention to validate, and so will not be
            elected.
          </Term>
          <Term term="Slashing">
            A penalty applied to an operator and its nominators for misbehaviour, such as being
            offline or signing conflicting blocks.
          </Term>
          <Term term="Nakamoto coefficient">
            The smallest number of operators whose combined stake exceeds a third of the total —
            enough, in principle, to disrupt the chain. Higher is more decentralised.
          </Term>
          <Term term="Gini coefficient / HHI">
            Two measures of how unevenly stake is spread. 0 means perfectly even; 1 means one
            operator holds everything.
          </Term>
        </dl>
      </Section>

      <Section id="limits" title="Known limitations">
        <ul className="ms-5 list-disc space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li>
            Total issuance is not stored per era on chain, so the staking-ratio series uses the
            issuance recorded when each era was ingested. It is accurate going forward and
            approximate for any history added retrospectively.
          </li>
          <li>
            The chain keeps only a limited number of past eras in state. History accumulates from
            when this site first started recording, and each chart states the range it covers.
          </li>
          <li>
            Active-era figures are up to 15 minutes old and are labelled accordingly. Era progress
            and countdowns are derived continuously and are not subject to that delay.
          </li>
          <li>
            This is a read-only analytics site. It never asks for a signature and cannot move your
            funds.
          </li>
        </ul>
      </Section>

      <p className="mt-12 text-sm" style={{ color: 'var(--text-muted)' }}>
        Found a mistake in the arithmetic? Please{' '}
        <a href={`${SITE.repository}/issues`} target="_blank" rel="noreferrer noopener">
          open an issue
        </a>
        . Corrections to the methodology are the most useful contribution you can make.{' '}
        <Link href="/">Back to the dashboard</Link>.
      </p>
    </main>
  );
}
