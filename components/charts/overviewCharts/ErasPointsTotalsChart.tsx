import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { defaultChartOptions } from '../../../constants/constants';
import { useErasRewardPoints } from '../../../hooks/StakingQueries';
import { useStakingContext } from '../../../hooks/useStakingContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

const ErasPointsTotalsChart = () => {
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

  const [chartData, setChartData] = useState<ChartData<'line'>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const erasPoints = useErasRewardPoints({ enabled: fetchQueries });

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const chartOptions = useMemo(() => {
    // Make a copy of the default options.
    const options = structuredClone(defaultChartOptions);
    // Override defaults with chart specific options.
    options.scales!.x!.title!.text = 'Era';
    options.scales!.y!.title!.text = 'Points';
    options.plugins!.title!.text = 'Total Points per Era';
    options.plugins!.legend!.display = false;

    return options;
  }, []);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return erasPoints.isFetching;
  }, [erasPoints.isFetching]);

  // If the era changes or if data is missing set `fetchQueries` to true to trigger fetching/refetching all data.
  useEffect(() => {
    if (erasPoints.isFetching || !mountedRef.current) return;

    if (!erasPoints.data) {
      setFetchQueries(true);
      return;
    }
    // Check we have up to date data.
    const pointsDataNotCurrent = activeEra.toNumber() - 1 > erasPoints.data![erasPoints.data!.length - 1].era.toNumber();
    // If any of the data is not latest re-enable fetching queries.
    if (pointsDataNotCurrent) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [activeEra, erasPoints.isFetching, erasPoints.data]);

  useEffect(() => {
    if (!erasPoints.data) {
      return;
    }

    let labels: string[] = [];
    let totalPointsChartData: { datasets: any; labels: string[] };
    let totalPoints: number[] = [];
    // Read all era points
    const allErasPoints = erasPoints.data;

    allErasPoints?.forEach(({ era, total }, index) => {
      if (total.toNumber()) {
        // Build array of x-axis labels with eras.
        labels[index] = era.toString();
        totalPoints[index] = total.toNumber();
      }
    });

    // Create chart datasets
    totalPointsChartData = {
      labels,
      datasets: [
        {
          label: 'Total Points',
          data: totalPoints,
          borderColor: 'rgb(200,0,0)',
          backgroundColor: 'rgba(200,0,0,0.5)',
          borderWidth: 2,
          pointRadius: 2,
          yAxisID: 'y',
        },
      ],
    };

    // Before setting the chart data ensure the component is still mounted
    if (mountedRef.current) {
      setChartData(totalPointsChartData);
    }
    return;
  }, [erasPoints.data]);

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

export default ErasPointsTotalsChart;
