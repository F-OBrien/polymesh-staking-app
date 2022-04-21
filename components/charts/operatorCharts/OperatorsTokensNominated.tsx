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
  // Define reference for tracking mounted state
  const mountedRef = useRef(false);
  // Effect for tracking mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const {
    api,
    chainData: { tokenDecimals, tokenSymbol },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;

  const [chartData, setChartData] = useState<ChartData<'bar'>>();

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
            overScaleMode: 'y' as const,
          },
          limits: { y: { min: 0 } },
        },
      },
    };

    return options;
  }, []);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return false;
  }, []);

  useEffect(() => {
    async function getNominatedTotkens() {
      let lables: string[] = [];
      let data: number[] = [];
      let bgcolor: any[] = [];
      let bdcolor: any[] = [];

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
            // If the nominated amount is the same as mid position position we can add at the mid +1 posiiton.
            if (amountNominated === data[mid]) {
              pos = mid + 1;
              break;
              // If the nominated amount is greater than the mid position it should be before mid.
            } else if (amountNominated > data[mid]) {
              pos = end = mid - 1;
            } else {
              //  If the nominated amount is less than than the mid position it should be after it mid.
              pos = start = mid + 1;
            }
            // Once the end of the search is reached the posiiton should be the final "start"
            // i.e. if
            if (start > end) {
              pos = start;
            }
          }
          data.splice(pos, 0, amountNominated);
        }

        lables.splice(pos, 0, operatorsNames[operator.toString()] ? operatorsNames[operator.toString()] : operator.toString());
        // data.splice(pos, 0, nominated[operator.toString()] ? nominated[operator.toString()].toNumber() / divisor : 0);

        // lables[index] = operatorsNames[operator.toString()] ? operatorsNames[operator.toString()] : operator.toString();
        // data[index] = nominated[operator.toString()] ? nominated[operator.toString()].toNumber() / divisor : 0;
        const color = d3.rgb(d3.interpolateSinebow(index / (Object.keys(validators).length - 1)));
        bdcolor[index] = color;
        const bgCol = { ...color };
        bgCol.opacity = 0.4;
        bgcolor[index] = `rgba(${color.r},${color.g},${color.b},0.5)`;
      });

      const nominatedChartData = {
        labels: lables,
        datasets: [
          {
            label: 'Dataset1',
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

      // console.log(nominated);

      // allErasPoints?.forEach(({ era, eraPoints, validators }, index) => {
      //   if (eraPoints.toNumber()) {
      //     averagePoints[index] = eraPoints.toNumber() / Object.keys(validators).length;
      //     // Build array of x-axis lables with eras.
      //     labels[index] = era.toString();

      //     // build array of points for each validator
      //     Object.entries(validators).forEach(([id, points]) => {
      //       if (!pointsDatasets[id]) {
      //         pointsDatasets[id] = new Array(84).fill(0);
      //       }
      //       pointsDatasets[id][index] = points.toNumber();
      //     });
      //   }
      // });

      // pointsChartData = {
      //   labels,
      //   datasets: [
      //     {
      //       label: 'Average',
      //       data: averagePoints,
      //       borderColor: 'rgb(200,0,0)',
      //       backgroundColor: 'rgba(200,0,0,0.5)',
      //       borderWidth: 2,
      //       borderDash: [3, 5],
      //       pointRadius: 2,
      //       yAxisID: 'y',
      //     },
      //   ],
      // };

      // Object.entries(pointsDatasets).forEach(([operator, points], index) => {
      //   let color = d3.rgb(d3.interpolateSinebow(index / (Object.keys(pointsDatasets).length - 1)));
      //   if (highlight?.includes(operator)) {
      //     color.opacity = 0.9;
      //     pointsChartData.datasets.unshift({
      //       label: operatorsNames[operator] ? operatorsNames[operator] : operator,
      //       data: points,
      //       borderColor: color,
      //       backgroundColor: color,
      //       borderWidth: 2,
      //       pointRadius: 2,
      //       yAxisID: 'y',
      //     });
      //   } else {
      //     color.opacity = 0.2;
      //     pointsChartData.datasets.push({
      //       label: operatorsNames[operator] ? operatorsNames[operator] : operator,
      //       data: points,
      //       borderColor: color,
      //       backgroundColor: color,
      //       borderWidth: 2,
      //       pointRadius: 2,
      //       yAxisID: 'y',
      //     });
      //   }
      // });

      // // Before setting the chart data ensure the component is still mounted
      // if (mountedRef.current) {
      //   setChartData(pointsChartData);
      // }
      return;
    }
    getNominatedTotkens();
  }, [api?.query.staking.ledger, api?.query.staking.nominators, api?.query.staking.validators]);

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