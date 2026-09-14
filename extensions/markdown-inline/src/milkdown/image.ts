import { $view } from '@milkdown/kit/utils';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { imageResource } from '../lib/image-resource';
import { FloatingPanel, positionMenu } from './floating-panel';

export const imageView = $view(imageSchema.node, () => (initial, view, getPos) => {
  let node = initial, disposed = false, controller: AbortController | undefined;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  const dom = document.createElement('span'); dom.className = 'inline-image'; dom.contentEditable = 'false';
  const img = document.createElement('img'); img.draggable = false; img.decoding = 'async'; img.hidden = true;
  const status = document.createElement('span'); status.className = 'image-status'; status.setAttribute('role', 'status');
  const path = document.createElement('span'); path.className = 'image-path';
  const actions = document.createElement('span'); actions.className = 'image-actions';
  const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Open';
  open.setAttribute('aria-label', 'Open image');
  open.addEventListener('click', () => window.dispatchEvent(new CustomEvent('damln-open-link', {detail:node.attrs.src})));
  const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit path'; edit.setAttribute('aria-label','Edit image path');
  actions.append(open, edit); dom.append(img, status, path, actions);
  const form = document.createElement('form'); form.className = 'image-path-panel'; form.setAttribute('role','dialog'); form.setAttribute('aria-label','Edit image path');
  const label = document.createElement('label'); label.textContent = 'Image path';
  const input = document.createElement('input'); input.type = 'text'; input.required = true; input.setAttribute('aria-label','Image path'); label.append(input);
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Apply';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  form.append(label, save, cancel); document.body.append(form);
  const floating = new FloatingPanel(form, 3, () => edit.setAttribute('aria-expanded','false'), restore => {
    floating.hide(); if (restore) edit.focus();
  });
  edit.setAttribute('aria-haspopup','dialog'); edit.setAttribute('aria-expanded','false');
  edit.addEventListener('click', () => {
    if (!view.editable || disposed) return;
    input.value = node.attrs.src; floating.show(); positionMenu(form, edit.getBoundingClientRect());
    edit.setAttribute('aria-expanded','true'); input.focus(); input.select();
  });
  const close = () => {floating.hide(); edit.focus();};
  cancel.addEventListener('click', close);
  form.addEventListener('keydown', event => {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close();}});
  form.addEventListener('submit', event => {
    event.preventDefault(); const pos = getPos();
    if (disposed || !view.editable || pos == null || !input.value.trim()) return;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {...node.attrs, src: input.value.trim()}));
    floating.hide(); view.focus();
  });
  const abort = new AbortController();
  document.addEventListener('pointerdown', event => {
    if (!form.contains(event.target as Node) && event.target !== edit) floating.hide();
  }, {signal:abort.signal});
  document.addEventListener('focusin', event => {
    if (!form.contains(event.target as Node) && event.target !== edit) floating.hide();
  }, {signal:abort.signal});
  const failed = (message: string) => {
    clearTimeout(loadTimer); img.hidden = true; dom.dataset.state = 'error';
    status.textContent = `${node.attrs.alt || 'Image'}: ${message}`; status.hidden = false; path.hidden = false;
  };
  const attributes = () => {
    img.alt = node.attrs.alt || ''; img.title = node.attrs.title || ''; path.textContent = node.attrs.src;
    open.disabled = !node.attrs.src || (/^[a-z][a-z\d+.-]*:/i.test(node.attrs.src) && !/^(https?|file):/i.test(node.attrs.src));
    edit.disabled = !view.editable;
  };
  const render = async () => {
    controller?.abort(); clearTimeout(loadTimer); const request = new AbortController(); controller = request;
    attributes(); dom.dataset.state = 'loading'; status.textContent = `Loading ${node.attrs.alt || 'image'}…`; status.hidden = false; path.hidden = false; img.hidden = true;
    img.removeAttribute('src');
    try {
      const uri = await imageResource(node.attrs.src, request.signal);
      if (disposed || request.signal.aborted) return;
      img.onload = () => {
        if (disposed || request.signal.aborted) return;
        clearTimeout(loadTimer); img.hidden = false; status.hidden = true; path.hidden = true; dom.dataset.state = 'loaded';
      };
      img.onerror = () => {if (!disposed && !request.signal.aborted) failed('Could not load this image. Check the path or connection.');};
      loadTimer = setTimeout(() => {if (!disposed && !request.signal.aborted) failed('Image loading timed out.');}, 15000);
      img.src = uri;
    } catch (error) {if (!disposed && !request.signal.aborted) failed(error instanceof Error ? error.message : 'Could not resolve image.');}
  };
  void render();
  return {
    dom,
    update(next) {if (next.type !== node.type) return false; const changed = next.attrs.src !== node.attrs.src; node = next; attributes(); if (changed) void render(); return true;},
    stopEvent(event) {return actions.contains(event.target as Node);},
    ignoreMutation() {return true;},
    destroy() {disposed = true; controller?.abort(); abort.abort(); clearTimeout(loadTimer); img.onload = img.onerror = null; floating.destroy();},
  };
});
