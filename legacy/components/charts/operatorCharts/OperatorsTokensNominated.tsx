import { useRef, useEffect, useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LogarithmicScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartData,
  ChartOptions,
  BarController,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Chart } from 'react-chartjs-2';
import { operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { BN } from '@polkadot/util';
import { useSdk } from '../../../hooks/useSdk';
import { useStakingContext } from '../../../hooks/useStakingContext';
import { useQuery } from 'react-query';
import { VoidFn } from '@polkadot/api/types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LogarithmicScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin,
  BarController
);

interface NominationData {
  labels?: string[];
  amount?: number[];
  commission?: number[];
  nominationCount?: number[];
}
const OperatorsTokensNominated = () => {
  const {
    api,
    chainData: { tokenDecimals, tokenSymbol },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;
  const { operatorsToHighlight: highlight } = useStakingContext();

  const [chartData, setChartData] = useState<ChartData<'bar' | 'line'>>();
  const [nominationData, setNominationData] = useState<NominationData>({});
  const [refetch, setRefetch] = useState<Boolean>(false);
  // Queries to get and cache the required data.
  const nominations = useQuery(['NOMINATIONS'], async () => await api.query.staking.nominators.entries(), {});
  const stakingLedger = useQuery(['STAKING_LEDGER'], async () => await api.query.staking.ledger.entries(), {});
  const validators = useQuery(['VALIDATORS'], async () => await api.query.staking.validators.entries(), {});

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

  const chartOptions: ChartOptions = useMemo(() => {
    const options: ChartOptions = {
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
        y2: {
          display: false,
          beginAtZero: true,
          title: { display: true, text: `Nominations` },
          position: 'right' as const,
        },
      },
      elements: {
        line: {
          borderJoinStyle: 'round' as const,
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
    return nominations.isFetching || validators.isFetching || stakingLedger.isFetching;
  }, [nominations.isFetching, stakingLedger.isFetching, validators.isFetching]);

  // Effect to subscribe to events so we know when to the refresh chart.
  useEffect(() => {
    let unsubEvents: VoidFn;
    const subscribeEvents = async () => {
      unsubEvents = await api.query.system.events((event) => {
        // console.log(event.toHuman());

        if (
          event.some(
            (e) =>
              e.event.method === 'Bonded' ||
              e.event.method === 'Nominated' ||
              e.event.method === 'UnBonded' ||
              (e.event.method === 'Reward' && e.event.section === 'staking')
          )
        ) {
          setRefetch(true);
        }
      });
    };
    subscribeEvents();

    return () => {
      // Unsubscribe on unmount.
      unsubEvents && unsubEvents();
    };
  }, [api.query.system]);

  useEffect(() => {
    if (refetch) {
      nominations.refetch();
      stakingLedger.refetch();
      validators.refetch();
      setRefetch(false);
    }
  }, [nominations, refetch, stakingLedger, validators]);

  // Effect to query chain for the required data and sort from highest to lowest nominated.
  useEffect(() => {
    //
    if (!nominations.data || !stakingLedger.data || !validators.data) return;
    let labels: string[] = [];
    let amount: number[] = [];
    let commission: number[] = [];
    let nominationCount: number[] = [];

    async function getNominatedTokens() {
      //TODO: get data to determine if an operator is waiting so it can be highlighted on the chart.

      const amountStaked: Record<string, BN> = {};
      const nominated: Record<string, BN> = {};
      const nomCount: Record<string, number> = {};

      stakingLedger.data!.forEach(([, ledger]) => {
        const unwrappedLedger = ledger.unwrapOrDefault();
        amountStaked[unwrappedLedger.stash.toString()] = unwrappedLedger.active.unwrap();
      });

      nominations.data!.forEach(([{ args: nominator }, nominations]) => {
        if (nominations.isSome) {
          // @ts-ignore
          nominations.unwrap().targets.forEach((operator) => {
            nominated[operator.toString()] = nominated[operator.toString()]
              ? nominated[operator.toString()].add(amountStaked[nominator.toString()])
              : amountStaked[nominator.toString()];
            nomCount[operator.toString()] = nomCount[operator.toString()] ? nomCount[operator.toString()] + 1 : 1;
          });
        }
      });

      let pos: number;

      validators.data!.forEach(([{ args: operator }, preferences]) => {
        // Add operator own staked tokens to the total.
        nominated[operator.toString()] = nominated[operator.toString()]
          ? nominated[operator.toString()].add(amountStaked[operator.toString()])
          : amountStaked[operator.toString()];

        const amountNominated = nominated[operator.toString()] ? nominated[operator.toString()].toNumber() / divisor : 0;

        // Sort from highest to Lowest
        // If there is nothing in the array add to first position.
        if (amount.length === 0) {
          amount.push(amountNominated);
          pos = 0;
        }
        // Perform a binary search to find correct position in the sort order.
        else {
          let start = 0;
          let end = amount.length - 1;
          pos = 0;

          while (start <= end) {
            var mid = start + Math.floor((end - start) / 2);
            // If the amount is the same as mid position position we can add at the mid +1 position.
            if (amountNominated === amount[mid]) {
              pos = mid + 1;
              break;
              // If the amount is greater than the mid position it should be before mid.
            } else if (amountNominated > amount[mid]) {
              pos = end = mid - 1;
            } else {
              //  If the amount is less than than the mid position it should be after it.
              pos = start = mid + 1;
            }
            // Once the end of the search is reached the position should be the final "start"
            // This ensures the new data is not inserted at a position of mid -1 which would
            // place it out of order.
            if (start > end) {
              pos = start;
            }
          }
          amount.splice(pos, 0, amountNominated);
        }
        // Build array of operators
        labels.splice(pos, 0, operator.toString());
        // Build array of operator commissions, as percent values.
        commission.splice(pos, 0, preferences.commission.unwrap().toNumber() / 10_000_000);
        nominationCount.splice(pos, 0, nomCount[operator.toString()]);
      });
      if (mountedRef.current) {
        setNominationData({ labels, amount, commission, nominationCount });
      }
    }
    getNominatedTokens();
  }, [api.query.staking, divisor, nominations.data, stakingLedger.data, validators.data]);

  // Effect to set the ChartData and apply formatting.
  useEffect(() => {
    if (!nominationData.labels || !nominationData.amount || !nominationData.commission || !nominationData.nominationCount) return;

    let bgcolor: any[] = [];
    let bdcolor: any[] = [];
    let namedOperators: string[] = [];

    // Assign colors.
    nominationData.labels.forEach((operator: string, index: number) => {
      // if nominated by the active wallet assign a different color.
      if (highlight?.includes(operator)) {
        bdcolor[index] = '#black';
        bgcolor[index] = '#43195B95';
      }
      // Else set default Border and Background Color.
      else {
        bdcolor[index] = '#EC4673';
        bgcolor[index] = `#EC467395`;
      }
      // Assign Operator name if available
      namedOperators[index] = operatorsNames[operator]
        ? operatorsNames[operator]
        : operator.slice(0, 5) + '...' + operator.slice(operator.length - 5, operator.length);
    });

    const nominatedChartData = {
      labels: namedOperators,
      datasets: [
        {
          type: 'line' as const,
          label: 'Commission',
          data: nominationData.commission,
          backgroundColor: 'rgba(35,87,49,0.5)',
          borderColor: 'rgba(35,87,49,1)',
          borderWidth: 2,
          yAxisID: 'y1',
        },
        {
          type: 'line' as const,
          label: 'Nomination Count',
          data: nominationData.nominationCount,
          backgroundColor: '#43195B95',
          borderColor: '#43195B',
          borderWidth: 2,
          yAxisID: 'y2',
        },

        {
          label: 'Amount Nominated',
          data: nominationData.amount,
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
  }, [nominationData, highlight]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Chart type='bar' ref={chartRef} options={chartOptions} data={chartData} />
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
