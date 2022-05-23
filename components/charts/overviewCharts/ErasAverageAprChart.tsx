import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { BN_MILLISECONDS_PER_YEAR, defaultChartOptions } from '../../../constants/constants';
import { useSdk } from '../../../hooks/useSdk';
import { useErasRewards, useErasPreferences, useErasRewardPoints, useErasTotalStaked } from '../../../hooks/StakingQueries';
import { useStakingContext } from '../../../hooks/useStakingContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

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

  const {
    chainData: { expectedBlockTime, epochDuration, sessionsPerEra },
  } = useSdk();
  const [chartData, setChartData] = useState<ChartData<'line'>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const erasPoints = useErasRewardPoints({ enabled: fetchQueries });
  const erasRewards = useErasRewards({ enabled: fetchQueries });
  const erasPrefs = useErasPreferences({ enabled: fetchQueries });
  const erasTotalStaked = useErasTotalStaked({ enabled: fetchQueries });
  const {
    eraInfo: { activeEra, currentEra },
  } = useStakingContext();

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
    options.scales.y.title.text = 'Percent [%]';
    options.plugins.title.text = 'Average APR / APY per Era';

    return options;
  }, []);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return erasRewards.isFetching || erasPrefs.isFetching || erasPoints.isFetching || erasTotalStaked.isFetching;
  }, [erasRewards.isFetching, erasPrefs.isFetching, erasPoints.isFetching, erasTotalStaked.isFetching]);

  const erasPerYear = useMemo(
    () => BN_MILLISECONDS_PER_YEAR.div(expectedBlockTime.mul(epochDuration).mul(sessionsPerEra)).toNumber(),
    [epochDuration, expectedBlockTime, sessionsPerEra]
  );

  // If the era changes or if data is missing set `fetchQueries` to true to trigger fetching/refetching all data.
  useEffect(() => {
    if (dataIsFetching || !mountedRef.current) return;

    if (!erasRewards.data || !erasPrefs.data || !erasPoints.data || !erasTotalStaked.data) {
      setFetchQueries(true);
      return;
    }
    // Check we have up to date data.
    const rewardDataNotCurrent = activeEra.toNumber() - 1 > erasRewards.data[erasRewards.data!.length - 1].era.toNumber();
    const prefsDataNotCurrent = currentEra.toNumber() > erasPrefs.data[erasPrefs.data!.length - 1].era.toNumber();
    const pointsDataNotCurrent = activeEra.toNumber() - 1 > erasPoints.data[erasPoints.data!.length - 1].era.toNumber();
    const totalsStakedNotCurrent = currentEra.toNumber() > erasTotalStaked.data[erasTotalStaked.data!.length - 1].era.toNumber();

    // If any of the data is not latest re-enable fetching queries.
    if (rewardDataNotCurrent || prefsDataNotCurrent || pointsDataNotCurrent || totalsStakedNotCurrent) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [activeEra, currentEra, dataIsFetching, erasPoints.data, erasPrefs.data, erasRewards.data, erasTotalStaked.data]);

  useEffect(() => {
    if (!erasRewards.data || !erasPrefs.data || !erasTotalStaked.data || !erasPoints.data) {
      return;
    }
    const allErasPrefs = erasPrefs.data;
    const allErasPoints = erasPoints.data;
    const allErasRewards = erasRewards.data;
    const allErasTotalStake = erasTotalStaked.data;

    let averageCommission: Record<number, number> = {};
    // Calculate a weighted average commission for each era base on points.
    allErasPoints.forEach(({ era, total, operators }) => {
      // Find the corresponding era operator preferences.
      const eraPreferences = allErasPrefs.find((data) => {
        return data.era.toNumber() === era.toNumber();
      });
      // Initialize average to zero
      averageCommission[era.toNumber()] = 0;

      if (eraPreferences) {
        Object.entries(operators).forEach(([operator, points]) => {
          const weight = points.toNumber() / total.toNumber();
          const commission = eraPreferences?.operators[operator].commission.unwrap().toNumber() / 1_000_000_000;
          averageCommission[era.toNumber()] = averageCommission[era.toNumber()] + weight * commission;
        });
      }
    });

    async function getAverageAprData() {
      let labels: string[] = [];
      let averageAprChartData: { datasets: any; labels: string[] };
      let apr: number[] = [];
      let aprIncCommission: number[] = [];
      let apy: number[] = [];
      let apyIncCommission: number[] = [];

      allErasRewards.forEach(({ era, reward }, index) => {
        // Ensure there is a corresponding Total value for the era.
        const eraTotal = allErasTotalStake.find((data) => {
          return data.era.toNumber() === era.toNumber();
        });

        if (eraTotal) {
          // Build array of x-axis labels with eras.
          labels[index] = era.toString();
          // Build array of y-axis values
          apr[index] = (100 * erasPerYear * reward.toNumber()) / eraTotal.total.toNumber();
          aprIncCommission[index] = apr[index] * (1 - averageCommission[era.toNumber()]);
          apy[index] = 100 * ((1 + reward.toNumber() / eraTotal.total.toNumber()) ** erasPerYear - 1);
          apyIncCommission[index] =
            100 * ((1 + ((1 - averageCommission[era.toNumber()]) * reward.toNumber()) / eraTotal.total.toNumber()) ** erasPerYear - 1);
        }
      });

      // Create chart datasets
      averageAprChartData = {
        labels,
        datasets: [
          {
            label: 'Average APR',
            data: apr,
            borderColor: 'rgb(0,128,255)',
            backgroundColor: 'rgba(0,128,255,0.5)',
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
            borderColor: 'rgb(0,204,0)',
            backgroundColor: 'rgba(0,204,0,0.5)',
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          },
          {
            label: 'Average APY inc. Commission',
            data: apyIncCommission,
            borderColor: 'rgb(255,128,0)',
            backgroundColor: 'rgba(255,128,0,0.5)',
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
  }, [erasRewards.data, erasPerYear, erasPrefs.data, erasTotalStaked.data, erasPoints.data]);

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

export default ErasAverageAprChart;
