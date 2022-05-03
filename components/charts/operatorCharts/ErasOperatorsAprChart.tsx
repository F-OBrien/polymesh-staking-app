import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { operatorsNames, BN_MILLISECONDS_PER_YEAR, defaultChartOptions } from '../../../constants/constants';
import * as d3 from 'd3';
import { BN, BN_HUNDRED } from '@polkadot/util';
import { useErasExposure, useErasPoints, useErasRewards } from '../../../hooks/StakingQueries';
import { useSdk } from '../../../hooks/useSdk';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  highlight?: string[] | undefined;
}

const ErasOperatorsAprChart = ({ highlight }: IProps) => {
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
    chainData: { expectedBlockTime, epochDuration, sessionsPerEra },
  } = useSdk();
  const [chartData, setChartData] = useState<{ datasets: any; labels: string[] }>();
  const erasExposure = useErasExposure({ enabled: false });
  const erasPoints = useErasPoints({ enabled: false });
  const erasRewards = useErasRewards({ enabled: false });

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
    options.scales.y.title.text = 'APR [%]';
    options.plugins.title.text = 'Operator APR per Era (excl. commission)';

    return options;
  }, []);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return false;
  }, []);

  const erasPerYear = useMemo(
    () => BN_MILLISECONDS_PER_YEAR.div(expectedBlockTime.mul(epochDuration).mul(sessionsPerEra)),
    [epochDuration, expectedBlockTime, sessionsPerEra]
  );

  useEffect(() => {
    if (!erasExposure.data || !erasPoints.data || !erasRewards.data) {
      return;
    }

    async function getAprByOperatorData() {
      let labels: string[] = [];
      let aprDatasets: { [key: string]: number[] } = {};
      let aprChartData: { datasets: any; labels: string[] };
      let averageApr: number[] = [];

      // Read all era exposure (totals staked)
      const allErasExposure = erasExposure.data;
      // Read all era points
      const allErasPoints = erasPoints.data;
      // Read all era rewards
      const allErasRewards = erasRewards.data;

      // use points and rewards with totals to calculate APRs
      allErasPoints?.forEach(({ era, eraPoints, validators }, index) => {
        // Check points are available for the era as api.derive functions return an
        // empty data set when current era != active era i.e. last session of an era
        if (eraPoints.toNumber()) {
          // API derive has eras sorted for both erasPoints and eraRewards so ok
          // to use index to populate arrays.

          // Build array of x-axis labels with eras.
          labels[index] = era.toString();
          let sumOfTotals = new BN(0);

          // build array of APRs for each validator
          Object.entries(validators).forEach(([id, points]) => {
            if (!aprDatasets[id]) {
              aprDatasets[id] = new Array(allErasPoints.length).fill(0);
            }

            // TODO see about tidying this up better for when a validator has no assigned tokens
            let totalAssigned;
            if (allErasExposure![index].validators[id]) {
              totalAssigned = allErasExposure![index].validators[id].total.toNumber();
            } else {
              totalAssigned = 0;
            }

            aprDatasets[id][index] =
              erasPerYear.mul(BN_HUNDRED).mul(allErasRewards![index].eraReward).mul(points).div(eraPoints).toNumber() / totalAssigned;
            sumOfTotals = sumOfTotals.add(new BN(totalAssigned));
          });
          const numberOfOperators = new BN(Object.keys(validators).length);
          let averageTotal = sumOfTotals.div(numberOfOperators);
          averageApr[index] =
            erasPerYear.mul(BN_HUNDRED).mul(allErasRewards![index].eraReward).div(numberOfOperators).toNumber() / averageTotal.toNumber();
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
            yAxisID: 'y',
          },
        ],
      };

      Object.entries(aprDatasets).forEach(([operator, apr], index) => {
        let color = d3.rgb(d3.interpolateSinebow(index / (Object.keys(aprDatasets).length - 1)));
        color.opacity = 0.9;
        if (highlight?.includes(operator)) {
          aprChartData.datasets.unshift({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: apr,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          });
        } else {
          color.opacity = 0.2;
          aprChartData.datasets.push({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: apr,
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
        setChartData(aprChartData);
      }
      return;
    }

    getAprByOperatorData();
  }, [erasExposure.data, erasPerYear, erasPoints.data, erasRewards.data, highlight]);

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
          Reading Historical Totals
        </>
      )}
    </div>
  );
};

export default ErasOperatorsAprChart;
