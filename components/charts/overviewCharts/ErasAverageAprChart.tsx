import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { BN_MILLISECONDS_PER_YEAR, defaultChartOptions } from '../../../constants/constants';
import { useSdk } from '../../../hooks/useSdk';
import { useErasRewards, useErasPreferences, useErasRewardPoints } from '../../../hooks/StakingQueries';
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
    api,
    chainData: { expectedBlockTime, epochDuration, sessionsPerEra },
  } = useSdk();
  const [chartData, setChartData] = useState<ChartData<'line'>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const erasPoints = useErasRewardPoints({ enabled: fetchQueries });
  const erasRewards = useErasRewards({ enabled: fetchQueries });
  const erasPrefs = useErasPreferences({ enabled: fetchQueries });
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
    return erasRewards.isFetching || erasPrefs.isFetching || erasPoints.isFetching;
  }, [erasRewards.isFetching, erasPrefs.isFetching, erasPoints.isFetching]);

  const erasPerYear = useMemo(
    () => BN_MILLISECONDS_PER_YEAR.div(expectedBlockTime.mul(epochDuration).mul(sessionsPerEra)).toNumber(),
    [epochDuration, expectedBlockTime, sessionsPerEra]
  );

  // If the era changes or if data is missing set `fetchQueries` to true to trigger fetching/refetching all data.
  useEffect(() => {
    if (dataIsFetching || !mountedRef.current) return;

    if (!erasRewards.data || !erasPrefs.data || !erasPoints.data) {
      setFetchQueries(true);
      return;
    }
    // Check we have up to date data.
    const rewardDataNotCurrent = activeEra.toNumber() - 1 > erasRewards.data![erasRewards.data!.length - 1].era.toNumber();
    const prefsDataNotCurrent = currentEra.toNumber() > erasPrefs.data![erasPrefs.data!.length - 1].era.toNumber();
    const pointsDataNotCurrent = activeEra.toNumber() - 1 > erasPoints.data![erasPoints.data!.length - 1].era.toNumber();

    // If any of the data is not latest re-enable fetching queries.
    if (rewardDataNotCurrent || prefsDataNotCurrent || pointsDataNotCurrent) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [activeEra, currentEra, dataIsFetching, erasPoints.data, erasPrefs.data, erasRewards.data]);

  useEffect(() => {
    if (!erasRewards.data || !erasPrefs.data) {
      return;
    }
    // Read all era points
    const allErasPrefs = erasPrefs.data;

    let averageCommission: number[] = [];

    allErasPrefs?.forEach(({ operators }, index) => {
      let sum = 0;
      // build array of points for each validator
      Object.entries(operators).forEach(([, { commission }]) => {
        sum = sum + commission.toNumber();
      });
      averageCommission[index] = sum / (1000000000 * Object.keys(operators).length);
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
      const allErasRewards = erasRewards.data;
      const allErasTotalStake = await api.query.staking.erasTotalStake.entries();

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

      allErasRewards?.forEach(({ era, reward }, index) => {
        // Ensure there is a corresponding Total value for the era.
        if (totals.get(era.toString())) {
          // Build array of x-axis labels with eras.
          labels[index] = era.toString();
          // Build array of y-axis values
          apr[index] = (100 * erasPerYear * reward.toNumber()) / totals.get(era.toString()).toNumber();
          // FIXME: commission is not correctly calculated.
          aprIncCommission[index] = apr[index] * (1 - averageCommission[index]);
          apy[index] = 100 * ((1 + reward.toNumber() / totals.get(era.toString()).toNumber()) ** erasPerYear - 1);
          apyIncCommission[index] =
            100 * ((1 + ((1 - averageCommission[index]) * reward.toNumber()) / totals.get(era.toString()).toNumber()) ** erasPerYear - 1);
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
  }, [api, erasRewards.data, erasPerYear, erasPrefs.data]);

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
