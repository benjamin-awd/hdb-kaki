// A "Show all / Show fewer" toggle for the data tables that otherwise cap at a preview
// count. The page supplies a render callback that paints up to `limit` rows (and its own
// "Showing X of Y" footer text) and returns the total row count; this helper owns the
// expand state, wires the toggle link, and keeps its label in sync. The toggle hides
// itself whenever the total fits within the cap, so short tables read exactly as before.
export interface Expander {
  /** Repaint at the current expand state (call after new data lands). */
  render(): void;
  /** Collapse back to the preview count (call when the underlying data changes). */
  reset(): void;
}

export function createExpander(
  toggleId: string,
  cap: number,
  render: (limit: number) => number,
): Expander {
  let expanded = false;
  const link = document.getElementById(toggleId) as HTMLAnchorElement | null;

  function paint() {
    const total = render(expanded ? Infinity : cap);
    if (!link) return;
    if (total > cap) {
      link.hidden = false;
      link.textContent = expanded ? 'Show fewer ↑' : `Show all ${total.toLocaleString()} ↓`;
    } else {
      link.hidden = true;
    }
  }

  link?.addEventListener('click', (e) => {
    e.preventDefault();
    expanded = !expanded;
    paint();
  });

  return {
    render: paint,
    reset() {
      expanded = false;
    },
  };
}

// A "Show N more" (load-more) control for the tables whose result set can run long — it
// reveals `step` more rows per click instead of dumping the whole set at once, which keeps
// the card's footer (download button) reachable and lets users pace their scan. Preferred
// over expand-all / infinite scroll for goal-directed lists (Baymard, NN/g). Once every row
// is shown the link flips to "Show fewer" to collapse back to the first `step`. Same render
// contract as createExpander: paint up to `limit` rows (+ your own footer text), return the
// total. The link hides itself when the total fits within one `step`.
export function createLoadMore(
  toggleId: string,
  step: number,
  render: (limit: number) => number,
): Expander {
  let shown = step;
  let total = 0;
  const link = document.getElementById(toggleId) as HTMLAnchorElement | null;

  function paint() {
    total = render(shown);
    if (!link) return;
    if (total <= step) {
      link.hidden = true;
      return;
    }
    link.hidden = false;
    const visible = Math.min(shown, total);
    link.textContent =
      visible < total ? `Show ${Math.min(step, total - visible)} more ↓` : 'Show fewer ↑';
  }

  link?.addEventListener('click', (e) => {
    e.preventDefault();
    const visible = Math.min(shown, total);
    // Not everything shown yet → reveal the next step; otherwise collapse to the preview.
    shown = visible < total ? visible + step : step;
    paint();
  });

  return {
    render: paint,
    reset() {
      shown = step;
    },
  };
}
