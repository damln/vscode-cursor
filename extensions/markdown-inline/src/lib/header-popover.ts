import { FloatingPanel, positionMenu } from '../milkdown/floating-panel';

/** One descriptive tooltip shared by the header, including optional actions. */
export function setupHeaderPopovers() {
  const buttons = document.querySelectorAll<HTMLButtonElement>('header button:not([aria-haspopup]), #inline-theme');
  const tooltip = document.createElement('div');
  tooltip.id = 'header-popover';
  tooltip.className = 'header-popover';
  tooltip.setAttribute('role', 'tooltip');
  const title = document.createElement('strong');
  const description = document.createElement('span');
  const dismissHint = document.createElement('small');
  dismissHint.textContent = 'Esc to dismiss';
  tooltip.append(title, description, dismissHint);
  document.body.append(tooltip);
  let owner: HTMLButtonElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const panel = new FloatingPanel(tooltip, 1, () => {
    clearTimeout(timer);
    owner?.removeAttribute('aria-describedby');
    owner = null;
  });
  const hide = () => { clearTimeout(timer); panel.hide(); };
  const update = () => {
    if (!owner) return;
    title.textContent = owner.getAttribute('aria-label') || owner.textContent?.trim() || '';
    description.textContent = owner.dataset.tooltip || '';
    positionMenu(tooltip, owner.getBoundingClientRect());
  };
  const show = (button: HTMLButtonElement, delay: number) => {
    clearTimeout(timer);
    if (owner && owner !== button) panel.hide();
    const open = () => {
      if (button.hidden || !panel.show()) return;
      owner = button;
      button.setAttribute('aria-describedby', tooltip.id);
      update();
    };
    if (delay) timer = setTimeout(open, delay); else open();
  };
  const leave = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!owner?.matches(':hover, :focus-visible') && !tooltip.matches(':hover')) hide();
    }, 100);
  };
  for (const button of Array.from(buttons)) {
    button.dataset.tooltip ||= button.title || button.getAttribute('aria-label') || '';
    button.dataset.tooltipDefault = button.dataset.tooltip;
    button.removeAttribute('title');
    button.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch' && matchMedia('(hover: hover)').matches) show(button, 220);
    });
    button.addEventListener('pointerleave', leave);
    button.addEventListener('focus', () => { if (button.matches(':focus-visible')) show(button, 0); });
    button.addEventListener('blur', leave);
  }
  tooltip.addEventListener('pointerenter', () => clearTimeout(timer));
  tooltip.addEventListener('pointerleave', leave);
  new MutationObserver(update).observe(document.querySelector('header')!, {
    subtree: true, attributes: true, attributeFilter: ['data-tooltip', 'aria-label'],
  });
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
  document.getElementById('document-scroll')?.addEventListener('scroll', hide, {passive: true});
}
