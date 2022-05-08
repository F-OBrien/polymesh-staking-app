import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import * as d3 from 'd3';
import { defaultChartOptions, operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { useErasPrefs } from '../../../hooks/stakingPalletHooks/useErasPrefs_to_be_removed';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  highlight?: string[] | undefined;
}

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
  const erasPrefs = useErasPrefs({ enabled: true });

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
    options.plugins.title.text = 'Operator Commission per Era';

    return options;
  }, []);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return false;
  }, []);

  useEffect(() => {
    if (!erasPrefs.data) {
      return;
    }

    async function getCommissionChart() {
      let labels: string[] = [];
      let commissionDatasets: { [key: string]: number[] } = {};
      let commissionChartData: { datasets: any; labels: string[] };
      let averageCommission: number[] = [];

      // Read all era points
      const allErasPrefs = erasPrefs.data;

      allErasPrefs?.forEach(({ era, operators }, index) => {
        let sum = 0;
        // Build array of x-axis labels with eras.
        labels[index] = era.toString();

        // build array of commission for each validator
        Object.entries(operators).forEach(([id, { commission }]) => {
          commissionDatasets[id] = commissionDatasets[id] || new Array(allErasPrefs.length).fill(0);
          // if (!commissionDatasets[id]) {
          //   commissionDatasets[id] = new Array(84).fill(0);
          // }
          commissionDatasets[id][index] = commission.toNumber() / 10000000;
          sum = sum + commission.toNumber();
        });
        averageCommission[index] = sum / (10000000 * Object.keys(operators).length);
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
        let color = d3.rgb(d3.interpolateSinebow(index / (Object.keys(commissionDatasets).length - 1)));
        color.opacity = 0.9;
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
          color.opacity = 0.2;
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

export default ErasOperatorsCommissionChart;
