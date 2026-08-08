import {
  ErasOperatorsAprIncCommissionChart,
  ErasOperatorsPercentOfPointsChart,
  ErasOperatorsRewardsChart,
  ErasOperatorsAprChart,
  ErasOperatorsCommissionChart,
  ErasOperatorsPointsChart,
  ErasOperatorsTotalStakedChart,
  OperatorRewards,
} from '../../components/chartsNoSSR';

function App() {
  return (
    <div className='App'>
      <>
        <ErasOperatorsAprIncCommissionChart />
        <ErasOperatorsAprChart />
        <OperatorRewards />
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
