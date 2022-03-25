import dynamic from 'next/dynamic';

// For Next.js Charts must be dynamically imported without Server Side
// Rendering to prevent 'Reference error window is not defined'
export const ErasOperatorsPointsChart = dynamic(
  () => {
    return import('./charts/ErasOperatorsPointsChart');
  },
  { ssr: false }
);

export const ErasPointsTotalsChart = dynamic(
  () => {
    return import('./charts/ErasPointsTotalsChart');
  },
  { ssr: false }
);

export const ErasOperatorsPercentOfPointsChart = dynamic(
  () => {
    return import('./charts/ErasOperatorsPercentOfPointsChart');
  },
  { ssr: false }
);

export const ErasRewardsTotalsChart = dynamic(
  () => {
    return import('./charts/ErasRewardsTotalsChart');
  },
  { ssr: false }
);

export const ErasAverageAprChart = dynamic(
  () => {
    return import('./charts/ErasAverageAprChart');
  },
  { ssr: false }
);

export const ErasTotalsStakedChart = dynamic(
  () => {
    return import('./charts/ErasTotalsStakedChart');
  },
  { ssr: false }
);

export const ErasOperatorsRewardsChart = dynamic(
  () => {
    return import('./charts/ErasOperatorsRewardsChart');
  },
  { ssr: false }
);

export const ErasOperatorsTotalStakedChart = dynamic(
  () => {
    return import('./charts/ErasOperatorsTotalStakedChart');
  },
  { ssr: false }
);

export const ErasOperatorsAprChart = dynamic(
  () => {
    return import('./charts/ErasOperatorsAprChart');
  },
  { ssr: false }
);

export const ErasOperatorsCommissionChart = dynamic(
  () => {
    return import('./charts/ErasOperatorsCommissionChart');
  },
  { ssr: false }
);

export const ErasOperatorsAprIncCommissionChart = dynamic(
  () => {
    return import('./charts/ErasOperatorsAprIncCommissionChart');
  },
  { ssr: false }
);
