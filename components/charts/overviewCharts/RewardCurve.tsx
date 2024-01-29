import { Balance } from '@polkadot/types/interfaces';
import { useRef, useEffect, useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartData,
  ChartOptions,
  ScatterController,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { useSdk } from '../../../hooks/useSdk';
import { useEraTotalStaked } from '../../../hooks/StakingQueries';
import annotationPlugin from 'chartjs-plugin-annotation';
import { useStakingContext } from '../../../hooks/useStakingContext';
import { VoidFn } from '@polkadot/api/types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, annotationPlugin, ScatterController);

interface StakingMetrics {
  apr: number;
  inflation: number;
  apy: number;
}
// helper function to calculate rewards
const calculateInflationAndRates = (percentStaked: number, totalIssuance: number, fixedYearlyReward: Balance): StakingMetrics => {
  // Inflation and reward data based on formula:
  // Inflation(x) = I0 + (I_ideal - I0) * x / x_ideal  for 0 < x <= x_ideal
  //              = I0 + (I_ideal - I0) * 2 ^((x_ideal-x)/d) for x_ideal < x <= 1
  // Where:
  // x = ratio of staked tokens to token supply,
  // Inflation(x) = Annual inflation rate at staking ratio x,
  // I0 = limit of inflation at x=0 = 0.025 = 2.5%,
  // x_ideal = position of "ideal" staking ratio = 0.7 = 70%,
  // I_ideal = ideal inflation at x_ideal = 0.14 = 14% (maximum inflation),
  // d = decay rate for staking ratio > x_ideal = 0.05 = 5%,
  //
  // Reward(x) = Inflation(x) / x
  // Where:
  // Reward(x) = Annual reward rate at staking ratio x
  const xIdeal = 70; // Ideal Staked Percent of total supply.
  const iIdeal = 14; // Inflation at ideal staked percent.
  const iZero = 2.5; // Inflation at staked percent = 0%.
  const decay = 5; // decay for staked percent greater than the ideal

  const calculatedInflation =
    percentStaked <= xIdeal
      ? iZero + (iIdeal - iZero) * (percentStaked / xIdeal)
      : iZero + (iIdeal - iZero) * 2 ** ((xIdeal - percentStaked) / decay);

  const maxInflation = (100 * fixedYearlyReward.toNumber()) / totalIssuance; // Use 1 as fallback to avoid division by zero
  const inflation = Math.min(calculatedInflation, maxInflation);

  const apr = 100 * (inflation / percentStaked);
  const apy = 100 * ((1 + inflation / percentStaked / 365) ** 365 - 1);

  return { apr, inflation, apy };
};

const RewardCurve = () => {
  // Define reference for tracking mounted state
  const mountedRef = useRef(false);
  // Effect for tracking mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const {
    eraInfo: { activeEra },
    stakingConstants: { fixedYearlyReward },
  } = useStakingContext();

  const [chartData, setChartData] = useState<ChartData<'scatter'>>();
  const [totalIssuance, setTotalIssuance] = useState<Balance>();
  const activeEraTotalStaked = useEraTotalStaked(activeEra, { staleTime: Infinity });

  const {
    api,
    chainData: { tokenSymbol, tokenDecimals },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return activeEraTotalStaked.isFetching;
  }, [activeEraTotalStaked.isFetching]);

  // Subscribe to Total POLYX Issuance.
  useEffect(() => {
    if (!api.query.balances) {
      return;
    }
    let unsubPolyxSupply: VoidFn;

    const getTotalIssuance = async () => {
      unsubPolyxSupply = await api.query.balances.totalIssuance((total) => {
        // @ts-ignore
        setTotalIssuance(total);
      });
    };

    getTotalIssuance();

    return () => {
      unsubPolyxSupply && unsubPolyxSupply();
    };
  }, [api.isConnected, api.query.balances]);

  // Calculate percent of total staked, APR, APY and annual inflation.
  const { percentTotalStaked, apr, inflation, apy } = useMemo(() => {
    if (!totalIssuance || !activeEraTotalStaked.data || !fixedYearlyReward) return {};

    const percentTotalStaked = (100 * activeEraTotalStaked.data.toNumber()) / totalIssuance?.toNumber();

    const { apy, apr, inflation } = calculateInflationAndRates(percentTotalStaked, totalIssuance.toNumber(), fixedYearlyReward);

    return { percentTotalStaked, apr, inflation, apy };
  }, [activeEraTotalStaked.data, fixedYearlyReward, totalIssuance]);

  // Generate curves
  const { inflationCurve, rewardCurve, apyRewardCurve } = useMemo(() => {
    if (!totalIssuance || !fixedYearlyReward) return {};

    const inflationCurve: { x: number; y: number }[] = [];
    const rewardCurve: { x: number; y: number }[] = [];
    const apyRewardCurve: { x: number; y: number }[] = [];

    const stepSize = 0.1;

    for (let percentStaked = 0; percentStaked <= 100; percentStaked += stepSize) {
      const { inflation, apr, apy } = calculateInflationAndRates(percentStaked, totalIssuance.toNumber(), fixedYearlyReward);
      inflationCurve.push({ x: percentStaked, y: inflation });
      rewardCurve.push({ x: percentStaked, y: apr });
      apyRewardCurve.push({ x: percentStaked, y: apy });
    }

    return { inflationCurve, rewardCurve, apyRewardCurve };
  }, [fixedYearlyReward, totalIssuance]);

  // Set the chart options including annotation.
  const chartOptions = useMemo(() => {
    if (!apr || !inflation || !percentTotalStaked || !activeEraTotalStaked.data || !totalIssuance) return;

    const options: ChartOptions<'scatter'> = {
      showLine: true,
      interaction: { intersect: false, mode: 'nearest', axis: 'x' },
      scales: {
        x: {
          title: { display: true, text: `Percent of Total ${tokenSymbol} Staked` },
          ticks: {
            callback: function (value) {
              return value + '%';
            },
          },
        },
        y: {
          max: 50,
          ticks: {
            callback: function (value) {
              return value + '%';
            },
          },
        },
      },
      hover: {
        mode: 'point' as const,
      },
      elements: { point: { hoverRadius: 0 } },
      plugins: {
        title: {
          display: true,
          text: `Polymesh Staking Reward / Inflation Curve`,
        },
        legend: {
          display: true,
          position: 'bottom' as const,
          labels: {
            usePointStyle: true,
            pointStyle: 'line',
          },
        },
        annotation: {
          annotations: {
            line1: {
              type: 'line',
              yMin: 0,
              yMax: apy,
              xMin: percentTotalStaked,
              xMax: percentTotalStaked,
              borderColor: '#170087',
              borderWidth: 3,
              borderDash: [5, 5],
              label: {
                position: '20%',
                backgroundColor: '#170087',
                content: `${percentTotalStaked.toFixed(3)} %`,
                display: true,
              },
            },
            point1: {
              type: 'point',
              xValue: percentTotalStaked,
              yValue: inflation,
              radius: 3,
              borderColor: '#EC4673',
              backgroundColor: '#EC4673',
              borderWidth: 3,
            },
            point2: {
              type: 'point',
              xValue: percentTotalStaked,
              yValue: apr,
              radius: 3,
              borderColor: '#D557EA',
              backgroundColor: '#D557EA',
              borderWidth: 3,
            },
            point3: {
              type: 'point',
              xValue: percentTotalStaked,
              yValue: apy,
              radius: 3,
              borderColor: '#60D3CB',
              backgroundColor: '#60D3CB',
              borderWidth: 3,
            },
            line2: {
              type: 'line',
              yMin: apr,
              yMax: apr,
              xMin: 0,
              xMax: percentTotalStaked,
              borderColor: '#D557EA',
              borderWidth: 3,
              borderDash: [5, 5],
              label: {
                position: '50%',
                backgroundColor: '#D557EA',
                content: `APR: ${apr.toFixed(3)} %`,
                display: true,
              },
            },
            line3: {
              type: 'line',
              yMin: inflation,
              yMax: inflation,
              xMin: 0,
              xMax: percentTotalStaked,
              borderColor: '#EC4673',
              borderWidth: 3,
              borderDash: [5, 5],
              label: {
                position: '20%',
                backgroundColor: '#EC4673',
                content: `Inflation: ${inflation.toFixed(3)} %`,
                display: true,
              },
            },
            line4: {
              type: 'line',
              yMin: apy,
              yMax: apy,
              xMin: 0,
              xMax: percentTotalStaked,
              borderColor: '#60D3CB',
              borderWidth: 3,
              borderDash: [5, 5],
              label: {
                position: '20%',
                backgroundColor: '#60D3CB',
                content: `APY: ${apy.toFixed(3)} %`,
                display: true,
              },
            },
            label1: {
              type: 'label',
              position: { x: 'end', y: 'start' },
              xValue: 99.9,
              yValue: 49.9,
              backgroundColor: 'white',
              content: [
                `Total Staked: ${(activeEraTotalStaked.data.toNumber() / divisor).toLocaleString('en-US')} ${tokenSymbol}`,
                `Total Issuance: ${(totalIssuance.toNumber() / divisor).toLocaleString('en-US')} ${tokenSymbol}`,
              ],
              textAlign: 'right',
            },
          },
        },
      },
    };

    return options;
  }, [activeEraTotalStaked.data, apr, apy, divisor, inflation, percentTotalStaked, tokenSymbol, totalIssuance]);

  // Set chart data.
  useEffect(() => {
    if (!apr || !inflation) {
      return;
    }

    let rewardCurveChartData: { datasets: any };

    // Create chart datasets
    rewardCurveChartData = {
      datasets: [
        {
          label: 'APY',
          data: apyRewardCurve,
          borderColor: '#60D3CB',
          backgroundColor: '#60D3CB',
          borderWidth: 3,
          pointRadius: 0,
          yAxisID: 'y',
        },
        {
          label: 'APR',
          data: rewardCurve,
          borderColor: '#D557EA',
          backgroundColor: '#D557EA',
          borderWidth: 3,
          pointRadius: 0,
          yAxisID: 'y',
        },
        {
          label: 'Inflation',
          data: inflationCurve,
          borderColor: '#EC4673',
          backgroundColor: '#EC4673',
          borderWidth: 3,
          pointRadius: 0,
          yAxisID: 'y',
        },
      ],
    };

    // Before setting the chart data ensure the component is still mounted
    if (mountedRef.current) {
      setChartData(rewardCurveChartData);
    }
    return;
  }, [activeEraTotalStaked.data, apr, apyRewardCurve, inflation, inflationCurve, rewardCurve, totalIssuance]);

  return (
    <div className='LineChart'>
      {chartData && chartOptions ? (
        <>
          <Chart type='scatter' options={chartOptions} data={chartData} />
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

export default RewardCurve;
