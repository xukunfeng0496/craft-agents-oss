// 崩溃探针：订阅渲染层异常，执行点击，收集堆栈（用后即删）
import WebSocket from 'ws';

const PORT = process.env.CDP_PORT || '9223';
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'));
if (!page) { console.error('no page'); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on('open', r));
let id = 0; const pending = new Map();
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    console.log('\n=== EXCEPTION ===');
    console.log(d.exception?.description?.slice(0, 1500) ?? d.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    const parts = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    console.log('\n=== console.error ===');
    console.log(parts.slice(0, 1500));
  }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Runtime.enable');
// 点击侧栏“技能”
const r = await send('Runtime.evaluate', { expression: `(()=>{window.dispatchEvent(new CustomEvent('craft-agent-navigate',{detail:{route:'skills'},bubbles:true}));return 'navigated to skills'})()`, returnByValue: true });
console.log('[click]', r.result?.result?.value);
await new Promise((r2) => setTimeout(r2, 5000));
console.log('[done] 5s 采集结束');
process.exit(0);
