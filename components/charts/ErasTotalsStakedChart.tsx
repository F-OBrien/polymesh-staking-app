import { useRef, useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner from '../Spinner';
import { defaultChartZoomOptions } from '../../constants/constants';
import { useErasTotalStake } from '../../hooks/StakingQueries';
import { useSdk } from '../../hooks/useSdk';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

const ErasTotalsStakedChart = () => {
  // Define reference for tracking mounted state
  const mountedRef = useRef(false);
  // Effect for tracking mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [chartData, setChartData] = useState<any>();
  const [showMiniSpinner, setShowMiniSpinner] = useState<boolean>(false);
  const totalsQuery = useErasTotalStake();
  const {
    chainData: { tokenSymbol, tokenDecimals },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const chartOptions = {
    responsive: true,
    scales: {
      x: { title: { display: true, text: 'Era' } },
      y: { title: { display: true, text: `Amount [${tokenSymbol}]` } },
    },
    plugins: {
      title: {
        display: true,
        text: `Total ${tokenSymbol} Staked per Era`,
        font: { size: 20 },
      },
      legend: { display: false },
      zoom: defaultChartZoomOptions,
    },
  };

  useEffect(() => {
    if (!totalsQuery.data || !divisor) {
      return;
    }

    // setChartData(undefined);

    async function getTotalsStakedData() {
      let totalsStakedChartData: { datasets: any; labels: string[] };
      let totals: number[] = [];
      let labels: string[] = [];
      // let indexOffset: number;

      // Read all era totals staked
      const allErasTotalStake = totalsQuery.data;
      // const currentEra = await api?.query.staking.currentEra();
      // const historyDepth = (await api?.query.staking.historyDepth())!.toNumber();

      // Calculate the index offset for data arrays
      // if (currentEra?.isSome && historyDepth) {
      //   const era = currentEra.unwrap().toNumber();

      //   if (era > historyDepth) {
      //     indexOffset = era - historyDepth;
      //   } else {
      //     indexOffset = 0;
      //   }
      // }

      allErasTotalStake?.forEach(({ era, total }, index) => {
        totals[index] = total.toNumber() / divisor!;
        labels[index] = era.toString();
      });

      // Create chart datasets
      totalsStakedChartData = {
        labels,
        datasets: [
          {
            label: 'Total Staked',
            data: totals,
            borderColor: 'rgb(0,0,255)',
            backgroundColor: 'rgba(0,0,255,0.5)',
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          },
        ],
      };

      // Before setting the chart data ensure the component is still mounted
      if (mountedRef.current) {
        setChartData(totalsStakedChartData);
      }
      return;
    }

    getTotalsStakedData();
  }, [divisor, totalsQuery.data]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Line ref={chartRef} options={chartOptions} data={chartData} />
          <button className='resetZoomButton' onClick={resetChartZoom}>
            Reset Zoom
          </button>
        </>
      ) : (
        <>
          <Spinner />
        </>
      )}
    </div>
  );
};

export default ErasTotalsStakedChart;
