// Uses a simulated Photoshop DOM; native Photoshop verification is still needed.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const hostSource = fs.readFileSync(path.join(__dirname, 'extension/host.jsx'), 'utf8');
let copies = 0;
let histories = 0;
let context;
let nextId = 100;
function layer(name, id) {
  return { name, id, opacity: 100, duplicate() { copies++; return layer(this.name, nextId++); } };
}
const original = layer('Blue "mug" \\ test\nதமிழ்', 7);
const doc = { id: 3, name: 'Practice "one".psd', activeLayer: original,
  suspendHistory(label, script) {
    histories++;
    const allowed = { 'Photoshop Assistant: Duplicate layer': 'PhotoshopAssistant._duplicateSelected()', 'Photoshop Assistant: Rename layer': 'PhotoshopAssistant._renameSelected()', 'Photoshop Assistant: Change opacity': 'PhotoshopAssistant._setOpacity()' };
    assert.equal(script, allowed[label]);
    vm.runInContext(script, context);
  }
};
function ActionReference() {}
ActionReference.prototype.putProperty = function (_, property) { this.property = property; };
ActionReference.prototype.putEnumerated = function (kind) { this.kind = kind; };
context = vm.createContext({
  app: { documents: [], activeDocument: doc }, ActionReference,
  charIDToTypeID: value => value, stringIDToTypeID: value => value,
  executeActionGet: reference => ({ getInteger: property => {
    assert.equal(reference.property, property);
    return reference.kind === 'document' ? context.app.activeDocument.id : context.app.activeDocument.activeLayer.id;
  } })
});
vm.runInContext(hostSource, context);
const host = context.PhotoshopAssistant;
assert.equal(JSON.parse(host.getSelection()).ok, false);
context.app.documents = [doc];
const snapshot = JSON.parse(host.getSelection());
assert.equal(snapshot.layerName, original.name);
assert.equal(snapshot.documentName, doc.name);
assert.equal(copies, 0, 'Review must not edit');
assert.equal(JSON.parse(host.duplicateLayer('3', 7)).ok, false);
assert.equal(JSON.parse(host.duplicateLayer(99, 7)).ok, false);
assert.equal(JSON.parse(host.duplicateLayer(3, 99)).ok, false);
assert.equal(copies, 0, 'Invalid or stale target must not edit');
const result = JSON.parse(host.duplicateLayer(3, 7));
assert.equal(result.ok, true);
assert.equal(result.copyName, original.name + ' copy');
assert.equal(doc.activeLayer.name, result.copyName);
assert.equal(original.name, snapshot.layerName);
assert.equal(copies, 1);
assert.equal(histories, 1);
assert.equal(JSON.parse(host.duplicateLayer(3, 7)).ok, false, 'Old target must be rejected after active layer changes');
doc.activeLayer = { id: 8, name: 'Failure', duplicate() { throw new Error('Simulated Photoshop failure'); } };
assert.match(JSON.parse(host.duplicateLayer(3, 8)).error, /Check the Layers and History/);

class Element {
  constructor() { this.textContent = ''; this.value = ''; this.hidden = true; this.disabled = false; this.events = {}; }
  addEventListener(name, callback) { this.events[name] = callback; }
}
const elements = Object.fromEntries(['review-duplicate', 'apply-duplicate', 'cancel-action', 'action-preview', 'action-plan', 'action-status', 'review-rename', 'review-opacity', 'layer-name', 'layer-opacity'].map(id => [id, new Element()]));
const document = { getElementById: id => elements[id] };
let queued = [];
let scripts = [];
const bridge = { evalScript(script, callback) {
  scripts.push(script);
  queued.push(() => callback(vm.runInContext(script, context)));
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'extension/actions.js'), 'utf8'), { document, window: { __adobe_cep__: bridge } });
const click = id => elements[id].events.click();
doc.activeLayer = original;
click('review-duplicate'); click('review-duplicate');
assert.equal(queued.length, 1, 'Duplicate review click is ignored');
queued.shift()();
assert.equal(elements['action-preview'].hidden, false);
assert.ok(elements['action-plan'].textContent.includes(original.name));
click('cancel-action');
assert.equal(elements['action-preview'].hidden, true);
assert.equal(copies, 1, 'Cancel must not edit');
click('apply-duplicate');
assert.equal(queued.length, 0, 'No pending plan must not apply');
click('review-duplicate'); queued.shift()();
doc.activeLayer = layer('Changed', 9);
click('apply-duplicate'); queued.shift()();
assert.match(elements['action-status'].textContent, /changed/);
assert.equal(copies, 1);
doc.activeLayer = original;
click('review-duplicate'); queued.shift()();
click('apply-duplicate'); click('apply-duplicate');
assert.equal(queued.length, 1, 'Repeated apply must not duplicate execution');
queued.shift()();
assert.equal(copies, 2);
assert.match(elements['action-status'].textContent, /Created/);
assert.ok(scripts.every(script => /^PhotoshopAssistant\.(getSelection\(\)|duplicateLayer\(\d+,\d+\))$/.test(script)), 'Only allowlisted script strings and numeric IDs are dispatched');
console.log('PASS (duplicate regression): no document, escaped names, read-only review, stale and invalid IDs, original preservation, one history group, failure reporting, cancel, duplicate-click prevention, fixed script dispatch.');

// New operations: validation, no-op history, stale targets and literal names.
doc.activeLayer = original;
original.name = 'Practice';
const unusual = 'Layer \"; app.activeDocument.close(); // \\ தமிழ் 🌟' + String.fromCharCode(0x2028);
let before = histories;
for (const bad of ['', '   ', 'bad\nname', 'x'.repeat(256), null]) {
  assert.equal(JSON.parse(host.renameLayer(3, 7, bad)).ok, false);
}
for (const bad of [-1, 101, NaN, Infinity, '50', null]) {
  assert.equal(JSON.parse(host.setOpacity(3, 7, bad)).ok, false);
}
assert.equal(JSON.parse(host.renameLayer(99, 7, 'New')).ok, false);
assert.equal(JSON.parse(host.setOpacity(3, 99, 50)).ok, false);
assert.equal(histories, before, 'Invalid actions must not enter history');
assert.equal(JSON.parse(host.renameLayer(3, 7, original.name)).unchanged, true);
assert.equal(JSON.parse(host.setOpacity(3, 7, 100)).unchanged, true);
assert.equal(histories, before, 'No-op actions must not enter history');
assert.equal(JSON.parse(host.renameLayer(3, 7, unusual)).ok, true);
assert.equal(original.name, unusual);
assert.equal(histories, ++before);
for (const value of [0, 100, 37.5]) {
  assert.equal(JSON.parse(host.setOpacity(3, 7, value)).ok, true);
  assert.equal(original.opacity, value);
  assert.equal(histories, ++before);
}
const scriptsBefore = scripts.length;
elements['layer-opacity'].value = '';
click('review-opacity');
assert.equal(scripts.length, scriptsBefore);
elements['layer-opacity'].value = '101';
click('review-opacity');
assert.equal(scripts.length, scriptsBefore);
elements['layer-name'].value = '   ';
click('review-rename');
assert.equal(scripts.length, scriptsBefore);
elements['layer-name'].value = unusual + ' renamed';
click('review-rename'); queued.shift()();
assert.equal(original.name, unusual, 'Review is read-only');
click('apply-duplicate'); click('apply-duplicate');
assert.equal(queued.length, 1);
queued.shift()();
assert.equal(original.name, unusual + ' renamed');
assert.match(scripts.at(-1), /^PhotoshopAssistant\.renameLayer\(3,7,"(?:\\u[0-9a-f]{4})+"\)$/);
assert.match(elements['action-status'].textContent, /Renamed/);
elements['layer-opacity'].value = '50';
click('review-opacity'); queued.shift()();
elements['layer-opacity'].value = '25';
elements['layer-opacity'].events.input();
click('apply-duplicate');
assert.equal(queued.length, 0, 'Edited input invalidates preview');
click('review-opacity'); queued.shift()();
doc.activeLayer = layer('Switched', 99);
click('apply-duplicate'); queued.shift()();
assert.equal(doc.activeLayer.opacity, 100);
assert.match(elements['action-status'].textContent, /changed/);
doc.activeLayer = original;
click('review-opacity'); queued.shift()();
click('apply-duplicate'); click('apply-duplicate');
assert.equal(queued.length, 1);
queued.shift()();
assert.equal(original.opacity, 25);
assert.match(elements['action-status'].textContent, /25%/);
assert.equal(copies, 2, 'New controls must not duplicate layers');
// A Photoshop setter failure must be reported, with no claim of success.
doc.activeLayer = { id: 20, get name() { return 'Locked'; }, set name(_) { throw Error('Read-only'); }, get opacity() { return 100; }, set opacity(_) { throw Error('Read-only'); } };
assert.equal(JSON.parse(host.renameLayer(3, 20, 'Other')).ok, false);
assert.equal(JSON.parse(host.setOpacity(3, 20, 50)).ok, false);
context.app.documents = [];
assert.equal(JSON.parse(host.renameLayer(3, 20, 'Other')).ok, false);
assert.equal(JSON.parse(host.setOpacity(3, 20, 50)).ok, false);
console.log('PASS: rename/opacity validation, bounds, Unicode/code-like names, no-op history, one history per edit, stale targets, preview invalidation, repeat clicks, read-only errors, no document.');
