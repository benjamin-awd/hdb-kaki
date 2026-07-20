import { test, expect, describe, mock, beforeEach } from 'bun:test';

// Exercise createQuery()'s warm/query control flow without booting DuckDB-WASM: the
// heavy engine module is mocked, so these tests assert *which gates* actually guard the
// download. That's the point — they're the safety net for trimming warm call sites: if a
// gate here is load-bearing (Save-Data, speculative prerender) a test fails when it's
// removed; if a wrapper is a pass-through, the test shows there's nothing else to keep.
const dbPrefetch = mock(() => {});
const dbQuery = mock(async () => [{ n: 1 }]);
mock.module('./db', () => ({ prefetch: dbPrefetch, query: dbQuery }));

const { createQuery } = await import('./duckdbClient');

// prefetch()/query() dynamically import('./db') then call it, so the mock runs a couple of
// microtasks later — flush lets those settle before we assert on the mock.
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Stub the browser globals warmEngineWhenIdle() reads, and expose hooks to fire the
 *  idle callback and the prerender-activation event it registers. */
function stubEnv({ saveData = false, prerendering = false } = {}) {
  const idleCbs: Array<() => void> = [];
  const prerenderCbs: Array<() => void> = [];
  const def = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  def('navigator', { connection: { saveData } });
  def('window', { requestIdleCallback: (cb: () => void) => idleCbs.push(cb) });
  def('document', {
    prerendering,
    addEventListener: (ev: string, cb: () => void) => {
      if (ev === 'prerenderingchange') prerenderCbs.push(cb);
    },
  });
  return {
    idleScheduled: () => idleCbs.length,
    fireIdle: () => idleCbs.forEach((c) => c()),
    firePrerenderActivation: () => prerenderCbs.forEach((c) => c()),
  };
}

beforeEach(() => {
  dbPrefetch.mockClear();
  dbQuery.mockClear();
});

describe('createQuery — laziness', () => {
  test('constructing it does not touch the engine module', async () => {
    createQuery();
    await flush();
    expect(dbPrefetch).not.toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
  });
});

describe('createQuery — query / prefetch pass-throughs', () => {
  test('query() runs the SQL through db.query and returns the rows', async () => {
    const { query } = createQuery();
    const rows = await query('SELECT 1');
    expect(dbQuery).toHaveBeenCalledTimes(1);
    expect(dbQuery.mock.calls[0][0]).toBe('SELECT 1');
    expect(rows).toEqual([{ n: 1 }]);
  });

  test('prefetch() boots the engine via db.prefetch', async () => {
    const { prefetch } = createQuery();
    prefetch();
    await flush();
    expect(dbPrefetch).toHaveBeenCalledTimes(1);
  });
});

describe('warmEngineWhenIdle — the load-bearing gates', () => {
  test('Save-Data gate: no schedule, no warm', async () => {
    const env = stubEnv({ saveData: true });
    createQuery().warmEngineWhenIdle();
    await flush();
    expect(env.idleScheduled()).toBe(0);
    expect(dbPrefetch).not.toHaveBeenCalled();
  });

  test('unconstrained: schedules one idle warm that boots the engine', async () => {
    const env = stubEnv({ saveData: false, prerendering: false });
    createQuery().warmEngineWhenIdle();
    expect(env.idleScheduled()).toBe(1);
    env.fireIdle();
    await flush();
    expect(dbPrefetch).toHaveBeenCalledTimes(1);
  });

  test('prerender gate: defers the warm until activation, never during prerender', async () => {
    const env = stubEnv({ prerendering: true });
    createQuery().warmEngineWhenIdle();
    await flush();
    // Speculative prerender in flight — nothing scheduled, nothing downloaded.
    expect(env.idleScheduled()).toBe(0);
    expect(dbPrefetch).not.toHaveBeenCalled();
    // On activation the idle warm is scheduled and, once idle, boots.
    env.firePrerenderActivation();
    expect(env.idleScheduled()).toBe(1);
    env.fireIdle();
    await flush();
    expect(dbPrefetch).toHaveBeenCalledTimes(1);
  });
});
