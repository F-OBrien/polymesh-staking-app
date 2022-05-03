import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { defaultChartOptions } from '../../../constants/constants';
import { useErasRewards } from '../../../hooks/StakingQueries';
import { useSdk } from '../../../hooks/useSdk';

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

  const erasRewards = useErasRewards({ enabled: true });
  const {
    chainData: { tokenDecimals, tokenSymbol },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const chartOptions = useMemo(() => {
    // Make a copy of the default options.
    // @ts-ignore - typescript doens't yet recognise this function. TODO remove ignore once supported
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
    return false;
  }, []);

  useEffect(() => {
    if (!erasRewards.data || !divisor) {
      return;
    }

    async function getRewardData() {
      let labels: string[] = [];
      let rewardChartData: { datasets: any; labels: string[] };
      let rewards: number[] = [];
      // Read all era rewards
      const allErasRewards = erasRewards.data;

      allErasRewards?.forEach(({ era, eraReward }, index) => {
        if (eraReward.toNumber()) {
          // Build array of x-axis labels with eras.
          labels[index] = era.toString();
          rewards[index] = eraReward.toNumber() / divisor!;
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
    }
    getRewardData();
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
