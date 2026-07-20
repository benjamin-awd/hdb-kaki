// Tap-to-toggle for .info / .term tooltips. Desktop reveals them on hover /
// :focus-visible; touch fires neither reliably, so a tap toggles an `open` class
// instead, with an outside tap or Escape to dismiss. Imported by both Info.astro and
// Term.astro — the guard keeps the single delegated listener idempotent if a page
// renders both. `aria-expanded` is only touched on triggers that declare it (the
// i-buttons); terms stay pure tooltips.
declare global {
  interface Window {
    __tipInit?: boolean;
  }
}

if (typeof document !== 'undefined' && !window.__tipInit) {
  window.__tipInit = true;

  const closeAll = (except?: Element | null) => {
    document.querySelectorAll('.info.open, .term.open').forEach((el) => {
      if (el === except) return;
      el.classList.remove('open');
      if (el.hasAttribute('aria-expanded')) el.setAttribute('aria-expanded', 'false');
    });
  };

  document.addEventListener('click', (e) => {
    const trigger = (e.target as Element)?.closest('.info, .term');
    closeAll(trigger);
    if (trigger) {
      e.preventDefault();
      const open = trigger.classList.toggle('open');
      if (trigger.hasAttribute('aria-expanded')) {
        trigger.setAttribute('aria-expanded', String(open));
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
}

export {};
