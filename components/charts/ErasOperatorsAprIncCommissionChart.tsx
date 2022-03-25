import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../Spinner';
import { defaultChartZoomOptions, operatorsNames } from '../../constants/constants';
import * as d3 from 'd3';
import BN from 'bn.js';
import { BN_BILLION, BN_ZERO } from '@polkadot/util';
import { useErasExposure, useErasPoints, useErasPrefs, useErasRewards } from '../../hooks/StakingQueries';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  highlight?: string[] | undefined;
}

const chartOptions = {
  responsive: true,
  scales: {
    x: { title: { display: true, text: 'Era' } },
    y: { title: { display: true, text: `APR [%]` } },
  },
  plugins: {
    title: {
      display: true,
      text: `Operator APR per Era (inc. commission)`,
      font: { size: 20 },
    },
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

const ErasOperatorsAprIncCommissionChart = ({ highlight }: IProps) => {
  // Define reference for tracking mounted state
  const mountedRef = useRef(false);
  // Effect for tracking mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [chartData, setChartData] = useState<{ datasets: any; labels: string[] }>();
  const [showMiniSpinner, setShowMiniSpinner] = useState<boolean>(false);
  const [fetching, setFetching] = useState<boolean>(false);
  const erasExposure = useErasExposure({ enabled: fetching, staleTime: 12345 });
  const erasPoints = useErasPoints({ enabled: fetching });
  const erasRewards = useErasRewards({ enabled: fetching });
  const erasPrefs = useErasPrefs({ enabled: fetching });

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const dataIsFetching = useMemo(() => {
    setFetching(
      erasExposure.isFetching ||
        erasPoints.isFetching ||
        erasRewards.isFetching ||
        erasPrefs.isFetching ||
        !erasExposure.data ||
        !erasPoints.data ||
        !erasRewards.data ||
        !erasPrefs.data
    );
    return erasExposure.isFetching || erasPoints.isFetching || erasRewards.isFetching || erasPrefs.isFetching;
  }, [
    erasExposure.data,
    erasExposure.isFetching,
    erasPoints.data,
    erasPoints.isFetching,
    erasPrefs.data,
    erasPrefs.isFetching,
    erasRewards.data,
    erasRewards.isFetching,
  ]);

  useEffect(() => {
    // If the API is not connected or we haven't the required data return.
    if (!erasExposure.data || !erasPoints.data || !erasRewards.data || !erasPrefs.data) return;

    // Show mini spinner while data is refreshing. Only displays when there is chart data.
    // If there is no chart data chart first renders with old sata while fetching is happening.
    if (chartData && dataIsFetching) {
      setShowMiniSpinner(true);
      return;
    }

    async function getAprByOperatorData() {
      let labels: string[] = [];
      let aprDatasets: { [key: string]: number[] } = {};
      let aprChartData: { datasets: any; labels: string[] };
      let averageApr: number[] = [];

      // Read all era exposure (totals staked)
      const allErasExposure = erasExposure.data!;
      // Read all era points
      const allErasPoints = erasPoints.data!;
      // Read all era rewards
      const allErasRewards = erasRewards.data!;
      // Read all commission preferences
      const allErasPrefs = erasPrefs.data!;

      // use points and rewards with totals to calculate APRs
      allErasPoints?.forEach(({ era, eraPoints, validators }, index) => {
        // Check points are available for the era as api.derive functions return an
        // empty data set when current era != active era i.e. last session of an era
        if (eraPoints.toNumber()) {
          // Build array of x-axis lables with eras.
          // API derive has eras sorted for both erasPoints and eraRewards so we
          // to use index to populate arrays.
          labels[index] = era.toString();
          let sumOfTotals = new BN(0);
          let afterCommissionSum = BN_ZERO;
          // build array of APRs for each validator
          Object.entries(validators).forEach(([id, points]) => {
            if (!aprDatasets[id]) {
              aprDatasets[id] = new Array(allErasPoints.length).fill(0);
            }
            // TODO see about tidying this up better for when a validator has no assigned tokens
            // const totalAssigned = allErasExposure![index].validators[id].total;
            const eraExposure = allErasExposure.find((exposure) => {
              return exposure.era.toNumber() === era.toNumber();
            });
            if (!!eraExposure) {
              const totalAssigned = eraExposure.validators[id].total;
              // commission is scaled by 1 billion
              const afterCommission = BN_BILLION.sub(allErasPrefs[index].validators[id].commission.toBn());

              // const afterCommission = BN_BILLION.sub(allErasPrefs[index].validators[id].commission.toBn());
              afterCommissionSum = afterCommissionSum.add(afterCommission);
              aprDatasets[id][index] =
                new BN(365 * 100).mul(allErasRewards[index].eraReward).mul(points).mul(afterCommission).div(eraPoints.mul(BN_BILLION)).toNumber() /
                totalAssigned.toNumber();
              sumOfTotals = sumOfTotals.add(totalAssigned.toBn());
            }
          });
          const numberOfOperators = new BN(Object.keys(validators).length);
          const averageCommission = afterCommissionSum.div(numberOfOperators);
          let averageTotal = sumOfTotals.div(numberOfOperators);
          averageApr[index] =
            new BN(365 * 100).mul(allErasRewards[index].eraReward).mul(averageCommission).div(numberOfOperators.mul(BN_BILLION)).toNumber() /
            averageTotal.toNumber();
        }
      });

      // Create chart datasets
      aprChartData = {
        labels,
        datasets: [
          {
            label: 'Average',
            data: averageApr,
            borderColor: 'rgb(255,0,0)',
            backgroundColor: 'rgba(255,0,0,0.5)',
            borderWidth: 2,
            borderDash: [3, 5],
            pointRadius: 2,
          },
        ],
      };

      Object.entries(aprDatasets).forEach(([operator, apr], index) => {
        let color = d3.rgb(d3.interpolateTurbo(index / (Object.keys(aprDatasets).length - 1)));
        color.opacity = 0.75;
        if (highlight?.includes(operator)) {
          aprChartData.datasets.unshift({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: apr,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 2,
          });
        } else {
          color.opacity = 0.15;
          aprChartData.datasets.push({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: apr,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 2,
          });
        }
      });

      setShowMiniSpinner(false);

      // Before setting the chart data ensure the component is still mounted
      // and only update if the chart data has changed..
      if (mountedRef.current && JSON.stringify(aprChartData) !== JSON.stringify(chartData)) {
        setChartData(aprChartData);
      }
      return;
    }

    getAprByOperatorData();
  }, [chartData, dataIsFetching, erasExposure, erasPoints, erasPrefs, erasRewards, highlight]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Line ref={chartRef} options={chartOptions} data={chartData} />
          <button className='resetZoomButton' onClick={resetChartZoom}>
            Reset Zoom
          </button>
          {showMiniSpinner ? <MiniSpinner /> : <></>}
        </>
      ) : (
        <>
          <Spinner />
          Reading Historical Totals
        </>
      )}
    </div>
  );
};

export default ErasOperatorsAprIncCommissionChart;
