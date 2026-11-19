// Local tests; no Photoshop, Gemini key, or paid API requests required.
const vm = require('node:vm');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
class Element {
  constructor() { this.children = []; this.value = ''; this.textContent = ''; this.disabled = false; this.events = {}; }
  addEventListener(name, callback) { this.events[name] = callback; }
  appendChild(child) { this.children.push(child); }
  querySelector() { return null; }
  focus() {}
}
const elements = Object.fromEntries(['status', 'reconnect', 'chat-form', 'question', 'send', 'activity', 'messages'].map(id => [id, new Element()]));
const document = { getElementById: id => elements[id], createElement: () => new Element() };
let posts = 0;
let mode = 'success';
let received;
const server = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    if (req.url === '/health') { res.end(JSON.stringify({ status: 'ok', protocol: 'photoshop-actions-v1' })); return; }
    posts++;
    received = JSON.parse(body);
    setTimeout(() => {
      if (mode === 'quota') { res.statusCode = 429; res.end(JSON.stringify({ error: 'Gemini usage limit reached. Please try later.' })); }
      else { res.end(JSON.stringify({ reply: 'Use **Ctrl + J**. <img src=x onerror=alert(1)>', actions: [], protocol: 'photoshop-actions-v1' })); }
    }, 30);
  });
});
const waitUntil = async predicate => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('Timed out waiting for test condition');
};
const submit = () => elements['chat-form'].events.submit({ preventDefault() {} });
(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5000, '127.0.0.1', resolve); });
  try {
    const code = fs.readFileSync(path.join(__dirname, 'extension/panel.js'), 'utf8');
    const bridge = process.argv[2] || 'window';
    const sandbox = { document, window: { ChatActions: { isBlocked: () => false, begin: cb => cb(null, null), release() {}, lastResult: () => 'No edits', present() { throw Error('Unexpected plan'); } } }, setTimeout, clearTimeout };
    if (bridge === 'window') sandbox.window.cep_node = { require };
    if (bridge === 'global') sandbox.cep_node = { require };
    if (bridge === 'require') sandbox.require = require;
    if (bridge === 'window-require') sandbox.window.require = require;
    if (bridge === 'fallback') {
      sandbox.window.cep_node = { require: () => { throw new Error('Simulated incompatible bridge'); } };
      sandbox.require = require;
    }
    vm.runInNewContext(code, sandbox);
    await waitUntil(() => elements.status.textContent === 'Server connected');
    assert.equal(posts, 0, 'Health check must not send a chat');
    submit();
    assert.equal(posts, 0, 'Blank message must not send');
    elements.question.value = 'தமிழ் — layer opacity?';
    elements.question.events.input();
    assert.equal(elements.send.disabled, false);
    submit(); submit();
    assert.equal(elements.send.disabled, true);
    await waitUntil(() => elements.question.value === '');
    assert.equal(posts, 1, 'Double submission must not duplicate requests');
    assert.equal(received.message, 'தமிழ் — layer opacity?');
    const reply = elements.messages.children.at(-1).children[1];
    assert.equal(reply.textContent, 'Use **Ctrl + J**. <img src=x onerror=alert(1)>');
    assert.equal(reply.children.length, 0, 'Model output must be text, not HTML');
    mode = 'quota';
    elements.question.value = 'How do I rename it?';
    submit();
    await waitUntil(() => elements.activity.textContent.startsWith('Request failed.'));
    assert.equal(elements.question.value, 'How do I rename it?');
    assert.equal(posts, 2, 'No automatic retry after quota error');
    assert.match(elements.messages.children.at(-1).children[1].textContent, /usage limit/);
    await new Promise(resolve => server.close(resolve));
    elements.reconnect.events.click();
    await waitUntil(() => elements.status.textContent === 'Server unavailable');
    assert.equal(elements.send.disabled, true);
    console.log('PASS [' + bridge + ']: health, empty input, Unicode payload, duplicate prevention, safe text rendering, quota handling, input preservation, offline state.');
    vm.runInNewContext(code, { document, window: { __adobe_cep__: {} }, setTimeout, clearTimeout });
    assert.match(elements.status.textContent, /Connection bridge unavailable/);
    assert.match(elements.activity.textContent, /B01/);
    vm.runInNewContext(code, { document, window: { cep_node: { require: () => { throw new Error('Test module failure'); } } }, setTimeout, clearTimeout });
    assert.match(elements.activity.textContent, /B02.*Test module failure/);
    console.log('PASS: missing bridge and failed modules have distinct diagnostics.');
  } finally { server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
