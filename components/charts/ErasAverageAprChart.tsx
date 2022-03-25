import { useRef, useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner from '../Spinner';
import { defaultChartZoomOptions } from '../../constants/constants';
import { useSdk } from '../../hooks/useSdk';
import { useErasPrefs, useErasRewards, useErasTotalStake } from '../../hooks/StakingQueries';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

const chartOptions = {
  responsive: true,
  scales: {
    x: { title: { display: true, text: 'Era' } },
    y: { title: { display: true, text: `Percent [%]` } },
  },
  plugins: {
    title: {
      display: true,
      text: `Average APR / APY per Era`,
      font: { size: 20 },
    },
    legend: {
      position: 'bottom' as const,
      labels: {
        usePointStyle: true,
        pointStyle: 'line',
      },
    },
    zoom: defaultChartZoomOptions,
  },
};

const ErasAverageAprChart = () => {
  // Define reference for tracking mounted state
  const mountedRef = useRef(false);
  // Effect for tracking mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { api } = useSdk();
  const [chartData, setChartData] = useState<any>();
  const [showMiniSpinner, setShowMiniSpinner] = useState<boolean>(false);
  const eraRewards = useErasRewards();
  const erasPrefs = useErasPrefs({ enabled: false });
  const erasTotals = useErasTotalStake();

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  useEffect(() => {
    if (!api || !eraRewards.data || !erasPrefs.data) {
      return;
    }

    // Read all era points
    const allErasPrefs = erasPrefs.data;
    let averageCommission: number[] = [];

    allErasPrefs?.forEach(({ validators }, index) => {
      let sum = 0;
      // build array of points for each validator
      Object.entries(validators).forEach(([, { commission }]) => {
        sum = sum + commission.toNumber();
      });
      averageCommission[index] = sum / (1000000000 * Object.keys(validators).length);
    });

    async function getAverageAprData() {
      let labels: string[] = [];
      let averageAprChartData: { datasets: any; labels: string[] };
      let apr: number[] = [];
      let aprIncCommission: number[] = [];
      let apy: number[] = [];
      let apyIncCommission: number[] = [];

      let totals = new Map();
      // Read all era rewards
      const allErasRewards = eraRewards.data;
      const allErasTotalStake = await api?.query.staking.erasTotalStake.entries();

      allErasTotalStake?.forEach(
        ([
          {
            args: [eraIndex],
          },
          totalStaked,
        ]) => {
          totals.set(eraIndex.toString(), totalStaked);
        }
      );

      allErasRewards?.forEach(({ era, eraReward }, index) => {
        // Ensure there is a corresponding Total value for the era.
        if (totals.get(era.toString())) {
          // Build array of x-axis lables with eras.
          labels[index] = era.toString();
          // Build array of y-axis values
          apr[index] = (365 * 100 * eraReward.toNumber()) / totals.get(era.toString()).toNumber();
          aprIncCommission[index] = apr[index] * (1 - averageCommission[index]);
          apy[index] = 100 * ((1 + eraReward.toNumber() / totals.get(era.toString()).toNumber()) ** 365 - 1);
          apyIncCommission[index] =
            100 * ((1 + ((1 - averageCommission[index]) * eraReward.toNumber()) / totals.get(era.toString()).toNumber()) ** 365 - 1);
        }
        // console.log(era.toNumber(), eraReward.toNumber(), total);
        // apr[index] =
        //     new BN(365 * 100 * 1000000)
        //         .mul(new BN(eraReward))
        //         .div(new BN(totals.get(era.toString()).toNumber()))
        //         .toNumber() / 1000000;
      });

      // Create chart datasets
      averageAprChartData = {
        labels,
        datasets: [
          {
            label: 'Average APR',
            data: apr,
            borderColor: 'rgb(0,0,255)',
            backgroundColor: 'rgba(0,0,255,0.5)',
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          },
          {
            label: 'Average APY',
            data: apy,
            borderColor: 'rgb(255,0,0)',
            backgroundColor: 'rgba(255,0,0,0.5)',
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          },
          {
            label: 'Average APR inc. Commission',
            data: aprIncCommission,
            borderColor: 'rgb(0,255,0)',
            backgroundColor: 'rgba(0,255,0,0.5)',
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          },
          {
            label: 'Average APY inc. Commission',
            data: apyIncCommission,
            borderColor: 'rgb(0,255,255)',
            backgroundColor: 'rgba(0,255,255,0.5)',
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          },
        ],
      };

      // Before setting the chart data ensure the component is still mounted
      if (mountedRef.current) {
        setChartData(averageAprChartData);
      }
      return;
    }

    getAverageAprData();
  }, [api, eraRewards.data, erasPrefs.data]);

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

export default ErasAverageAprChart;
