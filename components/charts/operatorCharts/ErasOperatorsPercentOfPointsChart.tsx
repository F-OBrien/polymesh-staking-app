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

interface PercentOfPointsHistoryData {
  labels?: string[];
  pointsPercentDatasets?: { [key: string]: number[] };
  averagePercent?: number[];
}

const ErasOperatorsPercentOfPointsChart = () => {
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
  const [percentPointsHistoryData, setPercentPointsHistoryData] = useState<PercentOfPointsHistoryData>({});
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
    options.scales!.y!.title!.text = 'Percent [%]';
    options.plugins!.title!.text = 'Operator % of Reward/Total Points per Era';

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
    let pointsPercentDatasets: { [key: string]: number[] } = {};
    let averagePercent: number[] = [];
    // Read all era points
    const allErasPoints = erasPoints.data;

    allErasPoints?.forEach(({ era, total, operators }, index) => {
      averagePercent[index] = 100 / Object.keys(operators).length;
      // Build array of x-axis labels with eras.
      labels[index] = era.toString();

      // build array of percent for each validator
      Object.entries(operators).forEach(([id, points]) => {
        pointsPercentDatasets[id] = pointsPercentDatasets[id] || new Array(84).fill(0);
        pointsPercentDatasets[id][index] = new BigNumber(100).times(points.toString()).div(total.toNumber()).toNumber();
      });
    });
    if (mountedRef.current) {
      setPercentPointsHistoryData({ labels, pointsPercentDatasets, averagePercent });
    }
  }, [erasPoints.data]);

  useEffect(() => {
    if (!percentPointsHistoryData.labels || !percentPointsHistoryData.pointsPercentDatasets || !percentPointsHistoryData.averagePercent) return;

    const { labels, pointsPercentDatasets, averagePercent } = percentPointsHistoryData;

    let percentPointsChartData: ChartData<'line'>;

    percentPointsChartData = {
      labels,
      datasets: [
        {
          label: 'Average',
          data: averagePercent,
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

    Object.entries(pointsPercentDatasets).forEach(([operator, percent], index) => {
      let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(pointsPercentDatasets).length - 1)));
      color.opacity = 0.9;
      if (highlight?.includes(operator)) {
        percentPointsChartData.datasets.unshift({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: percent,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 2,
          yAxisID: 'y',
          hoverBorderColor: 'black',
        });
      } else {
        color.opacity = 0.2;
        percentPointsChartData.datasets.push({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: percent,
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
      setChartData(percentPointsChartData);
    }
    return;
  }, [highlight, percentPointsHistoryData]);

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

export default ErasOperatorsPercentOfPointsChart;
