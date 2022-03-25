import { useRef, useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner from '../Spinner';
import { defaultChartZoomOptions } from '../../constants/constants';
import { useErasPoints } from '../../hooks/StakingQueries';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

let chartOptions = {
  responsive: true,
  scales: {
    x: { title: { display: true, text: 'Era' } },
    y: { title: { display: true, text: 'Points' } },
  },
  plugins: {
    title: { display: true, text: 'Total Points per Era', font: { size: 20 } },
    legend: {
      position: 'bottom' as const,
      labels: {
        usePointStyle: true,
        pointStyle: 'line',
      },
    },
    zoom: defaultChartZoomOptions,
  },
};

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

    setChartData(undefined);

    async function getPointsChart() {
      let labels: string[] = [];
      let totalPointsChartData: { datasets: any; labels: string[] };
      let totalPoints: number[] = [];
      // Read all era points
      const allErasPoints = erasPoints.data;

      allErasPoints?.forEach(({ era, eraPoints }, index) => {
        if (eraPoints.toNumber()) {
          // Build array of x-axis lables with eras.
          labels[index] = era.toString();
          totalPoints[index] = eraPoints.toNumber();
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
    }
    getPointsChart();
  }, [erasPoints.data]);

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

export default ErasPointsTotalsChart;
