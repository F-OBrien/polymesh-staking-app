import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { defaultChartOptions, operatorsNames } from '../../../constants/constants';
import * as d3 from 'd3';
import { useSdk } from '../../../hooks/useSdk';
import { useErasStakers } from '../../../hooks/StakingQueries';
import { BigNumber } from '@polymeshassociation/polymesh-sdk';
import { useStakingContext } from '../../../hooks/useStakingContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface TotalsHistoryData {
  labels?: string[];
  totalsDatasets?: { [key: string]: string[] };
  averageTotal?: string[];
}

const ErasOperatorsTotalStakedChart = () => {
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
    chainData: { tokenDecimals, tokenSymbol },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;
  const {
    eraInfo: { currentEra },
    operatorsToHighlight: highlight,
  } = useStakingContext();

  const [chartData, setChartData] = useState<ChartData<'line', string[]>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const [totalsHistoryData, setTotalsHistoryData] = useState<TotalsHistoryData>({});
  const erasStakingData = useErasStakers({ enabled: fetchQueries });

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const chartOptions = useMemo(() => {
    // Make a copy of the default options.
    // @ts-ignore - typescript doesn't yet recognize this function. TODO remove ignore once supported
    const options = structuredClone(defaultChartOptions);
    // Override defaults with chart specific options.
    options.scales.x.title.text = 'Era';
    options.scales.y.title.text = `Amount [${tokenSymbol}]`;
    options.plugins.title.text = `Total ${tokenSymbol} Assigned to Operators per Era`;

    return options;
  }, [tokenSymbol]);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return erasStakingData.isFetching;
  }, [erasStakingData.isFetching]);

  // If the era changes or if data is missing set `fetchQueries` to true to trigger fetching/refetching all data.
  useEffect(() => {
    if (erasStakingData.isFetching || !mountedRef.current) return;

    if (!erasStakingData.data) {
      setFetchQueries(true);
      return;
    }
    // Check we have up to date data.
    // If any of the data is not latest re-enable fetching queries.
    if (currentEra.toNumber() > erasStakingData.data![erasStakingData.data!.length - 1].era.toNumber()) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [currentEra, erasStakingData.data, erasStakingData.isFetching]);

  useEffect(() => {
    if (!erasStakingData.data) {
      return;
    }

    let labels: string[] = [];
    let totalsDatasets: { [key: string]: string[] } = {};
    let averageTotal: string[] = [];

    // Read all era exposure (totals staked)
    const historicalErasStakingData = erasStakingData.data;

    historicalErasStakingData?.forEach(({ era, operators }, index) => {
      labels[index] = era.toString();
      let sumOfTotals = new BigNumber(0);
      Object.entries(operators).forEach(([id, { total }]) => {
        totalsDatasets[id] = totalsDatasets[id] || new Array(historicalErasStakingData?.length).fill(0);
        totalsDatasets[id][index] = new BigNumber(total.toString()).div(divisor).toString();
        sumOfTotals = sumOfTotals.plus(total.toString());
      });

      averageTotal[index] = sumOfTotals.div(Object.entries(operators).length * divisor!).toString();
    });
    if (mountedRef.current) {
      setTotalsHistoryData({ labels, totalsDatasets, averageTotal });
    }
  }, [currentEra, divisor, erasStakingData.data, highlight]);

  useEffect(() => {
    if (!totalsHistoryData.labels || !totalsHistoryData.totalsDatasets || !totalsHistoryData.averageTotal) return;

    const { labels, totalsDatasets, averageTotal } = totalsHistoryData;

    let totalsChartData: ChartData<'line', string[]>;

    // Create chart datasets
    totalsChartData = {
      labels,
      datasets: [
        {
          label: 'Average',
          data: averageTotal,
          borderColor: 'rgb(255,0,0)',
          backgroundColor: 'rgba(255,0,0,0.5)',
          borderWidth: 2,
          borderDash: [3, 5],
          pointRadius: 2,
          yAxisID: 'y',
          hoverBorderColor: 'black',
          hoverBackgroundColor: 'rgb(255,0,0)',
        },
      ],
    };

    Object.entries(totalsDatasets).forEach(([operator, total], index) => {
      let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(totalsDatasets).length - 1)));
      color.opacity = 0.9;
      if (highlight?.includes(operator)) {
        totalsChartData.datasets.unshift({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: total,
          borderColor: color.formatRgb(),
          backgroundColor: color.formatRgb(),
          borderWidth: 2,
          pointRadius: 2,
          yAxisID: 'y',
          hoverBorderColor: 'black',
        });
      } else {
        color.opacity = 0.2;
        totalsChartData.datasets.push({
          label: operatorsNames[operator] ? operatorsNames[operator] : operator,
          data: total,
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
      setChartData(totalsChartData);
    }
    return;
  }, [highlight, totalsHistoryData]);

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
          Loading Staking History
        </>
      )}
    </div>
  );
};

export default ErasOperatorsTotalStakedChart;
