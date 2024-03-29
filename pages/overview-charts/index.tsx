import FineCurves from '../../components/charts/overviewCharts/FineCurves';
import { ErasAverageAprChart, ErasPointsTotalsChart, ErasRewardsTotalsChart, ErasTotalsStakedChart, RewardCurve } from '../../components/chartsNoSSR';

function App() {
  return (
    <div className='App'>
      <>
        <RewardCurve />
        <FineCurves />
        <ErasAverageAprChart />
        <ErasTotalsStakedChart />
        <ErasPointsTotalsChart />
        <ErasRewardsTotalsChart />
      </>
    </div>
  );
}

export default App;
