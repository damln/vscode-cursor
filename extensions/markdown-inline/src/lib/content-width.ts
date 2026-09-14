import { FloatingPanel, positionMenu } from '../milkdown/floating-panel';

export type ContentWidth = 'normal' | 'large' | 'full';
export const contentWidth = (value: unknown): ContentWidth => value === 'large' || value === 'full' ? value : 'normal';

export function setupContentWidth(initial: ContentWidth, changed: (width: ContentWidth) => void) {
  const trigger = document.querySelector<HTMLButtonElement>('#content-width')!;
  const menu = document.createElement('div'); menu.className = 'content-width-menu'; menu.id = 'content-width-menu';
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Content width');
  document.body.append(menu);
  trigger.setAttribute('aria-controls', menu.id);
  const panel = new FloatingPanel(menu, 2, () => trigger.setAttribute('aria-expanded', 'false'), restore => {if (restore) trigger.focus();});
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
  trigger.addEventListener('click', () => {
    if (menu.dataset.show === 'true') {panel.hide(); return;}
    if (!panel.show()) return;
    trigger.setAttribute('aria-expanded', 'true'); positionMenu(menu, trigger.getBoundingClientRect());
    menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  });
  menu.addEventListener('keydown', event => {
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('button'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? (index+1)%3 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? (index+2)%3 : -1;
    if (next < 0) return;
    event.preventDefault(); current = options[next][0]; apply(); changed(current); buttons[next].focus();
  });
  document.addEventListener('pointerdown', event => {if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) panel.hide();});
  document.addEventListener('focusin', event => {if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) panel.hide();});
  window.addEventListener('resize', () => panel.hide());
  apply();
}
