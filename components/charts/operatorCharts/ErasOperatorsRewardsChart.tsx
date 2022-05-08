import { useRef, useEffect, useState, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import * as d3 from 'd3';
import { defaultChartOptions, operatorsNames } from '../../../constants/constants';
import Spinner, { MiniSpinner } from '../../Spinner';
import BN from 'bn.js';
import { useErasPoints, useErasRewards } from '../../../hooks/StakingQueries';
import { useSdk } from '../../../hooks/useSdk';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

interface IProps {
  highlight?: string[] | undefined;
}

const ErasOperatorsRewardsChart = ({ highlight }: IProps) => {
  // Define reference for tracking mounted state
  const mountedRef = useRef(false);
  // Effect for tracking mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [chartData, setChartData] = useState<any>();
  const erasRewards = useErasRewards({ enabled: true });
  const erasPoints = useErasPoints({ enabled: true });
  const {
    chainData: { tokenSymbol, tokenDecimals },
  } = useSdk();
  const divisor = 10 ** tokenDecimals;

  // Chart Reference for resetting zoom
  const chartRef = useRef<any>();
  const resetChartZoom = () => {
    chartRef.current?.resetZoom();
  };

  const chartOptions = useMemo(() => {
    // Make a copy of the default options.
    // @ts-ignore - typescript doens't yet recognise this function. TODO remove ignore once supported
    const options = structuredClone(defaultChartOptions);
    // Override defaults with chart specific options.
    options.scales.x.title.text = 'Era';
    options.scales.y.title.text = `Reward [${tokenSymbol}]`;
    options.plugins.title.text = `${tokenSymbol} Rewards per Era by Operator`;

    return options;
  }, [tokenSymbol]);

  // Set `dataIsFetching` to true while any of the queries are fetching.
  const dataIsFetching = useMemo(() => {
    return false;
  }, []);

  useEffect(() => {
    if (!erasRewards.data || !erasPoints.data || !divisor) {
      return;
    }

    async function getRewardsChartData() {
      let labels: string[] = [];
      let rewardDatasets: { [key: string]: number[] } = {};
      let chartData: { datasets: any; labels: string[] };
      let averageReward: number[] = [];

      // Read all era points
      const allErasPoints = erasPoints.data;
      // Read all era rewards
      const allErasRewards = erasRewards.data;
      allErasPoints?.forEach(({ era, eraPoints, validators }, index) => {
        // Check points are available for the era as api.derive functions return an
        // empty data set when current era != active era i.e. last session of an era
        if (eraPoints.toNumber()) {
          averageReward[index] = allErasRewards![index].eraReward?.div(new BN(Object.keys(validators).length)).toNumber() / divisor!;
          // Build array of x-axis labels with eras.
          labels[index] = era.toString();

          // build array of rewards for each validator
          Object.entries(validators).forEach(([id, points]) => {
            if (!rewardDatasets[id]) {
              rewardDatasets[id] = new Array(84).fill(0);
            }
            // For simplicity we assume the index for rewards will match the index for points
            // TODO: consider if this needs to be made more robust?
            rewardDatasets[id][index] = allErasRewards![index].eraReward.mul(points).div(eraPoints).toNumber() / divisor!;
          });
        }
      });

      chartData = {
        labels,
        datasets: [
          {
            label: 'Average',
            data: averageReward,
            borderColor: 'rgb(200,0,0)',
            backgroundColor: 'rgba(200,0,0,0.5)',
            borderWidth: 2,
            borderDash: [3, 5],
            pointRadius: 2,
            yAxisID: 'y',
          },
        ],
      };

      Object.entries(rewardDatasets).forEach(([operator, reward], index) => {
        let color = d3.rgb(d3.interpolateSinebow(index / (Object.keys(rewardDatasets).length - 1)));
        color.opacity = 0.9;
        if (highlight?.includes(operator)) {
          chartData.datasets.unshift({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: reward,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          });
        } else {
          color.opacity = 0.2;
          chartData.datasets.push({
            label: operatorsNames[operator] ? operatorsNames[operator] : operator,
            data: reward,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 2,
            yAxisID: 'y',
          });
        }
      });

      // Before setting the chart data ensure the component is still mounted
      if (mountedRef.current) {
        setChartData(chartData);
      }
      return;
    }

    getRewardsChartData();
  }, [divisor, erasPoints.data, erasRewards.data, highlight]);

  return (
    <div className='LineChart'>
      {chartData ? (
        <>
          <Line ref={chartRef} options={chartOptions} data={chartData} />
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

export default ErasOperatorsRewardsChart;
