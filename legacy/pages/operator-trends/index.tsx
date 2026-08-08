import { ChangeEvent, useState } from 'react';
import {
  ErasOperatorsPointDeviationsFromAverageChart,
  PointCommissionAdjustedDeviationsFromAverage,
  AprDeviationFromAverage,
} from '../../components/chartsNoSSR';

function App() {
  const [trendPeriod, setTrendPeriod] = useState<number>(0);

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setTrendPeriod(parseInt(e.target.value));
  };

  return (
    <div className='App'>
      <>
        <div className='chartOptionDiv'>
          <label htmlFor='trendEras'>Select trend period: </label>
          <select defaultValue={'0'} name='trended eras' id='trendEras' onChange={(e) => handleChange(e)}>
            <option value='7'>7 eras</option>
            <option value='14'>14 eras</option>
            <option value='28'>28 eras</option>
            <option value='42'>42 eras</option>
            <option value='56'>56 eras</option>
            <option value='70'>70 eras</option>
            <option value='0'>Max </option>
          </select>
        </div>
        <AprDeviationFromAverage trendPeriod={trendPeriod} />
        <ErasOperatorsPointDeviationsFromAverageChart trendPeriod={trendPeriod} />
        <PointCommissionAdjustedDeviationsFromAverage trendPeriod={trendPeriod} />
      </>
    </div>
  );
}

export default App;
