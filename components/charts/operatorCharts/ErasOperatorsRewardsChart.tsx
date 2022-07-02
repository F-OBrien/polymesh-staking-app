import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import * as d3 from 'd3';
import { defaultChartOptions, operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { useSdk } from '../../../hooks/useSdk';
import { useErasRewardPoints, useErasRewards } from '../../../hooks/StakingQueries';
import { useStakingContext } from '../../../hooks/useStakingContext';
import { BigNumber } from '@polymeshassociation/polymesh-sdk';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface RewardsHistoryData {
  labels?: string[];
  rewardDatasets?: { [key: string]: number[] };
  averageReward?: number[];
}

const ErasOperatorsRewardsChart = () => {
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
    operatorsToHighlight: highlight,
  } = useStakingContext();
  const [chartData, setChartData] = useState<ChartData<'line'>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const [rewardHistoryData, setRewardHistoryData] = useState<RewardsHistoryData>({});
  const erasPoints = useErasRewardPoints({ enabled: fetchQueries });
  const erasRewards = useErasRewards({ enabled: fetchQueries });
  const {
    chainData: { tokenSymbol, tokenDecimals },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;

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
    options.plugins.title.text = `${tokenSymbol} Rewards per Era by Operator`;

    return options;
  }, [tokenSymbol]);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return erasPoints.isFetching || erasRewards.isFetching;
  }, [erasPoints.isFetching, erasRewards.isFetching]);

  // Set `dataMissing` to true while any of the required data is missing.
  const dataMissing = useMemo(() => {
    return !erasPoints.data || !erasRewards.data;
  }, [erasPoints.data, erasRewards.data]);

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
    // If any of the data is not latest re-enable fetching queries.
    if (pointsDataNotCurrent || rewardDataNotCurrent) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [activeEra, dataIsFetching, dataMissing, erasPoints, erasRewards]);

  useEffect(() => {
    if (!erasRewards.data || !erasPoints.data) {
      return;
    }

    let labels: string[] = [];
    let rewardDatasets: { [key: string]: number[] } = {};
    let averageReward: number[] = [];

    // Read all era points
    const historicalErasPoints = erasPoints.data;
    // Read all era rewards
    const historicalErasRewards = erasRewards.data;
    historicalErasPoints?.forEach(({ era, total: totalPoints, operators }, index) => {
      // Build array of x-axis labels with eras.
      labels[index] = era.toString();
      // Search for the data for the corresponding era. While the data should be sorted by era this
      // ensures correct calculations if queries were not fetched with the same era range.
      const eraRewards = historicalErasRewards.find((data) => {
        return data.era.toNumber() === era.toNumber();
      });
      // Ensure data was found for the era.
      if (eraRewards) {
        averageReward[index] = new BigNumber(eraRewards.reward.toString()).div(Object.keys(operators).length).div(divisor).toNumber();

        // Build array of rewards for each validator
        Object.entries(operators).forEach(([id, points]) => {
          if (!rewardDatasets[id]) {
            rewardDatasets[id] = new Array(84).fill(0);
          }

          rewardDatasets[id][index] = new BigNumber(eraRewards.reward.mul(points).toString()).div(totalPoints.toString()).div(divisor).toNumber();
        });
      }
    });
    if (mountedRef.current) {
      setRewardHistoryData({ labels, rewardDatasets, averageReward });
    }
  }, [dataMissing, divisor, erasPoints.data, erasRewards.data]);

  useEffect(() => {
    if (!rewardHistoryData.labels || !rewardHistoryData.rewardDatasets || !rewardHistoryData.averageReward) return;

    const { labels, rewardDatasets, averageReward } = rewardHistoryData;
    let chartData: { datasets: any; labels: string[] };

    chartData = {
      labels,
      datasets: [
        {
          label: 'Average',
          data: averageReward,
          borderColor: 'rgb(200,0,0)',
          backgroundColor: 'rgba(200,0,0,0.5)',
          borderWidth: 2,
          borderDash: [3, 5],
          pointRadius: 2,
          yAxisID: 'y',
          hoverBorderColor: 'black',
          hoverBackgroundColor: 'rgb(255,0,0)',
        },
      ],
    };

    Object.entries(rewardDatasets).forEach(([operator, reward], index) => {
      let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(rewardDatasets).length - 1)));
      color.opacity = 0.9;
      if (highlight?.includes(operator)) {
        chartData.datasets.unshift({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: reward,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 2,
          yAxisID: 'y',
          hoverBorderColor: 'black',
        });
      } else {
        color.opacity = 0.2;
        chartData.datasets.push({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: reward,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 2,
          yAxisID: 'y',
          hoverBorderColor: 'black',
        });
      }
    });

    // Before setting the chart data ensure the component is still mounted
    if (mountedRef.current) {
      setChartData(chartData);
    }
    return;
  }, [highlight, rewardHistoryData]);

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

export default ErasOperatorsRewardsChart;
