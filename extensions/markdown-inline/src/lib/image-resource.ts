export function imageResource(src: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const finish = (uri?: string, error?: string) => {
      clearTimeout(timer); window.removeEventListener('message', receive); signal.removeEventListener('abort', cancel);
      if (uri) resolve(uri); else reject(new Error(error || 'Image resolution cancelled.'));
    };
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (message?.type !== 'imageResourceResult' || message.requestId !== requestId) return;
      finish(typeof message.uri === 'string' ? message.uri : undefined, message.error);
    };
    const cancel = () => finish();
    const timer = setTimeout(() => finish(undefined, 'Image resolution timed out.'), 15000);
    window.addEventListener('message', receive); signal.addEventListener('abort', cancel, {once:true});
    if (signal.aborted) {cancel(); return;}
    window.dispatchEvent(new CustomEvent('damln-image-resource', {detail:{src, requestId}}));
  });
}
