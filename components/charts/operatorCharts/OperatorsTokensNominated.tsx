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

interface IProps {
  highlight?: string[] | undefined;
}

const OperatorsTokensNominated = ({ highlight }: IProps) => {
  const {
    api,
    chainData: { tokenDecimals, tokenSymbol },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;

  const [chartData, setChartData] = useState<ChartData<'bar' | 'line'>>();

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
        y1: {
          beginAtZero: true,
          title: { display: true, text: `Commission [%]` },
          position: 'right' as const,
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
      let commission: number[] = [];
      let bgcolor: any[] = [];
      let bdcolor: any[] = [];

      //TODO: consider converting calls to react query calls or subscriptions.
      const nominations = await api?.query.staking.nominators.entries();
      const stakingLedger = await api?.query.staking.ledger.entries();
      const validators = await api?.query.staking.validators.entries();
      const validators = await api?.query.staking.validators.keys();

      const amountStaked: Record<string, BN> = {};
      const nominated: Record<string, BN> = {};

      stakingLedger.forEach(([, ledger]) => {
        const unwrappedLedger = ledger.unwrapOrDefault();
        amountStaked[unwrappedLedger.stash.toString()] = unwrappedLedger.total.unwrap();
      });

      nominations.forEach(([{ args: nominator }, nominations]) => {
        if (nominations.isSome) {
          nominations.unwrap().targets.forEach((operator) => {
            nominated[operator.toString()] = nominated[operator.toString()]
              ? nominated[operator.toString()].add(amountStaked[nominator.toString()])
              : amountStaked[nominator.toString()];
          });
        }
      });

      let pos: number;

      validators.forEach(([{ args: operator }, preferences]) => {
        // Add operator own staked tokens to the total.
        nominated[operator.toString()] = nominated[operator.toString()]
          ? nominated[operator.toString()].add(amountStaked[operator.toString()])
          : amountStaked[operator.toString()];

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
        // Build array of operators
        labels.splice(pos, 0, operator.toString());
        // Build array of operator commissions, as percent values.
        commission.splice(pos, 0, preferences.commission.unwrap().toNumber() / 10_000_000);
      });

      // Assign colors.
      labels.forEach((operator, index) => {
        const color = d3.rgb(d3.interpolateSinebow(index / (labels.length - 1)));
        // Otherwise a color from d3 color scale

        bdcolor[index] = '#EC4673';
        const opacity = 0.5;
        bgcolor[index] = `#EC467395`;

        if (highlight?.includes(operator)) {
          bdcolor[index] = '#43195B';
          bgcolor[index] = '#43195B95';
        }

        // Assign Operator name if available
        labels[index] = operatorsNames[operator]
          ? operatorsNames[operator]
          : operator.slice(0, 5) + '...' + operator.slice(operator.length - 5, operator.length);
      });

      const nominatedChartData = {
        labels: labels,
        datasets: [
          {
            type: 'line' as const,
            label: 'Commission',
            data: commission,
            backgroundColor: '#43195B50',
            borderColor: '#43195B',
            borderWidth: 2,
            yAxisID: 'y1',
          },

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
    }
    getNominatedTotkens();
  }, [api?.query.staking.ledger, api?.query.staking.nominators, api?.query.staking.validators, divisor, highlight]);
    api?.derive.staking,
    api?.query.staking.ledger,
    api?.query.staking.nominators,
    api?.query.staking.validators,
    api?.query.system,
    divisor,
    highlight,
  ]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Bar
            ref={chartRef}
            options={chartOptions}
            /* @ts-ignore data type complains about mixed chart data*/
            data={chartData}
          />
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
