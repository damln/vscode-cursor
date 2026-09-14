// Simulate the host's synchronization request before File Actions reads a document.
exports.flushEditor = async page => {
  await page.mouse.move(0, 0);
  return page.evaluate(() => new Promise((resolve, reject) => {
    const original = window.bridge;
    const flushId = crypto.randomUUID();
    const timer = setTimeout(() => {window.bridge = original; reject(new Error('Flush timed out'));}, 5000);
    window.bridge = async message => {
      await original(message);
      if (message.type === 'flushComplete' && message.flushId === flushId) {
        clearTimeout(timer); window.bridge = original; resolve(message);
      }
    };
    window.postMessage({type: 'flush', flushId}, '*');
  }));
};
