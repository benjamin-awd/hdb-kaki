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
