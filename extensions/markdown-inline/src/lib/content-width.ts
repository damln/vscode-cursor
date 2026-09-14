import { readingPopover } from './reading-popover';

export type ContentWidth = 'normal' | 'large' | 'full';
export const contentWidth = (value: unknown): ContentWidth => value === 'large' || value === 'full' ? value : 'normal';

export function setupContentWidth(initial: ContentWidth, changed: (width: ContentWidth) => void) {
  const trigger = document.querySelector<HTMLButtonElement>('#content-width')!;
  const menu = document.createElement('div'); menu.className = 'content-width-menu'; menu.id = 'content-width-menu';
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Content width');
  document.body.append(menu);
  trigger.setAttribute('aria-controls', menu.id);
  const panel = readingPopover(trigger, menu, () => menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  let current = initial;
  const options = [['normal', 'Normal'], ['large', 'Large'], ['full', 'Full width']] as const;
  const apply = () => {
    document.documentElement.dataset.contentWidth = current;
    trigger.setAttribute('aria-label', `Content width: ${options.find(([key]) => key === current)![1]}`);
    menu.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      const active = button.dataset.width === current;
      button.setAttribute('aria-checked', String(active)); button.tabIndex = active ? 0 : -1;
    });
  };
  for (const [width, label] of options) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.dataset.width = width; button.setAttribute('role', 'menuitemradio');
    button.addEventListener('click', () => {current = width; apply(); changed(width); panel.hide(); trigger.focus();});
    menu.append(button);
  }
  menu.addEventListener('keydown', event => {
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('button'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? (index+1)%3 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? (index+2)%3 : -1;
    if (next < 0) return;
    event.preventDefault(); current = options[next][0]; apply(); changed(current); buttons[next].focus();
  });
  apply();
  return (width: ContentWidth) => {current = contentWidth(width); apply();};
}
