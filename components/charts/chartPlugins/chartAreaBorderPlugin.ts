import { Chart, Color } from 'chart.js';

export const chartAreaBorder = {
  id: 'chartAreaBorder',
  beforeDraw(
    chart: { ctx: any; chartArea: { left: any; top: any; width: any; height: any } },
    _args: any,
    options: { borderColor?: Color; borderWidth?: number; borderDash?: number[]; borderDashOffset?: number }
  ) {
    const {
      ctx,
      chartArea: { left, top, width, height },
    } = chart;

    ctx.save();
    ctx.strokeStyle = options.borderColor || Chart.defaults.borderColor;
    ctx.lineWidth = options.borderWidth || 1;
    ctx.setLineDash(options.borderDash || Chart.defaults.elements.line.borderDash);
    ctx.lineDashOffset = options.borderDashOffset || 0;
    ctx.strokeRect(left, top, width, height);
    ctx.restore();
  },
};

export interface ChartAreaBorderPlugin {
  plugins: {
    chartAreaBorder: {
      borderColor?: Color;
      borderWidth?: number;
      borderDash?: number[];
      borderDashOffset?: number;
    };
  };
}
