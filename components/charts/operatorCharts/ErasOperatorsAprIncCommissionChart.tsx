import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner, { MiniSpinner } from '../../Spinner';
import { defaultChartOptions, operatorsNames, BN_MILLISECONDS_PER_YEAR } from '../../../constants/constants';
import * as d3 from 'd3';
import { BN, BN_BILLION, BN_ZERO, BN_HUNDRED } from '@polkadot/util';
import { useErasExposure, useErasPoints, useErasRewards } from '../../../hooks/StakingQueries';
import { useErasStakers } from '../../../hooks/stakingPalletHooks/useErasStakers';
import { useErasPrefs } from '../../../hooks/stakingPalletHooks/useErasPrefs';
import { EraIndex } from '@polkadot/types/interfaces';
import { useHistoricalEras } from '../../../hooks/stakingPalletHooks/useHistoricalEras';
import { useSdk } from '../../../hooks/useSdk';
import { EraInfo } from '../../../pages/operator-charts';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  highlight?: string[];
  eraInfo: EraInfo;
}

const ErasOperatorsAprIncCommissionChart = ({ highlight, eraInfo: { activeEra } }: IProps) => {
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
  const [fetchQueries, setFetchQueries] = useState<boolean>(false);
  const [previousEra, setPreviousEra] = useState<EraIndex>();
  // const historicalEras = useHistoricalEras();
  const erasStakingData = useErasStakers({ staleTime: 50000, enabled: fetchQueries });
  const erasExposure = useErasExposure({ enabled: fetchQueries /*, staleTime: 12345 */ });
  const erasPoints = useErasPoints({ enabled: fetchQueries });
  const erasRewards = useErasRewards({ enabled: fetchQueries });
  const erasPrefs = useErasPrefs({ enabled: fetchQueries });
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
    options.plugins.title.text = 'Operator APR per Era (inc. commission)';

    return options;
  }, []);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return erasExposure.isFetching || erasPoints.isFetching || erasRewards.isFetching || erasPrefs.isFetching;
  }, [erasExposure.isFetching, erasPoints.isFetching, erasPrefs.isFetching, erasRewards.isFetching]);

  // Set `dataMissing` to true while any of the required data is missing.
  const dataMissing = useMemo(() => {
    return !erasExposure.data || !erasPoints.data || !erasRewards.data || !erasPrefs.data;
  }, [erasExposure.data, erasPoints.data, erasPrefs.data, erasRewards.data]);

  const erasPerYear = useMemo(
    () => BN_MILLISECONDS_PER_YEAR.div(expectedBlockTime.mul(epochDuration).mul(sessionsPerEra)),
    [epochDuration, expectedBlockTime, sessionsPerEra]
  );

  // If the era changes or if data is missing, or any data is fetching set `fetchQueries` to true to trigger fetching all data.
  useEffect(() => {
    if (!activeEra) return;

    if (previousEra !== activeEra || dataMissing || dataIsFetching) {
      if (mountedRef.current) {
        setFetchQueries(true);
        setPreviousEra(activeEra);
      }
      return;
    }

    if (mountedRef.current) {
      setFetchQueries(false);
      return;
    }
  }, [activeEra, dataIsFetching, dataMissing, previousEra]);

  useEffect(() => {
    // If data is fetching or we don't have required data return.
    if (dataIsFetching || dataMissing) return;

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

      // console.log(erasStakingData);

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
              let afterCommission;
              if (allErasPrefs[index].operators[id]) {
                afterCommission = BN_BILLION.sub(allErasPrefs[index].operators[id].commission.toBn());
              } else {
                afterCommission = BN_ZERO;
              }

              // const afterCommission = BN_BILLION.sub(allErasPrefs[index].validators[id].commission.toBn());
              afterCommissionSum = afterCommissionSum.add(afterCommission);
              aprDatasets[id][index] =
                erasPerYear
                  .mul(BN_HUNDRED)
                  .mul(allErasRewards[index].eraReward)
                  .mul(points)
                  .mul(afterCommission)
                  .div(eraPoints.mul(BN_BILLION))
                  .toNumber() / totalAssigned.toNumber();
              sumOfTotals = sumOfTotals.add(totalAssigned.toBn());
            }
          });
          const numberOfOperators = new BN(Object.keys(validators).length);
          const averageCommission = afterCommissionSum.div(numberOfOperators);
          let averageTotal = sumOfTotals.div(numberOfOperators);
          averageApr[index] =
            erasPerYear
              .mul(BN_HUNDRED)
              .mul(allErasRewards[index].eraReward)
              .mul(averageCommission)
              .div(numberOfOperators.mul(BN_BILLION))
              .toNumber() / averageTotal.toNumber();
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
            stepped: false,
            tension: 0.0,
            // hoverBorderColor: 'black',
            // hoverBackgroundColor: 'black',
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
            stepped: false,
            tension: 0.0,
            // hoverBorderColor: 'black',
            // hoverBackgroundColor: 'black',
          });
        }
      });

      // Before setting the chart data ensure the component is still mounted
      // and only update if the chart data has changed..
      if (mountedRef.current && JSON.stringify(aprChartData) !== JSON.stringify(chartData)) {
        setChartData(aprChartData);
      }
      return;
    }

    getAprByOperatorData();
  }, [chartData, dataIsFetching, dataMissing, erasExposure.data, erasPerYear, erasPoints.data, erasPrefs.data, erasRewards.data, highlight]);

  return (
    <div className='LineChart'>
      {chartData && chartOptions ? (
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

export default ErasOperatorsAprIncCommissionChart;
