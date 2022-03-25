import { useRef, useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import Spinner from '../Spinner';
import { defaultChartZoomOptions, operatorsNames } from '../../constants/constants';
import * as d3 from 'd3';
import { EraIndex } from '@polkadot/types/interfaces';
import BN from 'bn.js';
import { useSdk } from '../../hooks/useSdk';
import { useErasExposure } from '../../hooks/StakingQueries';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  highlight?: string[] | undefined;
}

const ErasOperatorsTotalStakedChart = ({ highlight }: IProps) => {
  // Define reference for tracking mounted state
  const mountedRef = useRef(false);
  // Effect for tracking mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { api } = useSdk();
  const [chartData, setChartData] = useState<any>();
  const [showMiniSpinner, setShowMiniSpinner] = useState<boolean>(false);
  const erasExposure = useErasExposure({ enabled: false });
  const {
    chainData: { tokenDecimals, tokenSymbol },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const chartOptions = {
    responsive: true,
    scales: {
      x: { title: { display: true, text: 'Era' } },
      y: { title: { display: true, text: `Amount [${tokenSymbol}]` } },
    },
    plugins: {
      title: {
        display: true,
        text: `Total ${tokenSymbol} Assigned to Operators per Era`,
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

  useEffect(() => {
    if (!erasExposure.data || !divisor) {
      return;
    }
    // setChartData(undefined);

    async function getTotalsStakedByOperatorData() {
      let labels: string[] = [];
      let totalsDatasets: { [key: string]: number[] } = {};
      let totalsChartData: { datasets: any; labels: string[] };
      let averageTotal: number[] = [];
      let activeEraIndex: EraIndex;

      // Read all era exposure (totals staked)
      let allErasExposure = erasExposure.data;
      const currentEra = await api?.query.staking.currentEra();
      const activeEraInfo = await api?.query.staking.activeEra();
      // Type is Option<ActiveEraInfo>, so we have to check if the value actually exists
      if (activeEraInfo?.isSome) {
        activeEraIndex = activeEraInfo.unwrap().index;

        if (activeEraIndex > allErasExposure![allErasExposure!.length - 1].era) {
          const activeEraExposure = await api?.derive.staking.eraExposure(activeEraIndex);
          allErasExposure?.push(activeEraExposure!);
        }
      }
      // Type is Option<EraIndex>, so we have to check if the value actually exists
      if (currentEra?.isSome) {
        const era = currentEra.unwrap();
        // if next era is already planned get its info.

        if (era > allErasExposure![allErasExposure!.length - 1].era) {
          const plannedEra = await api?.derive.staking.eraExposure(era);
          allErasExposure?.push(plannedEra!);
          allErasExposure?.shift();
        }
      }

      allErasExposure?.forEach(({ era, validators }, index) => {
        labels[index] = era.toString();
        let sumOfTotals = new BN(0);
        Object.entries(validators).forEach(([id, { total }]) => {
          if (!totalsDatasets[id]) {
            totalsDatasets[id] = new Array(allErasExposure?.length).fill(0);
          }
          totalsDatasets[id][index] = total.toNumber() / divisor!;
          sumOfTotals = sumOfTotals.add(total.toBn());
        });

        averageTotal[index] = sumOfTotals.toNumber() / (Object.entries(validators).length * divisor!);
      });

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
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          });
        } else {
          color.opacity = 0.1;
          totalsChartData.datasets.push({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: total,
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
        setChartData(totalsChartData);
      }
      return;
    }

    getTotalsStakedByOperatorData();
  }, [api, divisor, erasExposure.data, highlight]);

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
          Reading Historical Totals
        </>
      )}
    </div>
  );
};

export default ErasOperatorsTotalStakedChart;
