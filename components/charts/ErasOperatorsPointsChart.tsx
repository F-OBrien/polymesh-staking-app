import { useRef, useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import * as d3 from 'd3';
import { defaultChartZoomOptions, operatorsNames } from '../../constants/constants';
import Spinner from '../Spinner';
import { useErasPoints } from '../../hooks/StakingQueries';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  highlight?: string[] | undefined;
}

let chartOptions = {
  responsive: true,
  scales: {
    x: { title: { display: true, text: 'Era' } },
    y: { title: { display: true, text: 'Points' } },
  },
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: {
        usePointStyle: true,
        pointStyle: 'line',
      },
    },
    title: {
      display: true,
      text: 'Operator Points per Era',
      font: { size: 20 },
    },
    zoom: defaultChartZoomOptions,
  },
};

//let chartOptions = {...defaultChartOptions};

const ErasOperatorsPointsChart = ({ highlight }: IProps) => {
  // Define reference for tracking mounted state
  const mountedRef = useRef(false);
  // Effect for tracking mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [chartData, setChartData] = useState<any>();
  const [showMiniSpinner, setShowMiniSpinner] = useState<boolean>(false);
  const erasPoints = useErasPoints({ enabled: false });

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  useEffect(() => {
    if (!erasPoints.data) {
      return;
    }

    // setChartData(undefined);

    async function getPointsChart() {
      let labels: string[] = [];
      let pointsDatasets: { [key: string]: number[] } = {};
      let pointsChartData: { datasets: any; labels: string[] };
      let averagePoints: number[] = [];

      // Read all era points
      const allErasPoints = erasPoints.data;

      allErasPoints?.forEach(({ era, eraPoints, validators }, index) => {
        if (eraPoints.toNumber()) {
          averagePoints[index] = eraPoints.toNumber() / Object.keys(validators).length;
          // Build array of x-axis lables with eras.
          labels[index] = era.toString();

          // build array of points for each validator
          Object.entries(validators).forEach(([id, points]) => {
            if (!pointsDatasets[id]) {
              pointsDatasets[id] = new Array(84).fill(0);
            }
            pointsDatasets[id][index] = points.toNumber();
          });
        }
      });

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
          },
        ],
      };

      Object.entries(pointsDatasets).forEach(([operator, points], index) => {
        let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(pointsDatasets).length - 1)));
        if (highlight?.includes(operator)) {
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
          color.opacity = 0.1;
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
    getPointsChart();
  }, [erasPoints.data, highlight]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Line ref={chartRef} options={chartOptions} data={chartData} />
          <button className='resetZoomButton' onClick={resetChartZoom}>
            Reset Zoom
          </button>
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
