import {
  ErasOperatorsAprIncCommissionChart,
  ErasOperatorsPercentOfPointsChart,
  ErasOperatorsRewardsChart,
  ErasOperatorsAprChart,
  ErasOperatorsCommissionChart,
  ErasOperatorsPointsChart,
  ErasOperatorsPointDeviationsFromAverageChart,
  ErasOperatorsTotalStakedChart,
  PointCommissionAdjustedDeviationsFromAverage,
} from '../../components/chartsNoSSR';

function App() {
  return (
    <div className='App'>
      <>
        <ErasOperatorsAprIncCommissionChart />
        <ErasOperatorsAprChart />
        <ErasOperatorsTotalStakedChart />
        <ErasOperatorsPointsChart />
        <ErasOperatorsPointDeviationsFromAverageChart />
        <PointCommissionAdjustedDeviationsFromAverage />
        <ErasOperatorsPercentOfPointsChart />
        <ErasOperatorsRewardsChart />
        <ErasOperatorsCommissionChart />
      </>
    </div>
  );
}

export default App;
