import dynamic from 'next/dynamic';

// For Next.js Charts must be dynamically imported without Server Side
// Rendering to prevent 'Reference error window is not defined'
export const ErasOperatorsPointsChart = dynamic(
  () => {
    return import('./charts/operatorCharts/ErasOperatorsPointsChart');
  },
  { ssr: false }
);

export const ErasOperatorsPointDeviationsFromAverageChart = dynamic(
  () => {
    return import('./charts/operatorCharts/ErasOperatorsPointDeviationsFromAverageChart');
  },
  { ssr: false }
);

export const PointCommissionAdjustedDeviationsFromAverage = dynamic(
  () => {
    return import('./charts/operatorCharts/PointCommissionAdjustedDeviationsFromAverage');
  },
  { ssr: false }
);

export const AprDeviationFromAverage = dynamic(
  () => {
    return import('./charts/operatorCharts/AprDeviationFromAverage');
  },
  { ssr: false }
);

export const ErasPointsTotalsChart = dynamic(
  () => {
    return import('./charts/overviewCharts/ErasPointsTotalsChart');
  },
  { ssr: false }
);

export const ErasOperatorsPercentOfPointsChart = dynamic(
  () => {
    return import('./charts/operatorCharts/ErasOperatorsPercentOfPointsChart');
  },
  { ssr: false }
);

export const ErasRewardsTotalsChart = dynamic(
  () => {
    return import('./charts/overviewCharts/ErasRewardsTotalsChart');
  },
  { ssr: false }
);

export const ErasAverageAprChart = dynamic(
  () => {
    return import('./charts/overviewCharts/ErasAverageAprChart');
  },
  { ssr: false }
);

export const ErasTotalsStakedChart = dynamic(
  () => {
    return import('./charts/overviewCharts/ErasTotalsStakedChart');
  },
  { ssr: false }
);

export const ErasOperatorsRewardsChart = dynamic(
  () => {
    return import('./charts/operatorCharts/ErasOperatorsRewardsChart');
  },
  { ssr: false }
);

export const ErasOperatorsTotalStakedChart = dynamic(
  () => {
    return import('./charts/operatorCharts/ErasOperatorsTotalStakedChart');
  },
  { ssr: false }
);

export const ErasOperatorsAprChart = dynamic(
  () => {
    return import('./charts/operatorCharts/ErasOperatorsAprChart');
  },
  { ssr: false }
);

export const ErasOperatorsCommissionChart = dynamic(
  () => {
    return import('./charts/operatorCharts/ErasOperatorsCommissionChart');
  },
  { ssr: false }
);

export const ErasOperatorsAprIncCommissionChart = dynamic(
  () => {
    return import('./charts/operatorCharts/ErasOperatorsAprIncCommissionChart');
  },
  { ssr: false }
);

export const OperatorsTokensNominated = dynamic(
  () => {
    return import('./charts/operatorCharts/OperatorsTokensNominated');
  },
  { ssr: false }
);

export const OperatorsTokensAssigned = dynamic(
  () => {
    return import('./charts/operatorCharts/OperatorsTokensAssigned');
  },
  { ssr: false }
);

export const OperatorsActiveEraPoints = dynamic(
  () => {
    return import('./charts/operatorCharts/OperatorsActiveEraPoints');
  },
  { ssr: false }
);

export const RewardCurve = dynamic(
  () => {
    return import('./charts/overviewCharts/RewardCurve');
  },
  { ssr: false }
);

export const OperatorRewards = dynamic(
  () => {
    return import('./charts/operatorCharts/OperatorsRewards');
  },
  { ssr: false }
);
