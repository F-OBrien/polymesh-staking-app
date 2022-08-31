import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { defaultChartOptions, operatorsNames } from '../../../constants/constants';
import * as d3 from 'd3';
import { useSdk } from '../../../hooks/useSdk';
import { useErasStakers, useErasRewardPoints, useErasRewards, useErasPreferences } from '../../../hooks/StakingQueries';
import { BigNumber } from '@polymeshassociation/polymesh-sdk';
import { useStakingContext } from '../../../hooks/useStakingContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface AprHistoryData {
  labels?: string[];
  rewardDatasets?: { [key: string]: string[] };
  averageReward?: string[];
}

const OperatorsRewards = () => {
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
    chainData: { tokenDecimals },
  } = useSdk();
  const {
    eraInfo: { activeEra, currentEra },
    operatorsToHighlight: highlight,
  } = useStakingContext();

  const [chartData, setChartData] = useState<ChartData<'line', string[]>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const [aprHistoryData, setAprHistoryData] = useState<AprHistoryData>({});
  const erasPoints = useErasRewardPoints({ enabled: fetchQueries });
  const erasRewards = useErasRewards({ enabled: fetchQueries });
  const erasPrefs = useErasPreferences({ enabled: fetchQueries });
  const erasStakingData = useErasStakers({ enabled: fetchQueries });

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };
  const divisor = useMemo(() => new BigNumber(10).pow(tokenDecimals), [tokenDecimals]);
  const chartOptions = useMemo(() => {
    // Make a copy of the default options.
    const options = structuredClone(defaultChartOptions);
    // Override defaults with chart specific options.
    options.scales!.x!.title!.text = 'Era';
    options.scales!.y!.title!.text = 'Reward [POLYX]';
    options.plugins!.title!.text = 'Operator Rewards per Era';

    return options;
  }, []);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return erasStakingData.isFetching || erasPoints.isFetching || erasRewards.isFetching || erasPrefs.isFetching;
  }, [erasStakingData.isFetching, erasPoints.isFetching, erasRewards.isFetching, erasPrefs.isFetching]);

  // Set `dataMissing` to true while any of the required data is missing.
  const dataMissing = useMemo(() => {
    return !erasStakingData.data || !erasPoints.data || !erasRewards.data || !erasPrefs.data;
  }, [erasPoints.data, erasPrefs.data, erasRewards.data, erasStakingData.data]);

  // If the era changes or if data is missing set `fetchQueries` to true to trigger fetching/refetching all data.
  useEffect(() => {
    if (dataIsFetching || !mountedRef.current) return;

    if (dataMissing) {
      setFetchQueries(true);
      return;
    }
    // Check we have up to date data.
    const pointsDataNotCurrent = activeEra.toNumber() - 1 > erasPoints.data![erasPoints.data!.length - 1].era.toNumber();
    const rewardDataNotCurrent = activeEra.toNumber() - 1 > erasRewards.data![erasRewards.data!.length - 1].era.toNumber();
    const prefsDataNotCurrent = currentEra.toNumber() > erasPrefs.data![erasPrefs.data!.length - 1].era.toNumber();
    const stakingDataNotCurrent = currentEra.toNumber() > erasStakingData.data![erasStakingData.data!.length - 1].era.toNumber();
    // If any of the data is not latest re-enable fetching queries.
    if (pointsDataNotCurrent || rewardDataNotCurrent || prefsDataNotCurrent || stakingDataNotCurrent) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [activeEra, currentEra, dataIsFetching, dataMissing, erasPoints, erasPrefs, erasRewards, erasStakingData]);

  useEffect(() => {
    // If we don't have required data return.
    if (dataMissing) return;

    let labels: string[] = [];
    let rewardDatasets: { [key: string]: string[] } = {};
    let averageReward: string[] = [];

    const historicalErasStakingData = erasStakingData.data!;
    const historicalErasPoints = erasPoints.data!;
    const historicalErasRewards = erasRewards.data!;
    const historicalErasPrefs = erasPrefs.data!;

    // Use points, rewards, totals and commission to calculate APRs
    historicalErasPoints?.forEach(({ era, total: totalPoints, operators }, index) => {
      // Build array of x-axis labels with eras.
      // Eras are sorted so we can use index to populate arrays.
      labels[index] = era.toString();

      let sumOfOperatorRewards = new BigNumber(0);

      // Search for the data for the corresponding era. While the data should be sorted by era this
      // ensures correct calculations if queries were not fetched with the same era range.
      const eraStakingData = historicalErasStakingData.find((data) => {
        return data.era.toNumber() === era.toNumber();
      });
      const eraPreferences = historicalErasPrefs.find((data) => {
        return data.era.toNumber() === era.toNumber();
      });
      const eraRewards = historicalErasRewards.find((data) => {
        return data.era.toNumber() === era.toNumber();
      });

      // Ensure data was found for the era.
      if (eraStakingData && eraPreferences && eraRewards) {
        // Build array of APRs for each validator.
        Object.entries(operators).forEach(([id, points]) => {
          // If there is no previous data for the operator create a new array.
          rewardDatasets[id] = rewardDatasets[id] || new Array(historicalErasPoints.length).fill('0');
          // Total POLYX assigned to current operator.
          const totalAssigned = new BigNumber(eraStakingData.operators[id].total.unwrap().toString());
          const operatorOwnStake = new BigNumber(eraStakingData.operators[id].own.unwrap().toString());
          const operatorCommission = new BigNumber(eraPreferences.operators[id].commission.toString());
          const nodePortion = new BigNumber(points.toString())
            .times(1_000_000_000)
            .div(totalPoints.toString())
            .decimalPlaces(0, BigNumber.ROUND_DOWN);
          const nodeReward = new BigNumber(eraRewards.reward.toString()).times(nodePortion).div(1_000_000_000).decimalPlaces(0, BigNumber.ROUND_DOWN);
          const operatorCommissionPayout = operatorCommission.times(nodeReward).div(1_000_000_000).decimalPlaces(0, BigNumber.ROUND_DOWN);
          const leftoverReward = nodeReward.minus(operatorCommissionPayout);
          const operatorPortion = operatorOwnStake.times(1_000_000_000).div(totalAssigned).decimalPlaces(0, BigNumber.ROUND_DOWN);
          const operatorStakingPayout = leftoverReward.times(operatorPortion).div(1_000_000_000).decimalPlaces(0, BigNumber.ROUND_DOWN);
          const operatorReward = operatorCommissionPayout.plus(operatorStakingPayout);

          rewardDatasets[id][index] = operatorReward.div(divisor).toString();

          sumOfOperatorRewards = sumOfOperatorRewards.plus(operatorReward);
        });
        // Calculate the average APR after commissions.
        averageReward[index] = sumOfOperatorRewards.div(Object.keys(operators).length).div(divisor).toString();
      }
    });

    if (mountedRef.current) {
      setAprHistoryData({ labels, rewardDatasets, averageReward });
    }
  }, [dataMissing, divisor, erasPoints.data, erasPrefs.data, erasRewards.data, erasStakingData.data]);

  useEffect(() => {
    if (!aprHistoryData.labels || !aprHistoryData.rewardDatasets || !aprHistoryData.averageReward) return;

    const { labels, rewardDatasets, averageReward } = aprHistoryData;

    let aprChartData: { datasets: any; labels: string[] };
    // Create chart datasets
    aprChartData = {
      labels,
      datasets: [
        {
          label: 'Average',
          data: averageReward,
          borderColor: 'rgb(255,0,0)',
          backgroundColor: 'rgba(255,0,0,0.5)',
          borderWidth: 2,
          borderDash: [3, 5],
          pointRadius: 0,
          borderJoinStyle: 'round',
        },
      ],
    };

    Object.entries(rewardDatasets).forEach(([operator, apr], index) => {
      let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(rewardDatasets).length - 1)));
      const hoverColor = (color: d3.RGBColor) => {
        color.opacity = 1;
        return color;
      };

      if (highlight?.includes(operator)) {
        color.opacity = 0.7;
        aprChartData.datasets.unshift({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: apr,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 0,
          stepped: false,
          tension: 0.0,
          hoverBorderColor: hoverColor(color).formatRgb(),
        });
      } else {
        color.opacity = 0.7;
        aprChartData.datasets.push({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: apr,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 0,
          stepped: false,
          tension: 0.0,
          hoverBorderColor: hoverColor(color).formatRgb(),
          borderJoinStyle: 'round',
        });
      }
    });

    // Before setting the chart data ensure the component is still mounted.
    if (mountedRef.current) {
      setChartData(aprChartData);
    }
    return;
  }, [aprHistoryData, highlight]);

  return (
    <div className='LineChart'>
      {chartData && chartOptions ? (
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
          Loading Staking History
        </>
      )}
    </div>
  );
};

export default OperatorsRewards;
