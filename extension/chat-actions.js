(function () {
    'use strict';
    var box = document.getElementById('chat-review');
    var planText = document.getElementById('chat-plan');
    var apply = document.getElementById('chat-apply');
    var cancel = document.getElementById('chat-cancel');
    var status = document.getElementById('chat-action-status');
    var bridge = window.__adobe_cep__;
    var pending = null;
    var busy = false;
    var outcome = 'No chat edit has been applied in this panel session.';
    var api = {};

    function update() {
        apply.disabled = busy || !pending;
        cancel.disabled = busy || !pending;
        if (window.ManualActions) { window.ManualActions.setLocked(busy || !!pending); }
        if (api.onStateChange) { api.onStateChange(); }
    }
    function message(text, error) {
        status.textContent = text;
        status.className = error ? 'error' : 'ok';
    }
    function host(script, callback) {
        var finished = false;
        function done(result) { if (!finished) { finished = true; callback(result); } }
        try {
            bridge.evalScript(script, function (raw) {
                var result;
                try { result = JSON.parse(raw); } catch (_) { result = null; }
                if (!result || typeof result.ok !== 'boolean') {
                    done({ ok: false, error: 'Could not read the Photoshop result. If Apply was pressed, inspect Layers and History before trying again.' });
                } else { done(result); }
            });
        } catch (_) { done({ ok: false, error: 'Photoshop scripting is unavailable. Check Layers and History if an edit was requested.' }); }
    }
    function id(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value; }
    function percent(value) { return typeof value === 'number' && isFinite(value) && value >= 0 && value <= 100; }
    function targetOK(target) {
        return target && target.ok && id(target.documentId) && id(target.layerId)
            && typeof target.layerName === 'string' && typeof target.documentName === 'string' && percent(target.opacity);
    }
    function validSteps(steps) {
        if (!Array.isArray(steps) || !steps.length || steps.length > 3) { return false; }
        return steps.every(function (step) {
            if (!step || typeof step !== 'object' || Object.keys(step).sort().join(',') !== 'kind,name,opacity') { return false; }
            if (step.kind === 'duplicate') { return step.name === null && step.opacity === null; }
            if (step.kind === 'rename') {
                return typeof step.name === 'string' && !!step.name.trim() && step.name.length <= 255
                    && !/[\u0000-\u001f\u007f]/.test(step.name) && step.opacity === null;
            }
            return step.kind === 'opacity' && step.name === null && percent(step.opacity);
        });
    }
    // All strings become Unicode-escaped literals; never concatenate raw model text.
    function literal(value) {
        if (value === null) { return 'null'; }
        if (typeof value === 'number') { return String(value); }
        var result = '"';
        for (var i = 0; i < value.length; i++) { result += '\\u' + ('0000' + value.charCodeAt(i).toString(16)).slice(-4); }
        return result + '"';
    }
    function stepsLiteral(steps) {
        return '[' + steps.map(function (step) {
            return '{kind:' + literal(step.kind) + ',name:' + literal(step.name) + ',opacity:' + literal(step.opacity) + '}';
        }).join(',') + ']';
    }

    api.isBlocked = function () { return busy || !!pending || (window.ManualActions && window.ManualActions.isBusy()); };
    api.lastResult = function () { return outcome; };
    api.begin = function (callback) {
        if (api.isBlocked()) { callback(new Error('Finish or cancel the current action first.')); return; }
        box.hidden = true;
        busy = true;
        update();
        host('PhotoshopAssistant.getSelection()', function (result) {
            // Learning questions are allowed when no document is open.
            callback(null, targetOK(result) ? result : null);
        });
    };
    api.release = function () { busy = false; update(); };
    api.present = function (steps, target) {
        busy = false;
        pending = null;
        if (!validSteps(steps) || !targetOK(target)) {
            box.hidden = false;
            planText.textContent = '';
            outcome = 'The proposal was rejected locally. Nothing was applied.';
            message('No edit was applied. Select one layer and resend a supported editing request.', true);
            update();
            return;
        }
        // Copy validated values so later response-object changes cannot alter the plan.
        pending = JSON.parse(JSON.stringify({ target: target, steps: steps }));
        var lines = ['Document: ' + target.documentName, 'Starting layer: ' + target.layerName,
            'Current opacity: ' + Math.round(target.opacity) + '%', ''];
        var name = target.layerName;
        steps.forEach(function (step, index) {
            var text;
            if (step.kind === 'duplicate') { text = 'Duplicate "' + name + '" and select its copy.'; name += ' copy'; }
            else if (step.kind === 'rename') { text = 'Rename "' + name + '" to "' + step.name + '".'; name = step.name; }
            else { text = 'Set "' + name + '" opacity to ' + step.opacity + '%.'; }
            lines.push((index + 1) + '. ' + text);
        });
        planText.textContent = lines.join('\n');
        box.hidden = false;
        outcome = 'An edit was proposed but has not been applied.';
        message('Review the steps. Nothing changes until you press Apply.');
        update();
    };

    cancel.addEventListener('click', function () {
        if (busy || !pending) { return; }
        pending = null;
        outcome = 'The user cancelled the proposed chat edit. Nothing was applied.';
        message('Cancelled. No edit was made.');
        update();
    });
    apply.addEventListener('click', function () {
        if (busy || !pending) { return; }
        var chosen = pending;
        pending = null; // Consume once, before calling Photoshop.
        busy = true;
        update();
        message('Applying the reviewed steps...');
        var target = chosen.target;
        var script = 'PhotoshopAssistant.applyPlan(' + target.documentId + ',' + target.layerId + ','
            + literal(target.layerName) + ',' + target.opacity + ',' + stepsLiteral(chosen.steps) + ')';
        host(script, function (result) {
            busy = false;
            outcome = result.ok ? result.message : (result.error || 'Photoshop did not confirm success. Check Layers and History.');
            message(outcome + (result.ok && !result.unchanged ? ' To undo, click Photoshop’s Layers panel, then use Edit > Undo.' : ''), !result.ok);
            update();
        });
    });
    window.ChatActions = api;
    update();
}());
