import { FloatingPanel, positionMenu } from '../milkdown/floating-panel';

export const fontSize = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 12 && value <= 24 ? value : 17;

export function setupFontSize(initial: number, changed: (size: number) => void) {
  const trigger = document.querySelector<HTMLButtonElement>('#font-size')!;
  const label = trigger.querySelector<HTMLElement>('.header-action-label')!;
  const menu = document.createElement('div');
  menu.className = 'font-size-menu'; menu.id = 'font-size-menu';
  menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Document font size');
  const heading = document.createElement('span'); heading.textContent = 'Text size';
  const value = document.createElement('output'); value.setAttribute('aria-live', 'polite');
  const button = (text: string, name: string, action: () => void) => {
    const result = document.createElement('button'); result.type = 'button'; result.textContent = text;
    result.setAttribute('aria-label', name); result.addEventListener('click', action); return result;
  };
  let current = fontSize(initial);
  const apply = (notify = true) => {
    document.documentElement.style.setProperty('--editor-font-size', `${current}px`);
    label.textContent = `${current}px`; value.textContent = `${current}px`;
    trigger.setAttribute('aria-label', `Font size: ${current} pixels`);
    smaller.disabled = current === 12; larger.disabled = current === 24;
    if (notify) changed(current);
  };
  const smaller = button('−', 'Decrease font size', () => {current = Math.max(12, current - 1); apply();});
  const larger = button('+', 'Increase font size', () => {current = Math.min(24, current + 1); apply();});
  const reset = button('Reset', 'Reset font size to 17 pixels', () => {current = 17; apply();});
  const close = button('×', 'Close font size controls', () => {panel.hide(); trigger.focus();});
  menu.append(heading, smaller, value, larger, reset, close);
  document.body.append(menu); trigger.setAttribute('aria-controls', menu.id);
  const panel = new FloatingPanel(menu, 2, () => trigger.setAttribute('aria-expanded', 'false'), restore => {if (restore) trigger.focus();});
  trigger.addEventListener('click', () => {
    if (menu.dataset.show === 'true') {panel.hide(); return;}
    if (!panel.show()) return;
    trigger.setAttribute('aria-expanded', 'true'); positionMenu(menu, trigger.getBoundingClientRect());
    (smaller.disabled ? larger : smaller).focus();
  });
  document.addEventListener('pointerdown', event => {if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) panel.hide();});
  document.addEventListener('focusin', event => {if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) panel.hide();});
  window.addEventListener('resize', () => panel.hide());
  document.getElementById('document-scroll')?.addEventListener('scroll', () => panel.hide(), {passive: true});
  apply(false);
}
