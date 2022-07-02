import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import * as d3 from 'd3';
import { defaultChartOptions, operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { useErasRewardPoints } from '../../../hooks/StakingQueries';
import { useStakingContext } from '../../../hooks/useStakingContext';
import { BigNumber } from '@polymeshassociation/polymesh-sdk';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface PointsHistoryData {
  labels?: string[];
  pointsDatasets?: { [key: string]: string[] };
  averagePoints?: string[];
}

const ErasOperatorsPointsChart = () => {
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

  const [chartData, setChartData] = useState<ChartData<'line', string[]>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const [pointsHistoryData, setPointsHistoryData] = useState<PointsHistoryData>({});
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
    options.plugins!.title!.text = 'Operator Points per Era';

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
    // If any of the data is not latest re-enable fetching queries.
    if (activeEra.toNumber() - 1 > erasPoints.data![erasPoints.data!.length - 1].era.toNumber()) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [activeEra, erasPoints.data, erasPoints.isFetching]);

  useEffect(() => {
    if (!erasPoints.data) {
      return;
    }

    let labels: string[] = [];
    let pointsDatasets: { [key: string]: string[] } = {};
    let averagePoints: string[] = [];

    // Read all era points
    const allErasPoints = erasPoints.data;

    allErasPoints?.forEach(({ era, total, operators }, index) => {
      if (total.toNumber()) {
        averagePoints[index] = new BigNumber(total.toString()).div(Object.keys(operators).length).toString();
        // Build array of x-axis labels with eras.
        labels[index] = era.toString();

        // build array of points for each validator
        Object.entries(operators).forEach(([id, points]) => {
          pointsDatasets[id] = pointsDatasets[id] || new Array(84).fill(0);

          pointsDatasets[id][index] = points.toString();
        });
      }
    });
    if (mountedRef.current) {
      setPointsHistoryData({ labels, pointsDatasets, averagePoints });
    }
  }, [erasPoints.data]);

  useEffect(() => {
    if (!pointsHistoryData.labels || !pointsHistoryData.pointsDatasets || !pointsHistoryData.averagePoints) return;

    const { labels, pointsDatasets, averagePoints } = pointsHistoryData;

    let pointsChartData: ChartData<'line', string[]>;

    pointsChartData = {
      labels,
      datasets: [
        {
          label: 'Average',
          data: averagePoints,
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

    Object.entries(pointsDatasets).forEach(([operator, points], index) => {
      let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(pointsDatasets).length - 1)));
      if (highlight?.includes(operator)) {
        color.opacity = 0.9;
        pointsChartData.datasets.unshift({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: points,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 2,
          yAxisID: 'y',
          hoverBorderColor: 'black',
        });
      } else {
        color.opacity = 0.2;
        pointsChartData.datasets.push({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: points,
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
      setChartData(pointsChartData);
    }
    return;
  }, [highlight, pointsHistoryData]);

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

export default ErasOperatorsPointsChart;
