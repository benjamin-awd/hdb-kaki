// Tree-shaken ECharts build — register only the charts/components the app uses,
// instead of `import * as echarts from 'echarts'` (which bundles the whole library,
// ~1MB). See wireframes/REBUILD_PLAN.md.
import * as echarts from 'echarts/core';
import { LineChart, BarChart, ScatterChart, BoxplotChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  AxisPointerComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart, BarChart, ScatterChart, BoxplotChart,
  GridComponent, TooltipComponent, LegendComponent, MarkLineComponent,
  AxisPointerComponent, DataZoomInsideComponent, DataZoomSliderComponent,
  CanvasRenderer,
]);

export default echarts;
export { echarts };
