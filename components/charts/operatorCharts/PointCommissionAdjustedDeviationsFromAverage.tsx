import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import * as d3 from 'd3';
import { defaultChartOptions, operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { useStakingContext } from '../../../hooks/useStakingContext';

import { useErasPreferences, useErasRewardPoints } from '../../../hooks/StakingQueries';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface PointsHistoryData {
  labels?: string[];
  averageDeviationDatasets?: { [key: string]: number[] };
}

interface Props {
  trendPeriod: number;
}

const PointCommissionAdjustedDeviationsFromAverage = ({ trendPeriod }: Props) => {
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
    eraInfo: { activeEra, currentEra },
    operatorsToHighlight: highlight,
  } = useStakingContext();

  const [chartData, setChartData] = useState<ChartData<'line'>>();
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const [pointsHistoryData, setPointsHistoryData] = useState<PointsHistoryData>({});
  const erasPoints = useErasRewardPoints({ enabled: fetchQueries });
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
    options.plugins!.title!.text = 'Cumulative % Deviation from Average Era Points - Commission Adjusted';
    options.plugins!.legend!.display = undefined;

    return options;
  }, []);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return erasPoints.isFetching || erasPrefs.isFetching;
  }, [erasPoints.isFetching, erasPrefs.isFetching]);

  // If the era changes or if data is missing set `fetchQueries` to true to trigger fetching/refetching all data.
  useEffect(() => {
    if (erasPoints.isFetching || erasPrefs.isFetching || !mountedRef.current) return;

    if (!erasPoints.data || !erasPrefs.data) {
      setFetchQueries(true);
      return;
    }
    // Check we have up to date data.
    const pointsDataNotCurrent = activeEra.toNumber() - 1 > erasPoints.data![erasPoints.data!.length - 1].era.toNumber();
    const prefsDataNotCurrent = currentEra.toNumber() > erasPrefs.data![erasPrefs.data!.length - 1].era.toNumber();
    // If any of the data is not latest re-enable fetching queries.
    if (pointsDataNotCurrent || prefsDataNotCurrent) {
      setFetchQueries(true);
    } else {
      setFetchQueries(false);
    }
  }, [activeEra, currentEra, erasPoints.data, erasPoints.isFetching, erasPrefs.data, erasPrefs.isFetching]);

  useEffect(() => {
    if (!erasPoints.data || !erasPrefs.data) {
      return;
    }

    let labels: string[] = [];
    let averageDeviationDatasets: { [key: string]: number[] } = {};
    let averageDeviationSum: { [key: string]: number } = {};
    let averagePointsAfterCommission: number[] = [];

    // Read all era points
    const allErasPoints = erasPoints.data;
    const historicalErasPrefs = erasPrefs.data!;
    const erasPointsToTrend = allErasPoints.slice(-trendPeriod);

    erasPointsToTrend?.forEach(({ era, total, operators }, index) => {
      if (total.toNumber()) {
        // Build array of x-axis labels with eras.
        labels[index] = era.toString();
        // Search for the data for the corresponding era. While the data should be sorted by era this
        // ensures correct calculations if queries were not fetched with the same era range.
        const eraPreferences = historicalErasPrefs.find((data) => {
          return data.era.toNumber() === era.toNumber();
        });
        let totalPointsAfterCommission = 0;
        let pointsAfterCommission: Record<string, number> = {};
        if (eraPreferences) {
          // build array of cumulative deviation from average points for each validator
          Object.entries(operators).forEach(([id, points]) => {
            pointsAfterCommission[id.toString()] = (1 - eraPreferences.operators[id].commission.toNumber() / 1_000_000_000) * points.toNumber();
            totalPointsAfterCommission = totalPointsAfterCommission + pointsAfterCommission[id.toString()];
          });
        }

        averagePointsAfterCommission[index] = totalPointsAfterCommission / Object.keys(operators).length;

        Object.entries(pointsAfterCommission).forEach(([id, points]) => {
          const percentOfAverage = 100 * (points / averagePointsAfterCommission[index] - 1);
          averageDeviationSum[id] = averageDeviationSum[id] || 0;
          averageDeviationSum[id] = averageDeviationSum[id] + percentOfAverage;

          averageDeviationDatasets[id] = averageDeviationDatasets[id] || new Array(erasPointsToTrend.length);
          averageDeviationDatasets[id][index] = averageDeviationSum[id];
        });
      }
    });
    if (mountedRef.current) {
      setPointsHistoryData({ labels, averageDeviationDatasets });
    }
  }, [erasPoints.data, erasPrefs.data, trendPeriod]);

  useEffect(() => {
    if (!pointsHistoryData.labels || !pointsHistoryData.averageDeviationDatasets) return;

    const { labels, averageDeviationDatasets } = pointsHistoryData;
    let pointsChartData: { datasets: any; labels: string[] };

    pointsChartData = {
      labels,
      datasets: [
        {
          label: 'Average',
          data: new Array(labels.length).fill(0),
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

    Object.entries(averageDeviationDatasets).forEach(([operator, points], index) => {
      let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(averageDeviationDatasets).length - 1)));
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
        color.opacity = 0.3;
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

export default PointCommissionAdjustedDeviationsFromAverage;
