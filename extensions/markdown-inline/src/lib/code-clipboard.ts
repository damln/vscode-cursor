/** Use the extension host clipboard: browser clipboard permissions vary in webviews. */
export function copyCode(text: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Copy cancelled.')); return; }
    const requestId = crypto.randomUUID();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve();
    };
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (message?.type !== 'copyCodeResult' || message.requestId !== requestId) return;
      if (message.success === true) finish();
      else if (message.success === false) finish(new Error('Could not copy code. Try again.'));
    };
    const cancel = () => finish(new Error('Copy cancelled.'));
    const timer = setTimeout(() => finish(new Error('Clipboard did not respond. Try again.')), 15000);
    window.addEventListener('message', receive);
    signal.addEventListener('abort', cancel, {once: true});
    window.dispatchEvent(new CustomEvent('damln-copy-code', {detail: {text, requestId}}));
  });
}
