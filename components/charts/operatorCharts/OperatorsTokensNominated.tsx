import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Bar } from 'react-chartjs-2';
import * as d3 from 'd3';
import { operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { BN } from '@polkadot/util';
import { useSdk } from '../../../hooks/useSdk';

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, zoomPlugin);

const OperatorsTokensNominated = () => {
  const {
    api,
    chainData: { tokenDecimals, tokenSymbol },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;

  const [chartData, setChartData] = useState<ChartData<'bar'>>();

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
          text: `Total ${tokenSymbol} Nominated by Operator`,
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
  }, [tokenSymbol]);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return false;
  }, []);

  useEffect(() => {
    async function getNominatedTotkens() {
      let labels: string[] = [];
      let data: number[] = [];
      let bgcolor: any[] = [];
      let bdcolor: any[] = [];

      //TODO: consider converting calls to react query calls or subscriptions.
      const nominations = await api?.query.staking.nominators.entries();
      const stakingLedger = await api?.query.staking.ledger.entries();
      const validators = await api?.query.staking.validators.keys();

      const amountStaked: Record<string, BN> = {};
      const nominated: Record<string, BN> = {};

      stakingLedger.forEach(([, ledger]) => {
        const unwrappedLedger = ledger.unwrapOrDefault();
        amountStaked[unwrappedLedger.stash.toString()] = unwrappedLedger.total.unwrap();
      });

      nominations.forEach(([{ args: nominator }, nominations]) => {
        nominations.unwrap().targets.forEach((operator) => {
          nominated[operator.toString()] = nominated[operator.toString()]
            ? nominated[operator.toString()].add(amountStaked[nominator.toString()])
            : amountStaked[nominator.toString()];
        });
      });

      let pos: number;

      validators.forEach(({ args: operator }, index) => {
        const amountNominated = nominated[operator.toString()] ? nominated[operator.toString()].toNumber() / divisor : 0;
        // Sort from highest to Lowest
        // If there is nothing in the array add to first position.
        if (data.length === 0) {
          data.push(amountNominated);
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
            if (amountNominated === data[mid]) {
              pos = mid + 1;
              break;
              // If the amount is greater than the mid position it should be before mid.
            } else if (amountNominated > data[mid]) {
              pos = end = mid - 1;
            } else {
              //  If the amount is less than than the mid position it should be after it.
              pos = start = mid + 1;
            }
            // Once the end of the search is reached the posiiton should be the final "start"
            // This ensures the new data is not inserted at a position of mid -1 which would
            // place it out of order.
            if (start > end) {
              pos = start;
            }
          }
          data.splice(pos, 0, amountNominated);
        }

        labels.splice(pos, 0, operatorsNames[operator.toString()] ? operatorsNames[operator.toString()] : operator.toString());

        const color = d3.rgb(d3.interpolateSinebow(index / (Object.keys(validators).length - 1)));
        bdcolor[index] = color;
        const bgCol = { ...color };
        bgCol.opacity = 0.4;
        bgcolor[index] = `rgba(${color.r},${color.g},${color.b},0.5)`;
      });

      const nominatedChartData = {
        labels: labels,
        datasets: [
          {
            label: 'Nominated',
            data: data,
            backgroundColor: bgcolor,
            borderColor: bdcolor,
            borderWidth: 2,
          },
        ],
      };

      // Before setting the chart data ensure the component is still mounted
      if (mountedRef.current) {
        setChartData(nominatedChartData);
      }

      return;
    }
    getNominatedTotkens();
  }, [api?.query.staking.ledger, api?.query.staking.nominators, api?.query.staking.validators, divisor]);

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

export default OperatorsTokensNominated;
