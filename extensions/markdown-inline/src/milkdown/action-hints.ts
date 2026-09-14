import { $prose } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';
import { positionMenu } from './floating-panel';

export const actionHints = $prose(() => new Plugin({view() {
  const abort = new AbortController(), options = {signal: abort.signal};
  const hint = document.createElement('div'); hint.className = 'action-hint'; hint.id = `action-hint-${crypto.randomUUID()}`;
  hint.setAttribute('role', 'tooltip'); hint.hidden = true; document.body.append(hint);
  let owner: HTMLElement | null = null, previousDescription: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer); hint.hidden = true;
    if (owner) {
      if (previousDescription) owner.setAttribute('aria-describedby', previousDescription); else owner.removeAttribute('aria-describedby');
    }
    owner = null;
  };
  const show = (button: HTMLElement, delay: number) => {
    if (owner === button && !hint.hidden) return;
    hide(); owner = button; previousDescription = button.getAttribute('aria-describedby');
    timer = setTimeout(() => {
      if (owner !== button || !button.checkVisibility() || button.closest('[data-show="false"]')) {hide(); return;}
      (button.closest('dialog') || document.body).append(hint);
      hint.textContent = button.dataset.toolbarHint || button.getAttribute('aria-label');
      hint.hidden = false; button.setAttribute('aria-describedby', [previousDescription, hint.id].filter(Boolean).join(' '));
      positionMenu(hint, button.getBoundingClientRect());
    }, delay);
  };
  const leave = () => {clearTimeout(timer); timer = setTimeout(() => {if (!hint.matches(':hover') && !owner?.matches(':hover, :focus-visible')) hide();}, 100);};
  document.addEventListener('pointerover', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-toolbar-hint]') : null;
    if (button && event.pointerType !== 'touch') show(button, 250);
  }, options);
  document.addEventListener('pointerout', event => {if (owner?.contains(event.target as Node)) leave();}, options);
  document.addEventListener('focusin', event => {
    const button = event.target instanceof HTMLElement && event.target.matches('[data-toolbar-hint]:focus-visible') ? event.target : null;
    if (button) show(button, 0); else hide();
  }, options);
  hint.addEventListener('pointerenter', () => clearTimeout(timer), options);
  hint.addEventListener('pointerleave', leave, options);
  document.addEventListener('pointerdown', hide, {...options, capture: true});
  window.addEventListener('keydown', event => {if (event.key === 'Escape') hide();}, {...options, capture: true});
  document.addEventListener('scroll', hide, {...options, capture: true});
  window.addEventListener('resize', hide, options); window.addEventListener('blur', hide, options);
  const observer = new MutationObserver(() => {if (owner && (!owner.isConnected || owner.closest('[data-show="false"]'))) hide();});
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-show']});
  return {destroy() {hide(); abort.abort(); observer.disconnect(); hint.remove();}};
}}));
