import { writeFileSync } from 'node:fs';

export interface CdpSession {
  /** 在 renderer 页面上下文求值（自动 awaitPromise + returnByValue）。*/
  eval<T = unknown>(expr: string): Promise<T>;
  /** 截图存到 path（png）。*/
  screenshot(path: string): Promise<void>;
  /** 本会话期间捕获的未处理异常 / console.error。*/
  errors(): readonly string[];
  close(): void;
}

/** 连到 host:port 的 CDP page target（须 app 以 --remote-debugging-port 启动）。*/
export async function connectCdp(port: number, host = '127.0.0.1'): Promise<CdpSession> {
  const targets = (await (await fetch(`http://${host}:${port}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no CDP page target (app not ready?)');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(new Error('cdp ws error')); });

  let id = 1;
  const pending = new Map<number, (m: any) => void>();
  const errors: string[] = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data as string);
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      errors.push('CONSOLE.ERROR: ' + (m.params.args ?? []).map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
  });

  const rpc = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
    const i = id++;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error(`cdp timeout: ${method}`)); } }, 120_000);
  });

  await rpc('Runtime.enable');
  await rpc('Page.enable');

  return {
    async eval<T>(expr: string): Promise<T> {
      const r = await rpc('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error('eval threw: ' + (r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails)));
      return r.result?.result?.value as T;
    },
    async screenshot(path: string): Promise<void> {
      const r = await rpc('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(r.result.data, 'base64'));
    },
    errors: () => errors,
    close: () => ws.close(),
  };
}
