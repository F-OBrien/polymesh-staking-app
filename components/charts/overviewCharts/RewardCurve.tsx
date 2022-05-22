import { Balance } from '@polkadot/types/interfaces';
import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData, ChartOptions } from 'chart.js';
import { Scatter } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { inflationCurve, rewardCurve } from '../../../constants/rewardCurve';
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
    let unsubPolyxSupply: VoidFn;
    if (!api.query.balances) {
      return;
    }

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

  // Calculate percent of total staked, APR and annual inflation.
  const { percentTotalStaked, apr, inflation } = useMemo(() => {
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
    // 1_000_000_000 hard coded for now could be replaced with onchain constant `maxVariableInflationTotalIssuance`.
    if (totalIssuance?.toNumber() / divisor < 1_000_000_000) {
      if (percentTotalStaked <= xIdeal) {
        inflation = iZero + (iIdeal - iZero) * (percentTotalStaked / xIdeal);
      } else {
        inflation = iZero + (iIdeal - iZero) * 2 ** ((xIdeal - percentTotalStaked) / decay);
      }
    } else {
      // 140_000_000 hard coded for now could be replaced with onchain constant `maxVariableInflationTotalIssuance`.
      inflation = (100 * 140_000_000 * divisor) / totalIssuance?.toNumber();
    }
    const apr = 100 * (inflation / percentTotalStaked);

    return { percentTotalStaked, apr, inflation };
  }, [totalIssuance, activeEraTotalStaked.data, divisor]);

  // Set the chart options including annotation.
  const chartOptions = useMemo(() => {
    if (!apr || !inflation || !percentTotalStaked || !activeEraTotalStaked.data || !totalIssuance || !divisor || !tokenSymbol) return;

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
              borderColor: 'red',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                backgroundColor: 'red',
                content: `APR: ${apr.toFixed(3)} %`,
                enabled: true,
              },
            },
            line2: {
              type: 'line',
              yMin: 0,
              yMax: apr,
              xMin: percentTotalStaked,
              xMax: percentTotalStaked,
              borderColor: 'green',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                backgroundColor: 'green',
                content: `${percentTotalStaked.toFixed(3)} %`,
                enabled: true,
              },
            },
            line3: {
              type: 'line',
              yMin: inflation,
              yMax: inflation,
              xMin: 0,
              xMax: percentTotalStaked,
              borderColor: 'blue',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                backgroundColor: 'blue',
                content: `Inflation: ${inflation.toFixed(3)} %`,
                enabled: true,
              },
            },
            point1: {
              type: 'point',
              xValue: percentTotalStaked,
              yValue: inflation,
              radius: 3,
              borderColor: 'blue',
              backgroundColor: 'blue',
              borderWidth: 2,
            },
            point2: {
              type: 'point',
              xValue: percentTotalStaked,
              yValue: apr,
              radius: 3,
              borderColor: 'red',
              backgroundColor: 'red',
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
                enabled: true,
                side: 10,
              },
            },
          },
        },
      },
    };

    return options;
  }, [activeEraTotalStaked.data, apr, divisor, inflation, percentTotalStaked, tokenSymbol, totalIssuance]);

  // Set chart data.
  useEffect(() => {
    if (!apr || !inflation) {
      return;
    }

    async function getRewardCurve() {
      let rewardCurveChartData: { datasets: any };

      // Create chart datasets
      rewardCurveChartData = {
        datasets: [
          {
            label: 'APR',
            data: rewardCurve,
            borderColor: 'red',
            backgroundColor: 'red',
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'y',
          },
          {
            label: 'Inflation',
            data: inflationCurve,
            borderColor: 'blue',
            backgroundColor: 'blue',
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
    }
    getRewardCurve();
  }, [activeEraTotalStaked.data, apr, inflation, totalIssuance]);

  return (
    <div className='LineChart'>
      {chartData && chartOptions ? (
        <>
          <Scatter options={chartOptions} data={chartData} />
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
