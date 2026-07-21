// Main-thread proxy over the worker-resident hyparquet engine. createHyparquet() lazily
// spawns the Web Worker (via hyparquetConnect.createRemote) on first use and returns thin
// async pass-throughs to the engine methods, plus prefetch()/warmWhenIdle(). Constructing
// it spawns nothing — the worker starts on the first query or warm.
import { createRemote } from './hyparquetConnect';
import type { HyparquetApi } from './hyparquetCore';

export type {
  PsfSpec,
  RecentRow,
  ScatterRow,
  Monthly,
  TownMapRow,
  TownRecord,
  CompRow,
  BlockMeta,
  StoreysArea,
  LeaseBucket,
  ValuationData,
} from './hyparquetCore';

export function createHyparquet(): {
  recent: HyparquetApi['recent'];
  streets: HyparquetApi['streets'];
  psfScatter: HyparquetApi['psfScatter'];
  townMap: HyparquetApi['townMap'];
  townRecords: HyparquetApi['townRecords'];
  resolveBlock: HyparquetApi['resolveBlock'];
  storeysAndArea: HyparquetApi['storeysAndArea'];
  valuation: HyparquetApi['valuation'];
  prefetch: () => void;
  warmWhenIdle: () => void;
} {
  let remote: HyparquetApi | null = null;
  const connect = () => (remote ??= createRemote());

  // One thin pass-through per engine method (the worker boots on the first of these).
  const recent: HyparquetApi['recent'] = (o) => connect().recent(o);
  const streets: HyparquetApi['streets'] = (t) => connect().streets(t);
  const psfScatter: HyparquetApi['psfScatter'] = (s) => connect().psfScatter(s);
  const townMap: HyparquetApi['townMap'] = (o) => connect().townMap(o);
  const townRecords: HyparquetApi['townRecords'] = (o) => connect().townRecords(o);
  const resolveBlock: HyparquetApi['resolveBlock'] = (p) => connect().resolveBlock(p);
  const storeysAndArea: HyparquetApi['storeysAndArea'] = (p, f) => connect().storeysAndArea(p, f);
  const valuation: HyparquetApi['valuation'] = (o) => connect().valuation(o);

  // Decode the parquet in the worker now, so the first real query resolves instantly.
  const prefetch = () => {
    connect()
      .warm()
      .catch(() => {});
  };

  // Warm at idle: skip under Save-Data; bound the idle wait so a busy main thread can't
  // starve it forever; and while the page is only being speculatively prerendered, defer
  // until it's activated.
  const warmWhenIdle = () => {
    if ((navigator as any).connection?.saveData) return;
    const idle: (cb: () => void, opts?: { timeout: number }) => void =
      (window as any).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 1500));
    const warm = () => idle(prefetch, { timeout: 2000 });
    if ((document as any).prerendering) {
      document.addEventListener('prerenderingchange', warm, { once: true });
    } else {
      warm();
    }
  };

  return {
    recent,
    streets,
    psfScatter,
    townMap,
    townRecords,
    resolveBlock,
    storeysAndArea,
    valuation,
    prefetch,
    warmWhenIdle,
  };
}
