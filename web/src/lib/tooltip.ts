// Tap-to-toggle for .info / .term tooltips. Desktop reveals them on hover /
// :focus-visible; touch fires neither reliably, so a tap toggles an `open` class
// instead, with an outside tap or Escape to dismiss. Imported by both Info.astro and
// Term.astro — the guard keeps the single delegated listener idempotent if a page
// renders both. `aria-expanded` is only touched on triggers that declare it (the
// i-buttons); terms stay pure tooltips.
//
// Positioning: at rest the popover is centred with a CSS transform, which browsers
// exclude from scrollable overflow, so a hidden popover never widens the page. That
// centring clips against the viewport edge for triggers near it, so on phones `place`
// re-anchors an opening popover to a clamped left offset (and points its arrow back at
// the trigger). Only opened popovers get inline positioning; closed ones fall back to
// the transform, keeping the page free of horizontal scroll.
declare global {
  interface Window {
    __tipInit?: boolean;
  }
}

const isPhone = () => window.matchMedia('(max-width: 560px)').matches;

const clear = (pop: HTMLElement) => {
  pop.style.left = '';
  pop.style.right = '';
  pop.style.transform = '';
  pop.style.removeProperty('--tip-arrow');
};

// Clamp an opening popover within the viewport (phones only) and aim its arrow at the
// trigger. offsetWidth is transform-independent, so the in-flight reveal doesn't skew it.
const place = (trigger: Element) => {
  const pop = trigger.querySelector<HTMLElement>('.info-pop');
  if (!pop) return;
  if (!isPhone()) return clear(pop);
  const t = trigger.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const margin = 8;
  const w = pop.offsetWidth;
  const centerX = t.left + t.width / 2;
  const left = Math.max(margin, Math.min(centerX - w / 2, vw - margin - w));
  pop.style.left = `${left - t.left}px`;
  pop.style.right = 'auto';
  pop.style.transform = 'translateY(0)';
  pop.style.setProperty('--tip-arrow', `${centerX - left}px`);
};

if (typeof document !== 'undefined' && !window.__tipInit) {
  window.__tipInit = true;

  const closeAll = (except?: Element | null) => {
    document.querySelectorAll<HTMLElement>('.info.open, .term.open').forEach((el) => {
      if (el === except) return;
      el.classList.remove('open');
      if (el.hasAttribute('aria-expanded')) el.setAttribute('aria-expanded', 'false');
      const pop = el.querySelector<HTMLElement>('.info-pop');
      if (pop) clear(pop);
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
      const pop = trigger.querySelector<HTMLElement>('.info-pop');
      if (pop) {
        if (open) place(trigger);
        else clear(pop);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
}

export {};
