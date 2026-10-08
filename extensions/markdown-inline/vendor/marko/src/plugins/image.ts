import { $view } from '@milkdown/kit/utils';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { scopeOf } from '../scope';
import { FloatingPanel, positionMenu } from './floating-panel';

const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
/** Image syntax pointing at a video file renders a player. */
export const isVideoSource = (src: string) => VIDEO.test(src.split(/[?#]/)[0]);

export const imageView = $view(imageSchema.node, () => (initial, view, getPos) => {
  const scope = scopeOf(view);
  let node = initial, disposed = false, controller: AbortController | undefined;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  const dom = document.createElement('span'); dom.className = 'inline-image'; dom.contentEditable = 'false';
  const img = document.createElement('img'); img.draggable = false; img.decoding = 'async'; img.hidden = true;
  const video = document.createElement('video'); video.controls = true; video.preload = 'metadata'; video.hidden = true;
  const status = document.createElement('span'); status.className = 'image-status'; status.setAttribute('role', 'status');
  const path = document.createElement('span'); path.className = 'image-path';
  const actions = document.createElement('span'); actions.className = 'image-actions';
  const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Open';
  open.setAttribute('aria-label', 'Open image');
  open.addEventListener('click', () => scope.host.openLink(node.attrs.src));
  const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit path'; edit.setAttribute('aria-label','Edit image path');
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    const pos = getPos();
    if (disposed || !view.editable || pos == null) return;
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize)); view.focus();
  });
  actions.append(open, edit, remove); dom.append(img, video, status, path, actions);
  const form = document.createElement('form'); form.className = 'image-path-panel'; form.setAttribute('role','dialog'); form.setAttribute('aria-label','Edit image path');
  const label = document.createElement('label'); label.textContent = 'Image path';
  const input = document.createElement('input'); input.type = 'text'; input.required = true; input.setAttribute('aria-label','Image path'); label.append(input);
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Apply';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  form.append(label, save, cancel); scope.overlay.append(form);
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
    clearTimeout(loadTimer); img.hidden = video.hidden = true; dom.dataset.state = 'error';
    status.textContent = `${node.attrs.alt || 'Image'}: ${message}`; status.hidden = false; path.hidden = false;
  };
  const attributes = () => {
    img.alt = node.attrs.alt || ''; img.title = video.title = node.attrs.title || ''; path.textContent = node.attrs.src;
    video.setAttribute('aria-label', node.attrs.alt || 'Video');
    open.disabled = !node.attrs.src || (/^[a-z][a-z\d+.-]*:/i.test(node.attrs.src) && !/^(https?|file):/i.test(node.attrs.src));
    edit.disabled = remove.disabled = !view.editable;
    remove.setAttribute('aria-label', isVideoSource(node.attrs.src) ? 'Remove video' : 'Remove image');
  };
  const render = async () => {
    controller?.abort(); clearTimeout(loadTimer); const request = new AbortController(); controller = request;
    const media = isVideoSource(node.attrs.src) ? video : img, kind = media === video ? 'video' : 'image';
    attributes(); dom.dataset.state = 'loading'; dom.dataset.kind = kind; status.textContent = `Loading ${node.attrs.alt || kind}…`; status.hidden = false; path.hidden = false;
    img.hidden = video.hidden = true; img.removeAttribute('src'); video.removeAttribute('src'); video.load();
    try {
      const uri = await scope.host.resolveImage(node.attrs.src, request.signal);
      if (disposed || request.signal.aborted) return;
      const loaded = () => {
        if (disposed || request.signal.aborted) return;
        clearTimeout(loadTimer); media.hidden = false; status.hidden = true; path.hidden = true; dom.dataset.state = 'loaded';
      };
      img.onload = media === img ? loaded : null;
      video.onloadedmetadata = media === video ? loaded : null;
      img.onerror = video.onerror = null;
      media.onerror = () => {if (!disposed && !request.signal.aborted) failed(`Could not load this ${kind}. Check the path or connection.`);};
      loadTimer = setTimeout(() => {if (!disposed && !request.signal.aborted) failed(`${kind === 'video' ? 'Video' : 'Image'} loading timed out.`);}, 15000);
      media.src = uri;
    } catch (error) {if (!disposed && !request.signal.aborted) failed(error instanceof Error ? error.message : 'Could not resolve image.');}
  };
  void render();
  return {
    dom,
    update(next) {if (next.type !== node.type) return false; const changed = next.attrs.src !== node.attrs.src; node = next; attributes(); if (changed) void render(); return true;},
    stopEvent(event) {return actions.contains(event.target as Node) || event.target === video;},
    ignoreMutation() {return true;},
    destroy() {
      disposed = true; controller?.abort(); abort.abort(); clearTimeout(loadTimer);
      img.onload = img.onerror = video.onloadedmetadata = video.onerror = null; video.removeAttribute('src'); video.load(); floating.destroy();
    },
  };
});
