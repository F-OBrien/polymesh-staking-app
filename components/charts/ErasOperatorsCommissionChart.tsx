import { useRef, useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import * as d3 from 'd3';
import { defaultChartZoomOptions, operatorsNames } from '../../constants/constants';
import Spinner from '../Spinner';
import { useErasPrefs } from '../../hooks/StakingQueries';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  highlight?: string[] | undefined;
}

let chartOptions = {
  responsive: true,
  scales: {
    x: { title: { display: true, text: 'Era' } },
    y: { title: { display: true, text: 'Percent [%]' } },
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
      text: 'Operator Commission per Era',
      font: { size: 20 },
    },
    zoom: defaultChartZoomOptions,
  },
};

const ErasOperatorsCommissionChart = ({ highlight }: IProps) => {
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
  const erasPrefs = useErasPrefs({ enabled: false });

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  useEffect(() => {
    if (!erasPrefs.data) {
      return;
    }

    setChartData(undefined);

    async function getCommissionChart() {
      let labels: string[] = [];
      let commissionDatasets: { [key: string]: number[] } = {};
      let commissionChartData: { datasets: any; labels: string[] };
      let averageCommission: number[] = [];

      // Read all era points
      const allErasPrefs = erasPrefs.data;

      allErasPrefs?.forEach(({ era, validators }, index) => {
        let sum = 0;
        // Build array of x-axis lables with eras.
        labels[index] = era.toString();

        // build array of points for each validator
        Object.entries(validators).forEach(([id, { commission }]) => {
          if (!commissionDatasets[id]) {
            commissionDatasets[id] = new Array(84).fill(0);
          }
          commissionDatasets[id][index] = commission.toNumber() / 10000000;
          sum = sum + commission.toNumber();
        });
        averageCommission[index] = sum / (10000000 * Object.keys(validators).length);
      });

      commissionChartData = {
        labels,
        datasets: [
          {
            label: 'Average',
            data: averageCommission,
            borderColor: 'rgb(200,0,0)',
            backgroundColor: 'rgba(200,0,0,0.5)',
            borderWidth: 2,
            borderDash: [3, 5],
            pointRadius: 2,
            yAxisID: 'y',
          },
        ],
      };

      Object.entries(commissionDatasets).forEach(([operator, commission], index) => {
        let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(commissionDatasets).length - 1)));
        if (highlight?.includes(operator)) {
          commissionChartData.datasets.unshift({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: commission,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          });
        } else {
          color.opacity = 0.1;
          commissionChartData.datasets.push({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: commission,
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
        setChartData(commissionChartData);
      }
      return;
    }

    getCommissionChart();
  }, [erasPrefs.data, highlight]);

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

export default ErasOperatorsCommissionChart;
