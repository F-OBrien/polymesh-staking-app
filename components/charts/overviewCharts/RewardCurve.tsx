import { Balance } from '@polkadot/types/interfaces';
import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData, ChartOptions } from 'chart.js';
import { Chart } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { inflationCurve, rewardCurve, apyRewardCurve } from '../../../constants/rewardCurve';
import { useSdk } from '../../../hooks/useSdk';
import { useEraTotalStaked } from '../../../hooks/StakingQueries';
import annotationPlugin from 'chartjs-plugin-annotation';
import { useStakingContext } from '../../../hooks/useStakingContext';
import { VoidFn } from '@polkadot/api/types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, annotationPlugin);

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
    stakingConstants: { fixedYearlyReward, maxVariableInflationTotalIssuance },
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
    if (!totalIssuance || !activeEraTotalStaked.data) return {};

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

    const percentTotalStaked = (100 * activeEraTotalStaked.data.toNumber()) / totalIssuance?.toNumber();

    let inflation;

    if (totalIssuance?.toNumber() < maxVariableInflationTotalIssuance.toNumber()) {
      if (percentTotalStaked <= xIdeal) {
        inflation = iZero + (iIdeal - iZero) * (percentTotalStaked / xIdeal);
      } else {
        inflation = iZero + (iIdeal - iZero) * 2 ** ((xIdeal - percentTotalStaked) / decay);
      }
    } else {
      inflation = (100 * fixedYearlyReward.toNumber()) / totalIssuance?.toNumber();
    }
    const apr = 100 * (inflation / percentTotalStaked);
    const apy = 100 * ((1 + inflation / percentTotalStaked / 365) ** 365 - 1);

    return { percentTotalStaked, apr, inflation, apy };
  }, [totalIssuance, activeEraTotalStaked.data, maxVariableInflationTotalIssuance, fixedYearlyReward]);

  // Set the chart options including annotation.
  const chartOptions = useMemo(() => {
    if (!apr || !inflation || !percentTotalStaked || !activeEraTotalStaked.data || !totalIssuance) return;

    const options: ChartOptions<'scatter'> = {
      responsive: true,
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
          font: { size: 20 },
        },
        legend: {
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
              yMin: apr,
              yMax: apr,
              xMin: 0,
              xMax: percentTotalStaked,
              borderColor: 'blue',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                backgroundColor: 'blue',
                content: `APR: ${apr.toFixed(3)} %`,
                display: true,
              },
            },
            line2: {
              type: 'line',
              yMin: 0,
              yMax: apy,
              xMin: percentTotalStaked,
              xMax: percentTotalStaked,
              borderColor: 'black',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                backgroundColor: 'black',
                content: `${percentTotalStaked.toFixed(3)} %`,
                display: true,
              },
            },
            line3: {
              type: 'line',
              yMin: inflation,
              yMax: inflation,
              xMin: 0,
              xMax: percentTotalStaked,
              borderColor: 'red',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                backgroundColor: 'red',
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
              borderColor: 'green',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                backgroundColor: 'green',
                content: `APY: ${apy.toFixed(3)} %`,
                display: true,
              },
            },

            point1: {
              type: 'point',
              xValue: percentTotalStaked,
              yValue: inflation,
              radius: 3,
              borderColor: 'red',
              backgroundColor: 'red',
              borderWidth: 2,
            },
            point2: {
              type: 'point',
              xValue: percentTotalStaked,
              yValue: apr,
              radius: 3,
              borderColor: 'blue',
              backgroundColor: 'blue',
              borderWidth: 2,
            },
            point3: {
              type: 'point',
              xValue: percentTotalStaked,
              yValue: apy,
              radius: 3,
              borderColor: 'green',
              backgroundColor: 'green',
              borderWidth: 2,
            },
            label1: {
              type: 'label',
              xValue: 100,
              yValue: 50,
              xAdjust: -160,
              yAdjust: 30,
              backgroundColor: 'white',
              content: [
                `Total Staked: ${(activeEraTotalStaked.data.toNumber() / divisor).toLocaleString('en-US')} ${tokenSymbol}`,
                `Total Issuance: ${(totalIssuance.toNumber() / divisor).toLocaleString('en-US')} ${tokenSymbol}`,
              ],
              textAlign: 'right',
              font: {
                size: 16,
              },
            },
            label2: {
              type: 'label',
              xValue: 70, //xIdeal
              yValue: 20, // Ideal Reward
              xAdjust: 150,
              yAdjust: -50,
              backgroundColor: 'rgba(245,245,245)',
              content: [`Target / Ideal Percent`, `of Total Staked: 70%`],
              textAlign: 'left',
              font: {
                size: 12,
              },
              callout: {
                display: true,
                side: 10,
              },
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
          borderColor: 'green',
          backgroundColor: 'green',
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: 'y',
        },
        {
          label: 'APR',
          data: rewardCurve,
          borderColor: 'blue',
          backgroundColor: 'blue',
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: 'y',
        },
        {
          label: 'Inflation',
          data: inflationCurve,
          borderColor: 'red',
          backgroundColor: 'red',
          borderWidth: 2,
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
  }, [activeEraTotalStaked.data, apr, inflation, totalIssuance]);

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
