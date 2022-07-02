import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { defaultChartOptions, operatorsNames, BN_MILLISECONDS_PER_YEAR } from '../../../constants/constants';
import * as d3 from 'd3';
import { useSdk } from '../../../hooks/useSdk';
import { useErasStakers, useErasRewardPoints, useErasRewards, useErasPreferences } from '../../../hooks/StakingQueries';
import { BigNumber } from '@polymeshassociation/polymesh-sdk';
import { useStakingContext } from '../../../hooks/useStakingContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface AprHistoryData {
  labels?: string[];
  aprDatasets?: { [key: string]: string[] };
  averageApr?: string[];
}

const ErasOperatorsAprIncCommissionChart = () => {
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
    chainData: { expectedBlockTime, epochDuration, sessionsPerEra },
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

  const chartOptions = useMemo(() => {
    // Make a copy of the default options.
    // @ts-ignore - typescript doesn't yet recognize this function. TODO remove ignore once supported
    const options = structuredClone(defaultChartOptions);
    // Override defaults with chart specific options.
    options.scales.x.title.text = 'Era';
    options.scales.y.title.text = 'APR [%]';
    options.plugins.title.text = 'Operator APR per Era (inc. commission)';

    return options;
  }, []);

  const erasPerYear = useMemo(
    () => new BigNumber(BN_MILLISECONDS_PER_YEAR.div(expectedBlockTime.mul(epochDuration).mul(sessionsPerEra)).toString()),
    [epochDuration, expectedBlockTime, sessionsPerEra]
  );

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
    let aprDatasets: { [key: string]: string[] } = {};
    let averageApr: string[] = [];

    const historicalErasStakingData = erasStakingData.data!;
    const historicalErasPoints = erasPoints.data!;
    const historicalErasRewards = erasRewards.data!;
    const historicalErasPrefs = erasPrefs.data!;

    // Use points, rewards, totals and commission to calculate APRs
    historicalErasPoints?.forEach(({ era, total: totalPoints, operators }, index) => {
      // Build array of x-axis labels with eras.
      // Eras are sorted so we can use index to populate arrays.
      labels[index] = era.toString();

      let sumOfTotals = new BigNumber(0);
      let sumOfStakersRewards = new BigNumber(0);

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
          aprDatasets[id] = aprDatasets[id] || new Array(historicalErasPoints.length).fill('0');
          // Total POLYX assigned to current operator.
          const totalAssigned = new BigNumber(eraStakingData.operators[id].total.unwrap().toString());
          // Total Reward for the current operator node.
          const nodeReward = new BigNumber(eraRewards.reward.toString())
            .times(points.toString())
            .div(totalPoints.toString())
            .decimalPlaces(0, BigNumber.ROUND_DOWN);
          // Calculate APR excluding commission
          const apr = new BigNumber(100).times(erasPerYear).times(nodeReward).div(totalAssigned);
          // Portion or reward remaining after commission = 1 - commission
          // Note: Commission is scaled by 1 billion.
          const portionAfterCommission = new BigNumber(1).minus(new BigNumber(eraPreferences.operators[id].commission.toString()).div(1_000_000_000));

          const aprAfterCommission = apr.times(portionAfterCommission);

          aprDatasets[id][index] = aprAfterCommission.toString();

          // The reward for distribution to stakers after commission is subtracted.
          const stakersReward = nodeReward.times(portionAfterCommission).decimalPlaces(0, BigNumber.ROUND_DOWN);
          // Add to get the total rewards after commission is subtracted.
          sumOfStakersRewards = sumOfStakersRewards.plus(stakersReward);

          sumOfTotals = sumOfTotals.plus(totalAssigned);
        });
        // Calculate the average APR after commissions.
        averageApr[index] = erasPerYear.times(100).times(sumOfStakersRewards).div(sumOfTotals).toString();
      }
    });

    if (mountedRef.current) {
      setAprHistoryData({ labels, aprDatasets, averageApr });
    }
  }, [dataMissing, erasPerYear, erasPoints.data, erasPrefs.data, erasRewards.data, erasStakingData.data]);

  useEffect(() => {
    if (!aprHistoryData.labels || !aprHistoryData.aprDatasets || !aprHistoryData.averageApr) return;

    const { labels, aprDatasets, averageApr } = aprHistoryData;

    let aprChartData: { datasets: any; labels: string[] };
    // Create chart datasets
    aprChartData = {
      labels,
      datasets: [
        {
          label: 'Average',
          data: averageApr,
          borderColor: 'rgb(255,0,0)',
          backgroundColor: 'rgba(255,0,0,0.5)',
          borderWidth: 2,
          borderDash: [3, 5],
          pointRadius: 2,
          hoverBorderColor: 'black',
          hoverBackgroundColor: 'rgb(255,0,0)',
          borderJoinStyle: 'round',
        },
      ],
    };

    Object.entries(aprDatasets).forEach(([operator, apr], index) => {
      let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(aprDatasets).length - 1)));

      if (highlight?.includes(operator)) {
        color.opacity = 0.9;
        aprChartData.datasets.unshift({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: apr,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 2,
          stepped: false,
          tension: 0.0,
          hoverBorderColor: 'black',
        });
      } else {
        color.opacity = 0.2;
        aprChartData.datasets.push({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: apr,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 2,
          stepped: false,
          tension: 0.0,
          hoverBorderColor: 'black',
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

export default ErasOperatorsAprIncCommissionChart;
