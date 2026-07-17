// Server-only ECharts, SVG renderer, for build-time SSR of the hero (price-trends)
// chart. Imported ONLY from index.astro's frontmatter, so the SVGRenderer never
// ships to the client (the client uses the canvas build in ./echarts).
//
// The option here mirrors renderTrends() in index.astro for the default 'lease'
// lens, so the inlined SVG matches what the canvas chart draws after hydration.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { baseOption, palette, axisLabel, splitLine, axisLine } from './echartsTheme';
import { moneyShort } from './format';

echarts.use([LineChart, GridComponent, LegendComponent, SVGRenderer]);

type TrendRow = { quarter: string; series: string; v: number };

/** Render the price-trends line chart to a standalone SVG string (no JS, no fetch). */
export function trendsSVG(rows: TrendRow[], width: number, height: number): string {
  const quarters = [...new Set(rows.map((r) => r.quarter))].sort();
  const seriesNames = [...new Set(rows.map((r) => r.series))].sort();
  const byKey = new Map(rows.map((r) => [r.series + '|' + r.quarter, Number(r.v)]));

  const series = seriesNames.map((name) => ({
    name,
    type: 'line' as const,
    smooth: true,
    showSymbol: false,
    data: quarters.map((qtr) => {
      const v = byKey.get(name + '|' + qtr);
      return v == null ? null : Math.round(v);
    }),
  }));

  // ssr:true + animation:false are required for a deterministic, static render.
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  chart.setOption({
    ...baseOption(),
    color: palette,
    animation: false,
    legend: { top: 0, right: 0, type: 'scroll', textStyle: { fontSize: 12 }, icon: 'roundRect' },
    grid: { left: 66, right: 24, top: 40, bottom: 46, containLabel: false },
    xAxis: {
      type: 'category', data: quarters, boundaryGap: false,
      axisLabel: { ...axisLabel, interval: Math.ceil(quarters.length / 8) },
      axisLine, axisTick: { show: false },
    },
    yAxis: {
      type: 'value', scale: true,
      axisLabel: { ...axisLabel, formatter: (v: number) => moneyShort(v) },
      splitLine,
    },
    series,
  });
  const svg = chart.renderToSVGString();
  chart.dispose();
  // Let CSS stretch it to the fluid container width (it's a brief placeholder,
  // replaced by the canvas chart on hydration) instead of letterboxing.
  return svg.replace('<svg ', '<svg preserveAspectRatio="none" ');
}
