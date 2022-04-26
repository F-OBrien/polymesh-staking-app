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

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  eraInfo: EraInfo;
}

const OperatorsActiveEraPoints = ({ eraInfo: { activeEra } }: IProps) => {
  const { api } = useSdk();
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
    if (!api?.query.staking || !activeEra) return;

    let isSubscribed = true;

    async function getNominatedTotkens() {
      let pointsOld: Record<string, number> = {};

      // Retrieve era points via subscription
      const unsubActiveEraPoints = await api?.query.staking.erasRewardPoints(activeEra!.toNumber(), (eraPoints) => {
        if (!isSubscribed || !api.isConnected) unsubActiveEraPoints!();

        let lables: string[] = [];
        let data: number[] = [];
        let bgcolor: any[] = [];
        let bdcolor: any[] = [];
        let pos: number;

        eraPoints.individual.forEach((rewardPoints, operatorId) => {
          const points = rewardPoints.toNumber();
          const operator = operatorId.toString();
          // data.push(points);
          // lables.push(operatorsNames[operator.toString()] ? operatorsNames[operator.toString()] : operator.toString());

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
              // If the nominated amount is the same as mid position position we can add at the mid +1 posiiton.
              if (points === data[mid]) {
                pos = mid + 1;
                break;
                // If the nominated amount is greater than the mid position it should be before mid.
              } else if (points > data[mid]) {
                pos = end = mid - 1;
              } else {
                //  If the nominated amount is less than than the mid position it should be added after it.
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

          lables.splice(pos, 0, operatorsNames[operator] ? operatorsNames[operator] : operator);
        });

        // Assign colors.
        lables.forEach((operator, index) => {
          // Green for increase points.
          if (!!pointsOld[operator] && data[index] > pointsOld[operator]) {
            bgcolor[index] = 'green';
            bdcolor[index] = 'black';
          }
          // Blue for decreased points.
          else if (!!pointsOld[operator] && data[index] < pointsOld[operator]) {
            bgcolor[index] = 'blue';
            bdcolor[index] = 'black';
          }
          // Otherwise a color from d3 color scale
          else {
            const color = d3.rgb(d3.interpolateSinebow(index / (lables.length - 1)));
            bdcolor[index] = color;
            bgcolor[index] = `rgba(${color.r},${color.g},${color.b},0.5)`;
          }
          pointsOld[operator] = data[index];
        });

        const activeEraPointsChartData = {
          labels: lables,
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
    getNominatedTotkens();
    return () => {
      isSubscribed = false;
    };
  }, [activeEra, api.isConnected, api?.query.staking]);

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
