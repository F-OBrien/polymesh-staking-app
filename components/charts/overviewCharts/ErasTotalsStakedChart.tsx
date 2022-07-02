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
  ChartDataset,
  ChartOptions,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { defaultChartOptions } from '../../../constants/constants';
import { useErasTotalStaked } from '../../../hooks/StakingQueries';
import { useSdk } from '../../../hooks/useSdk';
import { useStakingContext } from '../../../hooks/useStakingContext';

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

  const [chartData, setChartData] = useState<ChartData<'line'>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const totalsQuery = useErasTotalStaked({ enabled: fetchQueries });
  const {
    chainData: { tokenSymbol, tokenDecimals },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;
  const {
    eraInfo: { currentEra },
  } = useStakingContext();

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const chartOptions: ChartOptions<'line'> = useMemo(() => {
    // Make a copy of the default options.
    const options = structuredClone(defaultChartOptions);
    // Override defaults with chart specific options.
    options.scales!.x!.title!.text = 'Era';
    options.scales!.y!.title!.text = `Amount [${tokenSymbol}]`;
    options.plugins!.title!.text = `Total ${tokenSymbol} Staked per Era`;
    options.plugins!.legend!.display = false;

    return options;
  }, [tokenSymbol]);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return totalsQuery.isFetching;
  }, [totalsQuery.isFetching]);

  // If the era changes or if data is missing set `fetchQueries` to true to trigger fetching/refetching all data.
  useEffect(() => {
    if (totalsQuery.isFetching || !mountedRef.current) return;

    if (!totalsQuery.data) {
      setFetchQueries(true);
      return;
    }
    // Check we have up to date data.
    // If any of the data is not latest re-enable fetching queries.
    if (currentEra.toNumber() > totalsQuery.data![totalsQuery.data!.length - 1].era.toNumber()) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [currentEra, totalsQuery.data, totalsQuery.isFetching]);

  useEffect(() => {
    if (!totalsQuery.data) {
      return;
    }

    async function getTotalsStakedData() {
      let totalsStakedChartData: { datasets: ChartDataset<'line'>[]; labels: string[] };
      let totals: number[] = [];
      let labels: string[] = [];
      // let indexOffset: number;

      // Read all era totals staked
      const allErasTotalStake = totalsQuery.data;

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

export default ErasTotalsStakedChart;
