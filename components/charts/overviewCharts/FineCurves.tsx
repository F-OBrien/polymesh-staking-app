import { useRef, useEffect, useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartData,
  ChartOptions,
  ScatterController,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import Spinner from '../../Spinner';
import annotationPlugin from 'chartjs-plugin-annotation';
import { useEraStakers } from '../../../hooks/StakingQueries';
import { useStakingContext } from '../../../hooks/useStakingContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, annotationPlugin, ScatterController);

const FineCurves = () => {
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
    eraInfo: { activeEra },
  } = useStakingContext();

  const [chartData, setChartData] = useState<ChartData<'scatter'>>();
  const activeEraStakingData = useEraStakers(activeEra, { staleTime: Infinity });

  // Set the chart options including annotation.
  const chartOptions = useMemo(() => {
    const options: ChartOptions<'scatter'> = {
      showLine: true,
      interaction: { intersect: false, mode: 'nearest', axis: 'x' },
      scales: {
        x: {
          grid: { display: true, drawOnChartArea: false, drawBorder: false },
          title: { display: true, text: `Number of offenders` },
        },
        y: {
          grid: { display: true, drawOnChartArea: false, drawBorder: false },
          title: { display: true, text: `Fine` },
          // max: 100,
          ticks: {
            // display: true,
            includeBounds: false,
            stepSize: 10,
            // autoSkip: false,
            callback: function (value: string | number) {
              return value + '%';
            },
          },
        },
      },
      // hover: {
      //   mode: 'dataset' as const,
      // },
      elements: { point: { hoverRadius: 0 } },
      plugins: {
        title: {
          display: true,
          text: `Unresponsiveness and Equivocation Fines`,
        },
        legend: {
          position: 'bottom' as const,
          labels: {
            usePointStyle: true,
            pointStyle: 'line',
          },
        },
      },
    };

    return options;
  }, []);
  // Set chart data.
  useEffect(() => {
    if (!activeEraStakingData.data) return;
    const operatorCount = Object.keys(activeEraStakingData.data.operators).length;

    let unresponsivenessFineCurve: { x: number; y: number }[] = [];
    let equivocationFineCurve: { x: number; y: number }[] = [];
    for (let i = 0; i < operatorCount + 1; i++) {
      const unresponsivenessFine = 100 * Math.max(Math.min((3 * (i - (operatorCount / 10 + 1))) / operatorCount, 1) * 0.07, 0);
      const equivocationFine = 100 * Math.min(((3 * i) / operatorCount) ** 2, 1);
      unresponsivenessFineCurve[i] = { x: i, y: unresponsivenessFine };
      equivocationFineCurve[i] = { x: i, y: equivocationFine };
    }

    let fineCurvesChartDate: { datasets: any };

    // Create chart datasets
    fineCurvesChartDate = {
      datasets: [
        {
          label: 'Unresponsiveness',
          data: unresponsivenessFineCurve,
          borderColor: '#60D3CB',
          backgroundColor: '#60D3CB',
          borderWidth: 3,
          pointRadius: 0,

          yAxisID: 'y',
        },
        {
          label: 'Equivocation',
          data: equivocationFineCurve,
          borderColor: '#EC4673',
          backgroundColor: '#EC4673',
          borderWidth: 3,
          pointRadius: 0,
          yAxisID: 'y',
        },
      ],
    };

    // Before setting the chart data ensure the component is still mounted
    if (mountedRef.current) {
      setChartData(fineCurvesChartDate);
    }
    return;
  }, [activeEraStakingData.data]);

  return (
    <div className='LineChart'>
      {chartData && chartOptions ? (
        <>
          <Chart type='scatter' options={chartOptions} data={chartData} />
          {/* {dataIsFetching ? <MiniSpinner /> : <></>} */}
        </>
      ) : (
        <>
          <Spinner />
        </>
      )}
    </div>
  );
};

export default FineCurves;
