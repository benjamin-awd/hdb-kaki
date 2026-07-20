// Tree-shaken ECharts build — register only the charts/components the app uses,
// instead of `import * as echarts from 'echarts'` (which bundles the whole library,
// ~1MB). See wireframes/REBUILD_PLAN.md.
import * as echarts from 'echarts/core';
import { LineChart, BarChart, ScatterChart, BoxplotChart, MapChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  AxisPointerComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  BoxplotChart,
  MapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  AxisPointerComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

// Wrap echarts.init with a ResizeObserver on the container. The pages only listen
// for window 'resize', which fires on viewport changes but NOT when a chart's own
// box settles late — e.g. a grid/flex column resolving its width after init, or a
// web-font swap reflowing the layout. When that happens a chart initialised at ~0
// width stays collapsed until the next manual resize. Observing the container makes
// it recover automatically. (ResizeObserver fires once on observe, so this also
// covers the first post-layout paint.)
export function initChart(el: HTMLElement): echarts.ECharts {
  const chart = echarts.init(el);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
  }
  return chart;
}

export default echarts;
export { echarts };
