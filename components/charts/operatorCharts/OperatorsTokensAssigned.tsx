import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Bar } from 'react-chartjs-2';
import { operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { useSdk } from '../../../hooks/useSdk';
import { useEraStakers } from '../../../hooks/StakingQueries';
import { useStakingContext } from '../../../hooks/useStakingContext';

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, zoomPlugin);

interface AssignedData {
  labels?: string[];
  data?: number[];
}

const OperatorsTokensAssigned = () => {
  const {
    chainData: { tokenDecimals, tokenSymbol },
    encodedSelectedAddress,
  } = useSdk();
  const divisor = 10 ** tokenDecimals;
  const {
    eraInfo: { currentEra },
  } = useStakingContext();

  const [chartData, setChartData] = useState<ChartData<'bar'>>();
  const [assignedData, setAssignedData] = useState<AssignedData>({});
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
          text: `Total ${tokenSymbol} Assigned to Operators (Era ${currentEra.toNumber()})`,
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
    return currentEraStakingData.isFetching;
  }, [currentEraStakingData.isFetching]);

  useEffect(() => {
    if (!currentEraStakingData.data) return;

    let labels: string[] = [];
    let data: number[] = [];

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
          // If the amount is the same as mid position position we can add at the mid +1 position.
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
          // Once the end of the search is reached the position should be the final "start"
          // This ensures the new data is not inserted at a position of mid -1 which would
          // place it out of order.
          if (start > end) {
            pos = start;
          }
        }
        data.splice(pos, 0, totalAssigned);
      }

      labels.splice(pos, 0, operator.toString());
    });

    if (mountedRef.current) {
      setAssignedData({ labels, data });
    }
  }, [currentEraStakingData.data, divisor]);

  useEffect(() => {
    if (!assignedData.labels || !assignedData.data) return;

    const { labels, data } = assignedData;

    let bgcolor: any[] = [];
    let bdcolor: any[] = [];
    let namedLabels: string[] = [];
    labels.forEach((operator, index) => {
      if (
        encodedSelectedAddress &&
        currentEraStakingData.data?.nominators[encodedSelectedAddress]?.some((nominated) => nominated.operator === operator)
      ) {
        bdcolor[index] = 'black';
        bgcolor[index] = '#43195B95';
      } else {
        bdcolor[index] = '#EC4673';
        bgcolor[index] = '#EC467395';
      }

      // Assign Operator name if available
      namedLabels[index] = operatorsNames[operator]
        ? operatorsNames[operator]
        : operator.slice(0, 5) + '...' + operator.slice(operator.length - 5, operator.length);
    });

    const assignedTokensChartData = {
      labels: namedLabels,
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
  }, [assignedData, currentEraStakingData.data?.nominators, encodedSelectedAddress]);

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
