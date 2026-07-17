// ECharts theme aligned to the HDB Kaki design tokens (see wireframes/shared.css).
import type { EChartsOption } from 'echarts';

export const palette = ['#fe012b', '#181410', '#2f9e8f', '#d98a2b', '#3b6ea5', '#1f7a4d'];

const ink = '#181410';
const ink2 = '#5b544a';
const ink3 = '#8c8479';
const line = '#e4ddd0';
const red = '#fe012b';
const sans = "'Public Sans', sans-serif";
const mono = "'IBM Plex Mono', monospace";

/** Base options every chart merges over: transparent bg, brand fonts, muted axes. */
export function baseOption(): EChartsOption {
  return {
    color: palette,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: sans, color: ink2 },
    grid: { left: 58, right: 24, top: 24, bottom: 40, containLabel: false },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fffdf8',
      borderColor: line,
      borderWidth: 1,
      textStyle: { color: ink, fontFamily: sans, fontSize: 13 },
      extraCssText: 'box-shadow:0 12px 30px -18px rgba(24,20,16,.35);border-radius:10px',
    },
    categoryAxis: undefined,
  } as EChartsOption;
}

export const axisLabel = { color: ink3, fontFamily: mono, fontSize: 11 };
export const splitLine = { lineStyle: { color: line } };
export const axisLine = { lineStyle: { color: line } };
export { ink, ink2, ink3, line, red, sans, mono };
