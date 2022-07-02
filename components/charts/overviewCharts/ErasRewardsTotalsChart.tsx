import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { defaultChartOptions } from '../../../constants/constants';
import { useSdk } from '../../../hooks/useSdk';
import { useErasRewards } from '../../../hooks/StakingQueries';
import { useStakingContext } from '../../../hooks/useStakingContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

const ErasRewardsTotalsChart = () => {
  // Define reference for tracking mounted state
  const mountedRef = useRef(false);
  // Effect for tracking mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [chartData, setChartData] = useState<ChartData<'line'>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const erasRewards = useErasRewards({ enabled: fetchQueries });
  const {
    chainData: { tokenDecimals, tokenSymbol },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;
  const {
    eraInfo: { activeEra },
  } = useStakingContext();

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const chartOptions = useMemo(() => {
    // Make a copy of the default options.
    const options = structuredClone(defaultChartOptions);
    // Override defaults with chart specific options.
    options.scales.x.title.text = 'Era';
    options.scales.y.title.text = `Reward [${tokenSymbol}]`;
    options.plugins.title.text = `Total ${tokenSymbol} Rewards per Era`;
    options.plugins.legend.display = false;

    return options;
  }, [tokenSymbol]);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return erasRewards.isFetching;
  }, [erasRewards.isFetching]);

  // If the era changes or if data is missing set `fetchQueries` to true to trigger fetching/refetching all data.
  useEffect(() => {
    if (erasRewards.isFetching || !mountedRef.current) return;

    if (!erasRewards.data) {
      setFetchQueries(true);
      return;
    }
    // Check we have up to date data.
    // If any of the data is not latest re-enable fetching queries.
    if (activeEra.toNumber() - 1 > erasRewards.data![erasRewards.data!.length - 1].era.toNumber()) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [activeEra, erasRewards.data, erasRewards.isFetching]);

  useEffect(() => {
    if (!erasRewards.data) {
      return;
    }

    let labels: string[] = [];
    let rewardChartData: { datasets: any; labels: string[] };
    let rewards: number[] = [];
    // Read all era rewards
    const allErasRewards = erasRewards.data;

    allErasRewards?.forEach(({ era, reward }, index) => {
      if (reward.toNumber()) {
        // Build array of x-axis labels with eras.
        labels[index] = era.toString();
        rewards[index] = reward.toNumber() / divisor!;
      }
    });

    // Create chart datasets
    rewardChartData = {
      labels,
      datasets: [
        {
          label: 'Era Total Rewards',
          data: rewards,
          borderColor: 'rgb(200,0,0)',
          backgroundColor: 'rgba(200,0,0,0.5)',
          borderWidth: 2,
          pointRadius: 2,
          yAxisID: 'y',
        },
      ],
    };

    // Before setting the chart data ensure the component is still mounted
    if (mountedRef.current) {
      setChartData(rewardChartData);
    }
    return;
  }, [divisor, erasRewards.data]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Line ref={chartRef} options={chartOptions} data={chartData} />
          <button className='resetZoomButton' onClick={resetChartZoom}>
            Reset Zoom
          </button>
          {dataIsFetching ? <MiniSpinner /> : <></>}
        </>
      ) : (
        <>
          <Spinner />
        </>
      )}
    </div>
  );
};

export default ErasRewardsTotalsChart;
