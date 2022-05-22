import {
  ErasOperatorsAprIncCommissionChart,
  ErasOperatorsPercentOfPointsChart,
  ErasOperatorsRewardsChart,
  ErasOperatorsAprChart,
  ErasOperatorsCommissionChart,
  ErasOperatorsPointsChart,
  ErasOperatorsPointDeviationsFromAverageChart,
  ErasOperatorsTotalStakedChart,
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
        <ErasOperatorsPercentOfPointsChart />
        <ErasOperatorsRewardsChart />
        <ErasOperatorsCommissionChart />
      </>
    </div>
  );
}

export default App;
