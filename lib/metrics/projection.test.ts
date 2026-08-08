import { describe, expect, it } from 'vitest';
import { assumptions, project } from './projection';

const BASE = { amount: 10_000, apr: 0.12, days: 365, erasPerYear: 365, compound: false } as const;

describe('project', () => {
  it('gives simple interest over a year when not compounding', () => {
    const { reward } = project({ ...BASE });
    expect(reward.mid).toBeCloseTo(1200, 6);
  });

  it('gives more than simple interest when compounding', () => {
    const simple = project({ ...BASE }).reward.mid;
    const compounded = project({ ...BASE, compound: true }).reward.mid;
    expect(compounded).toBeGreaterThan(simple);
    // (1 + 0.12/365)^365 - 1 ≈ 0.12747
    expect(compounded).toBeCloseTo(10_000 * ((1 + 0.12 / 365) ** 365 - 1), 6);
  });

  it('reports APY equal to APR when not compounding', () => {
    // Not merely cosmetic: showing a compounded APY beside an uncompounded
    // projection would contradict the number directly above it.
    const { apr, apy } = project({ ...BASE, aprStdDev: 0.02 });
    expect(apy).toEqual(apr);
  });

  it('reports a compounded APY when compounding', () => {
    expect(project({ ...BASE, compound: true }).apy.mid).toBeGreaterThan(0.12);
  });

  it('compounds every point of the band, so the headline stays inside its range', () => {
    // The bug this guards: the headline read `apy` while the range beside it
    // read `apr`, so a compounded 33.1% appeared outside a 28.0–29.2% range.
    const { apy } = project({ ...BASE, aprStdDev: 0.02, compound: true });
    expect(apy.low).toBeLessThan(apy.mid);
    expect(apy.mid).toBeLessThan(apy.high);
    expect(apy.low).toBeGreaterThan(0.1);
  });

  it('widens the band by one standard deviation either side', () => {
    const { apr, reward } = project({ ...BASE, aprStdDev: 0.02 });
    expect(apr.low).toBeCloseTo(0.1, 12);
    expect(apr.high).toBeCloseTo(0.14, 12);
    expect(reward.low).toBeCloseTo(1000, 6);
    expect(reward.high).toBeCloseTo(1400, 6);
  });

  it('floors the low end of the band at zero rather than going negative', () => {
    // A high-variance, low-return operator should bottom out at "earns
    // nothing", not at "loses money" — losses come from slashing, not APR.
    const { apr, reward } = project({ ...BASE, apr: 0.03, aprStdDev: 0.05 });
    expect(apr.low).toBe(0);
    expect(reward.low).toBe(0);
  });

  it('collapses the band when no variance is supplied', () => {
    for (const sigma of [undefined, null, 0]) {
      const { reward } = project({ ...BASE, aprStdDev: sigma });
      expect(reward.low).toBeCloseTo(reward.mid, 12);
      expect(reward.high).toBeCloseTo(reward.mid, 12);
    }
  });

  it('treats a negative supplied deviation as its magnitude', () => {
    const negative = project({ ...BASE, aprStdDev: -0.02 });
    const positive = project({ ...BASE, aprStdDev: 0.02 });
    expect(negative.reward.low).toBeCloseTo(positive.reward.low, 12);
  });

  it('counts whole eras only', () => {
    // Rewards accrue per completed era, so half an era earns nothing.
    expect(project({ ...BASE, days: 30 }).eras).toBe(30);
    expect(project({ ...BASE, days: 1, erasPerYear: 180 }).eras).toBe(0);
  });

  it('scales eras by the chain’s actual era length, not by days', () => {
    // 24h eras on mainnet, but the constant is read from chain and must not be
    // assumed: at 180 eras/year a year is 180 eras, not 365.
    expect(project({ ...BASE, erasPerYear: 180 }).eras).toBe(180);
  });

  it('earns nothing over a zero-day horizon', () => {
    const { reward, total } = project({ ...BASE, days: 0 });
    expect(reward.mid).toBe(0);
    expect(total.mid).toBe(10_000);
  });

  it('earns nothing on a zero or negative amount', () => {
    expect(project({ ...BASE, amount: 0 }).reward.mid).toBe(0);
    expect(project({ ...BASE, amount: -100 }).reward.mid).toBe(0);
  });

  it('adds the reward to the bonded amount at every point of the band', () => {
    const { reward, total } = project({ ...BASE, aprStdDev: 0.02 });
    expect(total.low).toBeCloseTo(10_000 + reward.low, 6);
    expect(total.mid).toBeCloseTo(10_000 + reward.mid, 6);
    expect(total.high).toBeCloseTo(10_000 + reward.high, 6);
  });
});

describe('assumptions', () => {
  it('names the operator so the figure is attributable', () => {
    const lines = assumptions({ compound: false, hasVariance: true, operatorLabel: 'Assetera 1' });
    expect(lines[0]).toContain('Assetera 1');
  });

  it('names the operator in the range note too, not "that operator"', () => {
    // Reads wrongly when the basis is the network average rather than an
    // operator, which is the default state of the page.
    const lines = assumptions({
      compound: false,
      hasVariance: true,
      operatorLabel: 'the network average',
    });
    expect(lines.some((l) => l.includes("the network average's era-to-era return"))).toBe(true);
  });

  it('says compounding is an upper bound only when compounding', () => {
    const on = assumptions({ compound: true, hasVariance: true, operatorLabel: 'x' });
    const off = assumptions({ compound: false, hasVariance: true, operatorLabel: 'x' });
    expect(on.some((l) => l.includes('upper bound'))).toBe(true);
    expect(off.some((l) => l.includes('upper bound'))).toBe(false);
  });

  it('explains a missing range rather than staying silent about it', () => {
    const lines = assumptions({ compound: false, hasVariance: false, operatorLabel: 'x' });
    expect(lines.some((l) => l.includes('not enough history'))).toBe(true);
  });

  it('always mentions slashing, commission changes and the staking ratio', () => {
    const lines = assumptions({ compound: false, hasVariance: true, operatorLabel: 'x' }).join(' ');
    expect(lines).toContain('slashing');
    expect(lines).toContain('commission');
    expect(lines).toContain('staking ratio');
  });
});
