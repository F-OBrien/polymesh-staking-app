import { useRef, useEffect, useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartData,
  PointElement,
  LineElement,
  BarController,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Chart } from 'react-chartjs-2';
import { operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import { useSdk } from '../../../hooks/useSdk';
import { useEraPreferences, useEraStakers } from '../../../hooks/StakingQueries';
import { useStakingContext } from '../../../hooks/useStakingContext';
import { Balance } from '@polkadot/types/interfaces';
import { useEraTotalStaked } from '../../../hooks/StakingQueries';
import { BigNumber } from '@polymeshassociation/polymesh-sdk';

ChartJS.register(
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin,
  BarController
);

interface AssignedData {
  operator: string;
  namedOperator: string;
  totalAssigned: number;
  nominatingCount: number;
  commission: number;
  aprAfterCommission: number;
}
[];

const OperatorsTokensAssigned = () => {
  const {
    api,
    chainData: { tokenDecimals, tokenSymbol },
    encodedSelectedAddress,
  } = useSdk();
  const divisor = 10 ** tokenDecimals;
  const {
    eraInfo: { currentEra },
    stakingConstants: { fixedYearlyReward, maxVariableInflationTotalIssuance },
  } = useStakingContext();

  const [chartData, setChartData] = useState<ChartData<'bar' | 'line'>>();
  const [assignedData, setAssignedData] = useState<AssignedData[]>([]);
  const currentEraStakingData = useEraStakers(currentEra, { staleTime: Infinity });
  const [totalIssuance, setTotalIssuance] = useState<Balance>();
  const currentEraTotalStaked = useEraTotalStaked(currentEra, { staleTime: Infinity });
  const currentEraPreferences = useEraPreferences(currentEra, { staleTime: Infinity });
  const [sortMode, setSortMode] = useState<number>(0);

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

  const toggleSort = () => {
    sortMode < 5 ? setSortMode(sortMode + 1) : setSortMode(0);
  };

  const sortModeEnum = ['APR', 'Tokens Assigned', 'Active Nominations', 'Commission', 'Address', 'Name'];

  const chartOptions = useMemo(() => {
    const options = {
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: `Amount [${tokenSymbol}]` },
          ticks: { count: 11 },
        },
        y1: {
          display: true,
          beginAtZero: true,
          title: { display: true, text: `Percent [%]` },
          position: 'right' as const,
          ticks: { count: 11 },
          grid: {
            display: false,
          },
        },
        y2: {
          display: true,
          beginAtZero: true,
          title: { display: true, text: `Active Nominations` },
          position: 'right' as const,
          ticks: { count: 11 },
          grid: {
            display: false,
          },
        },
      },
      plugins: {
        legend: {
          display: true, //false,
          //   position: 'top' as const,
        },
        title: {
          display: true,
          text: `Total ${tokenSymbol} Assigned to Nodes (Era ${currentEra.toNumber()})`,
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

  // Subscribe to Total POLYX Issuance.
  useEffect(() => {
    if (!api.query.balances) {
      return;
    }
    let unsubPolyxSupply: () => void;

    const getTotalIssuance = async () => {
      unsubPolyxSupply = await api.query.balances.totalIssuance((total) => {
        // @ts-ignore
        setTotalIssuance(total);
      });
    };

    getTotalIssuance();

    return () => {
      unsubPolyxSupply && unsubPolyxSupply();
    };
  }, [api.isConnected, api.query.balances]);

  // Calculate annual total reward from Total, issuance and Total Staked.
  const annualTotalReward = useMemo(() => {
    if (!totalIssuance || !currentEraTotalStaked.data) return;

    // TODO consider making reward curve a reusable function
    const xIdeal = 0.7; // Ideal Staked ratio.
    const iIdeal = 0.14; // Inflation at ideal staked ratio.
    const iZero = 0.025; // Inflation at staked ratio = 0%.
    const decay = 0.05; // decay for staked ratio greater than the ideal

    const stakedRatio = currentEraTotalStaked.data.toNumber() / totalIssuance?.toNumber();

    let inflation;

    if (totalIssuance?.toNumber() < maxVariableInflationTotalIssuance.toNumber()) {
      if (stakedRatio <= xIdeal) {
        inflation = iZero + (iIdeal - iZero) * (stakedRatio / xIdeal);
      } else {
        inflation = iZero + (iIdeal - iZero) * 2 ** ((xIdeal - stakedRatio) / decay);
      }
    } else {
      inflation = fixedYearlyReward.toNumber() / totalIssuance?.toNumber();
    }

    const annualTotalReward = (inflation * totalIssuance?.toNumber()) / divisor;

    return annualTotalReward;
  }, [totalIssuance, currentEraTotalStaked.data, maxVariableInflationTotalIssuance, divisor, fixedYearlyReward]);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return currentEraStakingData.isFetching || currentEraTotalStaked.isFetching;
  }, [currentEraStakingData.isFetching, currentEraTotalStaked.isFetching]);

  useEffect(() => {
    if (
      !currentEraStakingData.data ||
      !annualTotalReward ||
      !currentEraPreferences.data ||
      currentEraStakingData.data.era.toNumber() !== currentEraPreferences.data.era.toNumber()
    )
      return;

    let unsortedData: AssignedData[] = [];

    Object.entries(currentEraStakingData.data.operators).forEach(([operator, { total, others }]) => {
      const totalAssigned = total.unwrap().toNumber() / divisor;
      const operatorCount = Object.keys(currentEraStakingData.data.operators).length;
      const nominatingCount = others.length;
      const commission = new BigNumber(currentEraPreferences.data?.operators[operator.toString()].commission.toString()).div(10_000_000).toNumber();
      const aprAfterCommission = ((100 - commission) * annualTotalReward) / operatorCount / totalAssigned;
      const namedOperator = operatorsNames[operator]
        ? operatorsNames[operator]
        : operator.slice(0, 5) + '...' + operator.slice(operator.length - 5, operator.length);
      unsortedData.push({ operator, namedOperator, totalAssigned, nominatingCount, commission, aprAfterCommission });
    });

    if (mountedRef.current) {
      setAssignedData(unsortedData);
    }
  }, [annualTotalReward, currentEraPreferences.data, currentEraStakingData.data, divisor]);

  useEffect(() => {
    if (assignedData.length === 0) return;

    // Sort the array from highest to lowest points
    assignedData.sort((a, b) => {
      switch (sortMode) {
        case 0:
          return b.aprAfterCommission - a.aprAfterCommission;
        case 1:
          return b.totalAssigned - a.totalAssigned;
        case 2:
          return b.nominatingCount - a.nominatingCount;
        case 3:
          return a.commission - b.commission;
        case 4:
          const addressA = a.operator.toUpperCase(); // ignore upper and lowercase
          const addressB = b.operator.toUpperCase(); // ignore upper and lowercase
          if (addressA < addressB) {
            return -1;
          }
          if (addressA > addressB) {
            return 1;
          }
          // names must be equal
          return 0;
        case 5:
          const nameA = a.namedOperator.toUpperCase(); // ignore upper and lowercase
          const nameB = b.namedOperator.toUpperCase(); // ignore upper and lowercase
          if (nameA < nameB) {
            return -1;
          }
          if (nameA > nameB) {
            return 1;
          }
          // names must be equal
          return 0;
        default:
          return 0;
      }
    });

    let bgcolor: any[] = [];
    let bdcolor: any[] = [];
    let namedLabels: string[] = [];
    let totalsAssigned: number[] = [];
    let nominatingCounts: number[] = [];
    let apr: number[] = [];
    let commissions: number[] = [];

    assignedData.forEach(({ operator, namedOperator, totalAssigned, nominatingCount, commission, aprAfterCommission }, index) => {
      totalsAssigned[index] = totalAssigned;
      nominatingCounts[index] = nominatingCount;
      commissions[index] = commission;
      apr[index] = aprAfterCommission;
      namedLabels[index] = namedOperator;
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
    });

    const assignedTokensChartData = {
      labels: namedLabels,
      datasets: [
        {
          type: 'line' as const,
          label: 'Estimated APR',
          data: apr,
          backgroundColor: 'rgba(35,87,49,0.5)',
          borderColor: 'rgba(35,87,49,1)',
          borderWidth: 2,
          yAxisID: 'y1',
        },
        {
          type: 'line' as const,
          label: 'Operator Commission',
          data: commissions,
          backgroundColor: 'rgba(150,10,10,0.5)',
          borderColor: 'rgba(150,10,10,1)',
          borderWidth: 2,
          yAxisID: 'y1',
        },
        {
          type: 'line' as const,
          label: 'Active Nominations',
          data: nominatingCounts,
          backgroundColor: '#43195B95',
          borderColor: '#43195B',
          borderWidth: 2,
          yAxisID: 'y2',
        },
        {
          label: 'Assigned',
          data: totalsAssigned,
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
  }, [assignedData, currentEraStakingData.data?.nominators, encodedSelectedAddress, sortMode]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Chart type='bar' ref={chartRef} options={chartOptions} data={chartData} />
          <button className='resetZoomButton' onClick={resetChartZoom}>
            Reset Zoom
          </button>
          <button className='sortToggle' onClick={toggleSort}>
            Sorted by {sortModeEnum[sortMode]}
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
