import {
  ErasOperatorsAprIncCommissionChart,
  ErasOperatorsPercentOfPointsChart,
  ErasOperatorsRewardsChart,
  ErasOperatorsAprChart,
  ErasOperatorsCommissionChart,
  ErasOperatorsPointsChart,
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
        <ErasOperatorsPercentOfPointsChart />
        <ErasOperatorsRewardsChart />
        <ErasOperatorsCommissionChart />
      </>
    </div>
  );
}

export default App;
