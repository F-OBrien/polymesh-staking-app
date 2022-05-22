import { ErasAverageAprChart, ErasPointsTotalsChart, ErasRewardsTotalsChart, ErasTotalsStakedChart, RewardCurve } from '../../components/chartsNoSSR';

function App() {
  return (
    <div className='App'>
      <>
        <RewardCurve />
        <ErasAverageAprChart />
        <ErasTotalsStakedChart />
        <ErasPointsTotalsChart />
        <ErasRewardsTotalsChart />
      </>
    </div>
  );
}

export default App;
