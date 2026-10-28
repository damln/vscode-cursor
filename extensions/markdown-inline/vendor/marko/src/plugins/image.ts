import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { $view } from '@milkdown/kit/utils';
import { scopeOf } from '../scope';
import { FloatingPanel, positionMenu } from './floating-panel';

const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
const path = (src: string) => src.split(/[?#]/)[0];
/** Image syntax pointing at a video file renders a player. */
export const isVideoSource = (src: string) => VIDEO.test(path(src));
/** Image syntax pointing at an audio file renders an audio player. */
export const isAudioSource = (src: string) => AUDIO.test(path(src));
const kindOf = (src: string) =>
  isVideoSource(src) ? 'video' : isAudioSource(src) ? 'audio' : 'image';
const KIND_LABELS = { image: 'Image', video: 'Video', audio: 'Audio' } as const;
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
function unloadPlayers(...players: HTMLMediaElement[]) {
  for (const player of players) {
    player.removeAttribute('src');
    player.load();
  }
}

export const imageView = $view(imageSchema.node, () => (initial, view, getPos) => {
  const scope = scopeOf(view);
  let node = initial,
    disposed = false,
    controller: AbortController | undefined;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  const dom = document.createElement('span');
  dom.className = 'inline-image';
  dom.contentEditable = 'false';
  const img = document.createElement('img');
  img.draggable = false;
  img.decoding = 'async';
  img.hidden = true;
  const video = document.createElement('video');
  video.controls = true;
  video.preload = 'metadata';
  video.hidden = true;
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.hidden = true;
  const caption = document.createElement('span');
  caption.className = 'image-caption';
  caption.hidden = true;
  const status = document.createElement('span');
  status.className = 'image-status';
  status.setAttribute('role', 'status');
  const pathLabel = document.createElement('span');
  pathLabel.className = 'image-path';
  const actions = document.createElement('span');
  actions.className = 'image-actions';
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = 'Open';
  open.setAttribute('aria-label', 'Open image');
  open.addEventListener('click', () => scope.host.openLink(node.attrs.src));
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.textContent = 'Edit path';
  edit.setAttribute('aria-label', 'Edit image path');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    const pos = getPos();
    if (disposed || !view.editable || pos == null) return;
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
    view.focus();
  });
  actions.append(open, edit, remove);
  dom.append(img, video, caption, audio, status, pathLabel, actions);
  const form = document.createElement('form');
  form.className = 'image-path-panel';
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-label', 'Edit image path');
  const label = document.createElement('label');
  label.textContent = 'Image path';
  const input = document.createElement('input');
  input.type = 'text';
  input.required = true;
  input.setAttribute('aria-label', 'Image path');
  label.append(input);
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Apply';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  form.append(label, save, cancel);
  scope.overlay.append(form);
  const floating = new FloatingPanel(
    form,
    3,
    () => edit.setAttribute('aria-expanded', 'false'),
    (restore) => {
      floating.hide();
      if (restore) edit.focus();
    },
  );
  edit.setAttribute('aria-haspopup', 'dialog');
  edit.setAttribute('aria-expanded', 'false');
  edit.addEventListener('click', () => {
    if (!view.editable || disposed) return;
    input.value = node.attrs.src;
    floating.show();
    positionMenu(form, edit.getBoundingClientRect());
    edit.setAttribute('aria-expanded', 'true');
    input.focus();
    input.select();
  });
  const close = () => {
    floating.hide();
    edit.focus();
  };
  cancel.addEventListener('click', close);
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const pos = getPos();
    if (disposed || !view.editable || pos == null || !input.value.trim()) return;
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: input.value.trim() }),
    );
    floating.hide();
    view.focus();
  });
  const abort = new AbortController();
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!form.contains(event.target as Node) && event.target !== edit) floating.hide();
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    'focusin',
    (event) => {
      if (!form.contains(event.target as Node) && event.target !== edit) floating.hide();
    },
    { signal: abort.signal },
  );
  const failed = (message: string) => {
    clearTimeout(loadTimer);
    img.hidden = video.hidden = audio.hidden = caption.hidden = true;
    dom.dataset.state = 'error';
    status.textContent = `${node.attrs.alt || KIND_LABELS[kindOf(node.attrs.src)]}: ${message}`;
    status.hidden = false;
    pathLabel.hidden = false;
  };
  const attributes = () => {
    img.alt = node.attrs.alt || '';
    img.title = video.title = audio.title = node.attrs.title || '';
    pathLabel.textContent = node.attrs.src;
    caption.textContent = node.attrs.alt || path(node.attrs.src).split('/').pop() || 'Audio';
    video.setAttribute('aria-label', node.attrs.alt || 'Video');
    audio.setAttribute('aria-label', node.attrs.alt || 'Audio');
    open.disabled =
      !node.attrs.src ||
      (/^[a-z][a-z\d+.-]*:/i.test(node.attrs.src) && !/^(https?|file):/i.test(node.attrs.src));
    edit.disabled = remove.disabled = !view.editable;
    remove.setAttribute('aria-label', `Remove ${kindOf(node.attrs.src)}`);
  };
  const watchMedia = (
    media: HTMLImageElement | HTMLVideoElement | HTMLAudioElement,
    kind: keyof typeof KIND_LABELS,
    live: () => boolean,
  ) => {
    const loaded = () => {
      if (!live()) return;
      clearTimeout(loadTimer);
      media.hidden = false;
      caption.hidden = media !== audio;
      status.hidden = true;
      pathLabel.hidden = true;
      dom.dataset.state = 'loaded';
    };
    img.onload = media === img ? loaded : null;
    video.onloadedmetadata = media === video ? loaded : null;
    audio.onloadedmetadata = media === audio ? loaded : null;
    img.onerror = video.onerror = audio.onerror = null;
    media.onerror = () => {
      if (live()) failed(`Could not load this ${kind}. Check the path or connection.`);
    };
    loadTimer = setTimeout(() => {
      if (live()) failed(`${KIND_LABELS[kind]} loading timed out.`);
    }, 15000);
  };
  const render = async () => {
    controller?.abort();
    clearTimeout(loadTimer);
    const request = new AbortController();
    controller = request;
    const live = () => !disposed && !request.signal.aborted;
    const kind = kindOf(node.attrs.src),
      media = { video, audio, image: img }[kind];
    attributes();
    dom.dataset.state = 'loading';
    dom.dataset.kind = kind;
    status.textContent = `Loading ${node.attrs.alt || kind}…`;
    status.hidden = false;
    pathLabel.hidden = false;
    img.hidden = video.hidden = audio.hidden = caption.hidden = true;
    img.removeAttribute('src');
    unloadPlayers(video, audio);
    try {
      const uri = await scope.host.resolveImage(node.attrs.src, request.signal);
      if (!live()) return;
      watchMedia(media, kind, live);
      media.src = uri;
    } catch (error) {
      if (live()) failed(errorMessage(error, `Could not resolve ${kind}.`));
    }
  };
  void render();
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false;
      const changed = next.attrs.src !== node.attrs.src;
      node = next;
      attributes();
      if (changed) void render();
      return true;
    },
    stopEvent(event) {
      return (
        actions.contains(event.target as Node) || event.target === video || event.target === audio
      );
    },
    ignoreMutation() {
      return true;
    },
    destroy() {
      disposed = true;
      controller?.abort();
      abort.abort();
      clearTimeout(loadTimer);
      img.onload = img.onerror = video.onloadedmetadata = video.onerror = null;
      audio.onloadedmetadata = audio.onerror = null;
      for (const player of [video, audio]) {
        player.removeAttribute('src');
        player.load();
      }
      floating.destroy();
    },
  };
});
