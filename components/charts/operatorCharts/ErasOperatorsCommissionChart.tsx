import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import * as d3 from 'd3';
import { defaultChartOptions, operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { useErasPreferences } from '../../../hooks/StakingQueries';
import { useStakingContext } from '../../../hooks/useStakingContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface CommissionHistoryData {
  labels?: string[];
  commissionDatasets?: { [key: string]: number[] };
  averageCommission?: number[];
}

const ErasOperatorsCommissionChart = () => {
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
    eraInfo: { currentEra },
    operatorsToHighlight: highlight,
  } = useStakingContext();
  const [chartData, setChartData] = useState<ChartData<'line'>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const [commissionHistoryData, setCommissionHistoryData] = useState<CommissionHistoryData>({});
  const erasPrefs = useErasPreferences({ enabled: fetchQueries });

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
    options.plugins!.title!.text = 'Operator Commission per Era';

    return options;
  }, []);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return erasPrefs.isFetching;
  }, [erasPrefs.isFetching]);

  // If the era changes or if data is missing set `fetchQueries` to true to trigger fetching/refetching all data.
  useEffect(() => {
    if (erasPrefs.isFetching || !mountedRef.current) return;

    if (!erasPrefs.data) {
      setFetchQueries(true);
      return;
    }
    // Check we have up to date data.
    // If any of the data is not latest re-enable fetching queries.
    if (currentEra.toNumber() > erasPrefs.data![erasPrefs.data!.length - 1].era.toNumber()) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [currentEra, erasPrefs.data, erasPrefs.isFetching]);

  useEffect(() => {
    if (!erasPrefs.data) {
      return;
    }

    let labels: string[] = [];
    let commissionDatasets: { [key: string]: number[] } = {};
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

    if (mountedRef.current) {
      setCommissionHistoryData({ labels, commissionDatasets, averageCommission });
    }
  }, [erasPrefs.data]);

  useEffect(() => {
    if (!commissionHistoryData.labels || !commissionHistoryData.commissionDatasets || !commissionHistoryData.averageCommission) return;

    const { labels, commissionDatasets, averageCommission } = commissionHistoryData;

    let commissionChartData: ChartData<'line'>;

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
          pointRadius: 0,
          yAxisID: 'y',
        },
      ],
    };

    Object.entries(commissionDatasets).forEach(([operator, commission], index) => {
      let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(commissionDatasets).length - 1)));
      const hoverColor = (color: d3.RGBColor) => {
        color.opacity = 1;
        return color;
      };

      if (highlight?.includes(operator)) {
        color.opacity = 0.9;
        commissionChartData.datasets.unshift({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: commission,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: 'y',
          hoverBorderColor: hoverColor(color).formatRgb(),
        });
      } else {
        color.opacity = 0.2;
        commissionChartData.datasets.push({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: commission,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: 'y',
          hoverBorderColor: hoverColor(color).formatRgb(),
        });
      }
    });

    // Before setting the chart data ensure the component is still mounted
    if (mountedRef.current) {
      setChartData(commissionChartData);
    }
    return;
  }, [commissionHistoryData, highlight]);

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
