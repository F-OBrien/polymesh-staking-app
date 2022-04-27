import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Bar } from 'react-chartjs-2';
import * as d3 from 'd3';
import { operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { useSdk } from '../../../hooks/useSdk';
import { EraInfo } from '../../../pages/operator-charts';
import { useEraStakers } from '../../../hooks/stakingPalletHooks/useEraStakers';

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  eraInfo: EraInfo;
}

const OperatorsTokensAssigned = ({ eraInfo: { currentEra } }: IProps) => {
  const {
    chainData: { tokenDecimals, tokenSymbol },
    encodedSelectedAddress,
  } = useSdk();
  const divisor = 10 ** tokenDecimals;

  const [chartData, setChartData] = useState<ChartData<'bar'>>();
  const currentEraStakingData = useEraStakers(currentEra, { staleTime: Infinity });

  // Define reference for tracking mounted state
  const mountedRef = useRef(false);
  // Effect for tracking mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const chartOptions = useMemo(() => {
    const options = {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: `Amount [${tokenSymbol}]` },
          // type: 'logarithmic' as const,
        },
      },
      plugins: {
        legend: {
          display: false,
          //   position: 'top' as const,
        },
        title: {
          display: true,
          text: `Total ${tokenSymbol} Assigned to Operators (Era ${currentEra?.toNumber()})`,
          font: { size: 20 },
        },
        zoom: {
          pan: { enabled: true, mode: 'y' as const, overScaleMode: 'y' as const },
          zoom: {
            wheel: { enabled: true },
            mode: 'y' as const,
            // overScaleMode: 'y' as const,
          },
          limits: { y: { min: 0 } },
        },
      },
    };

    return options;
  }, [currentEra, tokenSymbol]);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return false;
  }, []);

  useEffect(() => {
    async function getAssignedTokens() {
      if (!currentEra || !divisor || !currentEraStakingData.data) return;

      let labels: string[] = [];
      let data: number[] = [];
      let bgcolor: any[] = [];
      let bdcolor: any[] = [];

      let pos: number;

      Object.entries(currentEraStakingData.data.operators).forEach(([operator, { total }]) => {
        const totalAssigned = total.unwrap().toNumber() / divisor;
        // Sort from highest to Lowest
        // If there is nothing in the array add to first position.
        if (data.length === 0) {
          data.push(totalAssigned);
          pos = 0;
        }
        // Perform a binary search to find correct position in the sort order.
        else {
          let start = 0;
          let end = data.length - 1;
          pos = 0;

          while (start <= end) {
            var mid = start + Math.floor((end - start) / 2);
            // If the amount is the same as mid position position we can add at the mid +1 posiiton.
            if (totalAssigned === data[mid]) {
              pos = mid + 1;
              break;
              // If the amount is greater than the mid position it should be before mid.
            } else if (totalAssigned > data[mid]) {
              pos = end = mid - 1;
            } else {
              //  If the amount is less than than the mid position it should be after it mid.
              pos = start = mid + 1;
            }
            // Once the end of the search is reached the posiiton should be the final "start"
            // This ensures the new data is not inserted at a position of mid -1 which would
            // place it out of order.
            if (start > end) {
              pos = start;
            }
          }
          data.splice(pos, 0, totalAssigned);
        }

        labels.splice(pos, 0, operator.toString());

        // const color = d3.rgb(d3.interpolateSinebow(index / (Object.keys(eraStakers).length - 1)));
        // bdcolor[index] = color;
        // bgcolor[index] = `rgba(${color.r},${color.g},${color.b},0.5)`;
      });

      labels.forEach((operator, index) => {
        const color = d3.rgb(d3.interpolateSinebow(index / (labels.length - 1)));

        bdcolor[index] = color;
        const opacity = 0.5;
        bgcolor[index] = `rgba(${color.r},${color.g},${color.b},${opacity})`;

        if (encodedSelectedAddress && currentEraStakingData.data?.nominators[encodedSelectedAddress]) {
          currentEraStakingData.data?.nominators[encodedSelectedAddress].forEach(({ operator: backedOperator }) => {
            if (operator === backedOperator) {
              bdcolor[index] = 'black';
              bgcolor[index] = color;
            }
          });
        }

        // Assign Operator name if available
        labels[index] = operatorsNames[operator]
          ? operatorsNames[operator]
          : operator.slice(0, 5) + '...' + operator.slice(operator.length - 5, operator.length);
      });

      const assignedTokensChartData = {
        labels: labels,
        datasets: [
          {
            label: 'Assigned',
            data: data,
            backgroundColor: bgcolor,
            borderColor: bdcolor,
            borderWidth: 2,
          },
        ],
      };

      // Before setting the chart data ensure the component is still mounted
      if (mountedRef.current) {
        setChartData(assignedTokensChartData);
      }

      return;
    }
    getAssignedTokens();
  }, [currentEra, currentEraStakingData.data, divisor, encodedSelectedAddress]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Bar ref={chartRef} options={chartOptions} data={chartData} />
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

export default OperatorsTokensAssigned;
