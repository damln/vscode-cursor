import { readingPopover } from './reading-popover';

export const fontSize = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 10 && value <= 36 ? value : 17;

export function setupFontSize(initial: number, changed: (size: number) => void) {
  const trigger = document.querySelector<HTMLButtonElement>('#font-size')!;
  const label = trigger.querySelector<HTMLElement>('.header-action-label')!;
  const menu = document.createElement('div');
  menu.className = 'font-size-menu'; menu.id = 'font-size-menu';
  menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Document font size');
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
    smaller.disabled = current === 10; larger.disabled = current === 36;
    if (notify) changed(current);
  };
  const smaller = button('−', 'Decrease font size', () => {current = Math.max(10, current - 1); apply();});
  const larger = button('+', 'Increase font size', () => {current = Math.min(36, current + 1); apply();});
  const reset = button('Reset', 'Reset font size to 17 pixels', () => {current = 17; apply();});
  menu.append(smaller, value, larger, reset);
  document.body.append(menu); trigger.setAttribute('aria-controls', menu.id);
  readingPopover(trigger, menu, () => (smaller.disabled ? larger : smaller).focus());
  apply(false);
  return (size: number) => {current = fontSize(size); apply(false);};
}
