import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar } from 'react-chartjs-2';
import * as d3 from 'd3';
import { operatorsNames } from '../../../constants/constants';
import Spinner from '../../Spinner';
import { useSdk } from '../../../hooks/useSdk';
import { EraInfo } from '../../../pages/operator-charts';
import { useEraStakers } from '../../../hooks/stakingPalletHooks/useEraStakers';

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  eraInfo: EraInfo;
}

const OperatorsActiveEraPoints = ({ eraInfo: { activeEra } }: IProps) => {
  const { api, encodedSelectedAddress } = useSdk();
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
      responsive: true,
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
          font: {
            weight: 'bold' as const,
          },
        },
      },
    };

    return options;
  }, [activeEra]);

  useEffect(() => {
    if (!api?.query.staking || !activeEra || !activeEraStakingData.data) return;

    let isSubscribed = true;

    async function getPoints() {
      let pointsOld: Record<string, number> = {};

      // Retrieve era points via subscription
      const unsubActiveEraPoints = await api?.query.staking.erasRewardPoints(activeEra!.toNumber(), (eraPoints) => {
        if (!isSubscribed || !api.isConnected) unsubActiveEraPoints!();

        let labels: string[] = [];
        let data: number[] = [];
        let bgcolor: any[] = [];
        let bdcolor: any[] = [];
        let pos: number;

        eraPoints.individual.forEach((rewardPoints, operatorId) => {
          const points = rewardPoints.toNumber();
          const operator = operatorId.toString();

          // Sort from highest to Lowest
          // If there is nothing in the array add to first position.
          if (data.length === 0) {
            data.push(points);
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
              if (points === data[mid]) {
                pos = mid + 1;
                break;
                // If the amount is greater than the mid position it should be before mid.
              } else if (points > data[mid]) {
                pos = end = mid - 1;
              } else {
                //  If the amount is less than than the mid position it should be added after it.
                pos = start = mid + 1;
              }
              // Once the end of the search is reached the posiiton should be the final "start"
              // This ensures the new data is not inserted at a position of mid -1 which would
              // place it out of order.
              if (start > end) {
                pos = start;
              }
            }
            data.splice(pos, 0, points);
          }

          labels.splice(pos, 0, operator);
        });

        // Assign colors.
        labels.forEach((operator, index) => {
          const color = d3.rgb(d3.interpolateSinebow(index / (labels.length - 1)));
          // Green for increase points.
          if (!!pointsOld[operator] && data[index] > pointsOld[operator]) {
            bgcolor[index] = 'green';
            bdcolor[index] = 'black';
          }
          // Red for decreased points.
          else if (!!pointsOld[operator] && data[index] < pointsOld[operator]) {
            bgcolor[index] = 'red';
            bdcolor[index] = 'black';
          }
          // Otherwise a color from d3 color scale
          else {
            bdcolor[index] = color;
            const opacity = 0.5;
            bgcolor[index] = `rgba(${color.r},${color.g},${color.b},${opacity})`;

            if (encodedSelectedAddress && activeEraStakingData.data?.nominators[encodedSelectedAddress]) {
              activeEraStakingData.data?.nominators[encodedSelectedAddress].forEach(({ operator: backedOperator }) => {
                if (operator === backedOperator) {
                  bdcolor[index] = 'black';
                  bgcolor[index] = color;
                }
              });
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
      isSubscribed = false;
    };
  }, [activeEra, activeEraStakingData.data, api.isConnected, api?.query.staking, encodedSelectedAddress]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Bar ref={chartRef} options={chartOptions} data={chartData} plugins={[ChartDataLabels]} />
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
