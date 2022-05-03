import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import * as d3 from 'd3';
import { defaultChartOptions, operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { useErasPoints } from '../../../hooks/StakingQueries';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  highlight?: string[] | undefined;
}

const ErasOperatorsPointDeviationsFromAverageChart = ({ highlight }: IProps) => {
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

  const erasPoints = useErasPoints({ enabled: false });

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const chartOptions = useMemo(() => {
    // Make a copy of the default options.
    // @ts-ignore - typescript doens't yet recognise this function. TODO remove ignore once supported
    const options = structuredClone(defaultChartOptions);
    // Override defaults with chart specific options.
    options.scales.x.title.text = 'Era';
    options.scales.y.title.text = 'Percent [%]';
    options.plugins.title.text = 'Cumulative % Deviation from Average Era Points';
    options.plugins.zoom.limits = undefined;

    return options;
  }, []);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return false;
  }, []);

  useEffect(() => {
    if (!erasPoints.data) {
      return;
    }

    async function getDeviationsFromAverage() {
      let labels: string[] = [];
      let averageDeviationDatasets: { [key: string]: number[] } = {};
      let averageDeviationSum: { [key: string]: number } = {};
      let pointsChartData: { datasets: any; labels: string[] };
      let averagePoints: number[] = [];

      // Read all era points
      const allErasPoints = erasPoints.data;

      allErasPoints?.forEach(({ era, eraPoints, validators }, index) => {
        if (eraPoints.toNumber()) {
          averagePoints[index] = eraPoints.toNumber() / Object.keys(validators).length;
          // Build array of x-axis labels with eras.
          labels[index] = era.toString();

          // build array of cumulative deviation from average points for each validator
          Object.entries(validators).forEach(([id, points]) => {
            const percenOfAverage = 100 * (points.toNumber() / averagePoints[index] - 1);
            averageDeviationSum[id] = averageDeviationSum[id] || 0;
            averageDeviationSum[id] = averageDeviationSum[id] + percenOfAverage;

            averageDeviationDatasets[id] = averageDeviationDatasets[id] || new Array(allErasPoints.length) /* .fill(0) */;
            averageDeviationDatasets[id][index] = averageDeviationSum[id];
          });
        }
      });

      pointsChartData = {
        labels,
        datasets: [
          {
            label: 'Average',
            data: new Array(allErasPoints?.length).fill(0),
            borderColor: 'rgb(200,0,0)',
            backgroundColor: 'rgba(200,0,0,0.5)',
            borderWidth: 2,
            borderDash: [3, 5],
            pointRadius: 2,
            yAxisID: 'y',
          },
        ],
      };

      Object.entries(averageDeviationDatasets).forEach(([operator, points], index) => {
        let color = d3.rgb(d3.interpolateSinebow(index / (Object.keys(averageDeviationDatasets).length - 1)));
        if (highlight?.includes(operator)) {
          color.opacity = 0.9;
          pointsChartData.datasets.unshift({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: points,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          });
        } else {
          color.opacity = 0.9;
          pointsChartData.datasets.push({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: points,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          });
        }
      });

      // Before setting the chart data ensure the component is still mounted
      if (mountedRef.current) {
        setChartData(pointsChartData);
      }
      return;
    }
    getDeviationsFromAverage();
  }, [erasPoints.data, highlight]);

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

export default ErasOperatorsPointDeviationsFromAverageChart;
