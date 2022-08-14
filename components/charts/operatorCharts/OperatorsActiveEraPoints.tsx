import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Chart } from 'react-chartjs-2';
import { operatorsNames } from '../../../constants/constants';
import Spinner from '../../Spinner';
import { useSdk } from '../../../hooks/useSdk';
import { useEraStakers } from '../../../hooks/StakingQueries';
import { useStakingContext } from '../../../hooks/useStakingContext';
import { VoidFn } from '@polkadot/api/types';

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, zoomPlugin);

const OperatorsActiveEraPoints = () => {
  const { api, encodedSelectedAddress } = useSdk();
  const {
    eraInfo: { activeEra },
  } = useStakingContext();

  const [chartData, setChartData] = useState<ChartData<'bar'>>();
  const activeEraStakingData = useEraStakers(activeEra, { staleTime: Infinity });

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
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: `Points` },
        },
      },
      animation: {
        duration: 300,
      },
      plugins: {
        legend: {
          display: false,
        },
        title: {
          display: true,
          text: `Operator Points (Era ${activeEra?.toNumber()})`,
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
        datalabels: {
          anchor: 'end' as const,
          align: 'end' as const,
          rotation: -45,
          textAlign: 'center' as const,
          color: 'black',
          offset: 0,
          padding: { left: 0, right: 0, top: 0, bottom: 0 },
          // textStrokeColor: 'black',
          // textStrokeWidth: 1,
        },
      },
    };

    return options;
  }, [activeEra]);

  useEffect(() => {
    if (!api.query.staking || !activeEraStakingData.data) return;

    let unsubActiveEraPoints: VoidFn;
    async function getPoints() {
      let pointsOld: Record<string, number> = {};

      // Retrieve era points via subscription
      unsubActiveEraPoints = await api.query.staking.erasRewardPoints(activeEra.toNumber(), (eraPoints) => {
        const pointsRecord: Record<string, number> = {};

        eraPoints.individual.forEach((rewardPoints, operatorId) => {
          pointsRecord[operatorId.toString()] = rewardPoints.toNumber();
        });

        const pointsRecordAllOperators: { operator: string; points: number }[] = [];
        // Create a record of all elected operators so even operators who fail to produce a block will display with 0 points.
        Object.keys(activeEraStakingData.data?.operators!).forEach((operator, i) => {
          pointsRecordAllOperators[i] = { operator: operator, points: pointsRecord[operator.toString()] || 0 };
        });

        // Sort the array from highest to lowest points
        pointsRecordAllOperators.sort((a, b) => {
          return b.points - a.points;
        });

        let data: number[] = [];
        let bgcolor: any[] = [];
        let bdcolor: any[] = [];
        let labels: string[] = [];

        pointsRecordAllOperators.forEach(({ operator, points }, index) => {
          data[index] = points;
          // Assign colors.
          // Green for increase points.
          if (pointsOld[operator] !== undefined && data[index] > pointsOld[operator]) {
            bgcolor[index] = 'green';
            bdcolor[index] = 'black';
          }
          // Red for decreased points.
          else if (pointsOld[operator] !== undefined && data[index] < pointsOld[operator]) {
            bgcolor[index] = 'red';
            bdcolor[index] = 'black';
          }
          // Otherwise a defaults
          else {
            if (
              encodedSelectedAddress &&
              activeEraStakingData.data?.nominators[encodedSelectedAddress]?.some((nominated) => nominated.operator === operator)
            ) {
              bdcolor[index] = 'black';
              bgcolor[index] = '#43195B95';
            } else {
              bdcolor[index] = '#EC4673';
              bgcolor[index] = '#EC467395';
            }
          }

          pointsOld[operator] = data[index];
          // Assign Operator name if available
          labels[index] = operatorsNames[operator]
            ? operatorsNames[operator]
            : operator.slice(0, 5) + '...' + operator.slice(operator.length - 5, operator.length);
        });

        const activeEraPointsChartData = {
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
          setChartData(activeEraPointsChartData);
        }
      });

      return;
    }
    getPoints();
    return () => {
      unsubActiveEraPoints && unsubActiveEraPoints();
    };
  }, [activeEra, activeEraStakingData.data, api.isConnected, api.query.staking, encodedSelectedAddress]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Chart type='bar' ref={chartRef} options={chartOptions} data={chartData} plugins={[ChartDataLabels]} />
          <button className='resetZoomButton' onClick={resetChartZoom}>
            Reset Zoom
          </button>
        </>
      ) : (
        <>
          <Spinner />
        </>
      )}
    </div>
  );
};

export default OperatorsActiveEraPoints;
