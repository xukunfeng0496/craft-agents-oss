import { writeFileSync } from 'node:fs';

export interface CdpSession {
  /** 在 renderer 页面上下文求值（自动 awaitPromise + returnByValue）。*/
  eval<T = unknown>(expr: string): Promise<T>;
  /** 截图存到 path（png）。*/
  screenshot(path: string): Promise<void>;
  /** 本会话期间捕获的未处理异常 / console.error（仅 live 订阅）。*/
  errors(): readonly string[];
  /** 合并 live 订阅 + 页内 window.__e2eErrors 缓冲（用于启动期早于 CDP 连接的错误）。*/
  collectErrors(): Promise<readonly string[]>;
  close(): void;
}

// C1: 安装早捕获脚本，在每个新文档创建时注入错误缓冲
const EARLY_ERROR_SCRIPT = `
window.__e2eErrors = window.__e2eErrors || [];
window.addEventListener('error', (e) => {
  try { window.__e2eErrors.push('window.error: ' + (e.message || e.type)); } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  try { window.__e2eErrors.push('unhandledrejection: ' + String(e.reason)); } catch {}
});
`;

/** 连到 host:port 的 CDP page target（须 app 以 --remote-debugging-port 启动）。*/
export async function connectCdp(port: number, host = '127.0.0.1'): Promise<CdpSession> {
  const targets = (await (await fetch(`http://${host}:${port}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no CDP page target (app not ready?)');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('cdp ws error')); });

  let id = 1;
  const pending = new Map<number, (m: any) => void>();
  const errors: string[] = [];

  // I3: ws 断开时快速失败所有挂起的 RPC
  ws.addEventListener('close', () => {
    for (const [, resolve] of pending) {
      resolve({ error: { message: 'cdp ws closed' }, __closed: true });
    }
    pending.clear();
  });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data as string);
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      errors.push('CONSOLE.ERROR: ' + (m.params.args ?? []).map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
  });

  // I3: 超时从 120s 降到 30s
  const rpc = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
    const i = id++;
    pending.set(i, (m) => {
      if (m.__closed) { reject(new Error('cdp ws closed')); return; }
      resolve(m);
    });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error(`cdp timeout: ${method}`)); } }, 30_000);
  });

  await rpc('Runtime.enable');
  await rpc('Page.enable');

  // C1: 安装启动期错误捕获脚本（在每个新文档上执行）
  await rpc('Page.addScriptToEvaluateOnNewDocument', { source: EARLY_ERROR_SCRIPT });

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
    // C1: collectErrors 合并 live 订阅 + 页内缓冲
    async collectErrors(): Promise<readonly string[]> {
      let pageErrors: string[] = [];
      try {
        const r = await rpc('Runtime.evaluate', {
          expression: 'window.__e2eErrors || []',
          returnByValue: true,
          awaitPromise: false,
        });
        if (Array.isArray(r.result?.result?.value)) {
          pageErrors = r.result.result.value as string[];
        }
      } catch {
        // 页面可能已关闭，忽略
      }
      // 合并去重
      const merged = [...errors];
      for (const e of pageErrors) {
        if (!merged.includes(e)) merged.push(e);
      }
      return merged;
    },
    close: () => ws.close(),
  };
}
