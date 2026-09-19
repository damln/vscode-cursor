import { FloatingPanel, hideOnViewportChange, positionMenu } from '../milkdown/floating-panel';

export function readingPopover(trigger: HTMLButtonElement, menu: HTMLElement, focus: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => clearTimeout(timer);
  const panel = new FloatingPanel(menu, 2, () => {
    cancel(); trigger.setAttribute('aria-expanded', 'false');
  }, restore => {if (restore) trigger.focus();});
  const hide = () => {cancel(); panel.hide();};
  const show = (keyboard = false) => {
    cancel();
    if (!panel.show()) return;
    trigger.setAttribute('aria-expanded', 'true');
    positionMenu(menu, trigger.getBoundingClientRect());
    if (keyboard) focus();
  };
  trigger.addEventListener('pointerenter', event => {
    if (event.pointerType === 'touch' || !matchMedia('(hover: hover)').matches) return;
    show();
  });
  const leave = () => {
    cancel(); timer = setTimeout(() => {
      if (!trigger.matches(':hover') && !menu.matches(':hover') && !menu.querySelector(':focus-visible')) hide();
    }, 160);
  };
  trigger.addEventListener('pointerleave', leave);
  menu.addEventListener('pointerenter', cancel);
  menu.addEventListener('pointerleave', leave);
  trigger.addEventListener('click', event => {
    if (event.detail === 0) show(true);
    else if (!matchMedia('(hover: hover)').matches && menu.dataset.show === 'true') hide();
    else show();
  });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {event.preventDefault(); show(true);}
    if (event.key === 'Escape') hide();
  });
  const outside = (event: Event) => {
    if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) hide();
  };
  document.addEventListener('pointerdown', outside);
  document.addEventListener('focusin', outside);
  hideOnViewportChange(hide);
  return {hide};
}
