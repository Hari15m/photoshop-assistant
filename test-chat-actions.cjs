// End-to-end local test: real panel HTTP + action controller + simulated Photoshop.
// It never contacts Gemini and does not verify native Photoshop Undo.
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = name => fs.readFileSync(path.join(__dirname, 'extension', name), 'utf8');
let copies = 0, histories = 0, nextId = 100;
function layer(name, id, opacity = 100) {
  return { name, id, opacity, duplicate() { copies++; return layer(this.name, nextId++, this.opacity); } };
}
const original = layer('Light', 7);
let native;
const doc = { id: 3, name: 'Practice.psd', activeLayer: original,
  suspendHistory(label, script) {
    assert.equal(label, 'Photoshop Assistant: Chat edit');
    assert.equal(script, 'PhotoshopAssistant._applyReviewedSteps()');
    histories++;
    vm.runInContext(script, native);
  }
};
function ActionReference() {}
ActionReference.prototype.putProperty = function () {};
ActionReference.prototype.putEnumerated = function (kind) { this.kind = kind; };
native = vm.createContext({ app: { documents: [doc], activeDocument: doc }, ActionReference,
  charIDToTypeID: x => x, stringIDToTypeID: x => x,
  executeActionGet: ref => ({ getInteger: () => ref.kind === 'document' ? doc.id : doc.activeLayer.id })
});
vm.runInContext(read('host.jsx'), native);
const nativeCall = script => JSON.parse(vm.runInContext(script, native));
const a = (kind, name = null, opacity = null) => ({ kind, name, opacity });
function applyNative(steps, expectedName = doc.activeLayer.name, expectedOpacity = doc.activeLayer.opacity) {
  return nativeCall(`PhotoshopAssistant.applyPlan(3,${doc.activeLayer.id},${JSON.stringify(expectedName)},${expectedOpacity},${JSON.stringify(steps)})`);
}
// Whole-plan validation, no-ops and stale state before mutation.
assert.equal(applyNative([a('duplicate'), a('delete')]).ok, false);
assert.equal(copies, 0);
assert.equal(histories, 0);
assert.equal(applyNative([a('opacity', null, 100)]).unchanged, true);
assert.equal(histories, 0);
assert.equal(applyNative([a('rename', 'Other')], 'Stale').ok, false);
assert.equal(applyNative([a('rename', 'Other')], 'Light', 50).ok, false);
assert.equal(applyNative([a('opacity', null, -1)]).ok, false);
assert.equal(applyNative([a('rename', 'bad\nname')]).ok, false);
assert.equal(applyNative([a('duplicate'), a('rename', 'Shadow'), a('opacity', null, 30)]).ok, true);
assert.equal(doc.activeLayer.name, 'Shadow');
assert.equal(doc.activeLayer.opacity, 30);
assert.equal(original.name, 'Light');
assert.equal(original.opacity, 100);
assert.equal(copies, 1);
assert.equal(histories, 1, 'A compound plan is one history group');
// A mid-plan Photoshop failure must report possible partial changes.
doc.activeLayer = { id: 9, name: 'Locked', get opacity() { return 100; }, set opacity(_) { throw Error('Locked opacity'); } };
let failed = applyNative([a('rename', 'Renamed'), a('opacity', null, 20)]);
assert.equal(failed.ok, false);
assert.equal(failed.completed, 1);
assert.equal(doc.activeLayer.name, 'Renamed');
assert.match(failed.error, /Some changes may remain/);
doc.activeLayer = original;

class Element {
  constructor() { this.children = []; this.value = ''; this.textContent = ''; this.disabled = false; this.hidden = true; this.events = {}; }
  addEventListener(name, callback) { this.events[name] = callback; }
  appendChild(child) { this.children.push(child); }
  querySelector() { return null; }
  focus() {}
}
const elements = {};
const document = { getElementById: id => elements[id] || (elements[id] = new Element()), createElement: () => new Element() };
const scripts = [];
let protocol = 'photoshop-actions-v1', posts = 0, replySteps = [], received;
const sandbox = vm.createContext({ document, window: { cep_node: { require }, __adobe_cep__: {
  evalScript(script, cb) { scripts.push(script); setTimeout(() => cb(vm.runInContext(script, native)), 5); }
} }, setTimeout, clearTimeout });
const server = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    if (req.url === '/health') { res.end(JSON.stringify({ status: 'ok', protocol })); return; }
    posts++;
    received = JSON.parse(body);
    setTimeout(() => res.end(JSON.stringify({ protocol, reply: 'Ready for review. <img onerror=alert(1)>', actions: replySteps })), 20);
  });
});
const wait = async check => {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); }
  throw Error('Timed out');
};
const click = id => elements[id].events.click();
const send = text => { elements.question.value = text; elements['chat-form'].events.submit({ preventDefault() {} }); };
(async () => {
  await new Promise(resolve => server.listen(5000, '127.0.0.1', resolve));
  try {
    for (const file of ['actions.js', 'chat-actions.js', 'panel.js']) vm.runInContext(read(file), sandbox);
    await wait(() => elements.status.textContent === 'Server connected');
    assert.equal(posts, 0);
    const weirdName = 'Shadow "; app.activeDocument.close(); // \\ தமிழ் 🌟\u2028 end';
    replySteps = [a('rename', weirdName)];
    send('Rename this layer'); send('Duplicate again');
    await wait(() => !elements['chat-apply'].disabled);
    assert.equal(posts, 1);
    assert.equal(original.name, 'Light', 'Response must only propose');
    assert.equal(received.selection.layer_name, 'Light');
    assert.equal(received.selection.documentId, undefined, 'Target IDs stay local');
    assert.equal(elements['review-duplicate'].disabled, true);
    assert.equal(elements.send.disabled, true);
    assert.ok(elements['chat-plan'].textContent.includes(weirdName));
    click('chat-cancel');
    assert.equal(original.name, 'Light');
    assert.equal(posts, 1, 'Cancel consumes no API calls');
    assert.equal(elements['review-duplicate'].disabled, false);
    send('Rename this layer');
    await wait(() => !elements['chat-apply'].disabled);
    assert.match(received.last_action_result, /cancelled/);
    click('chat-apply'); click('chat-apply');
    await wait(() => !sandbox.window.ChatActions.isBlocked());
    assert.equal(original.name, weirdName);
    assert.equal(posts, 2, 'Apply consumes no API calls');
    assert.equal(scripts.filter(x => x.startsWith('PhotoshopAssistant.applyPlan')).length, 1);
    assert.equal(scripts.at(-1).includes('app.activeDocument.close'), false, 'Executable payload uses escaped data literals');
    assert.match(elements['chat-action-status'].textContent, /Applied/);
    replySteps = [a('opacity', null, 10)];
    send('Set opacity to 10%');
    await wait(() => !elements['chat-apply'].disabled);
    doc.activeLayer = layer('Another', 88);
    click('chat-apply');
    await wait(() => !sandbox.window.ChatActions.isBlocked());
    assert.equal(doc.activeLayer.opacity, 100);
    assert.match(elements['chat-action-status'].textContent, /changed/);
    doc.activeLayer = original;
    replySteps = [a('duplicate'), a('rename', 'Copy'), a('opacity', null, 25)];
    send('Duplicate, rename the copy and change its opacity');
    await wait(() => !elements['chat-apply'].disabled);
    const before = histories;
    click('chat-apply');
    await wait(() => !sandbox.window.ChatActions.isBlocked());
    assert.equal(doc.activeLayer.name, 'Copy');
    assert.equal(doc.activeLayer.opacity, 25);
    assert.equal(histories, before + 1);
    assert.equal(posts, 4);
    // Malformed model actions are rejected in the panel too.
    replySteps = [a('delete')];
    send('Unsupported action');
    await wait(() => elements['chat-action-status'].textContent.startsWith('No edit was applied'));
    assert.equal(elements['chat-apply'].disabled, true);
    // Guidance works without any open Photoshop document.
    native.app.documents = [];
    replySteps = [];
    send('How does opacity work?');
    await wait(() => elements.question.value === '');
    assert.equal(received.selection, null);
    assert.equal(elements.messages.children.at(-1).children[1].children.length, 0);
    // The old server must not appear compatible with the new panel.
    protocol = undefined;
    click('reconnect');
    await wait(() => elements.status.textContent === 'Server unavailable');
    assert.equal(elements.send.disabled, true);
    console.log('PASS: native-plan validation, ordered compound edits, single history group, partial failures, real panel HTTP, read-only proposal, Cancel, Apply once, no API on Apply/Cancel, escaped names, stale selection, manual-control locks, guidance without a document, old-server detection.');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
