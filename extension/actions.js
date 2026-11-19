(function () {
    'use strict';
    var review = document.getElementById('review-duplicate');
    var rename = document.getElementById('review-rename');
    var opacity = document.getElementById('review-opacity');
    var nameInput = document.getElementById('layer-name');
    var opacityInput = document.getElementById('layer-opacity');
    var apply = document.getElementById('apply-duplicate');
    var cancel = document.getElementById('cancel-action');
    var preview = document.getElementById('action-preview');
    var plan = document.getElementById('action-plan');
    var status = document.getElementById('action-status');
    var bridge = window.__adobe_cep__;
    var pending = null;
    var busy = false;
    var locked = false;

    function notice(text, style) {
        status.textContent = text;
        status.className = style || '';
    }

    function controls() {
        review.disabled = busy || locked;
        rename.disabled = busy || locked;
        opacity.disabled = busy || locked;
        nameInput.disabled = busy || locked;
        opacityInput.disabled = busy || locked;
        apply.disabled = busy || locked || !pending;
        cancel.disabled = busy || locked;
    }

    // Fixed function names, validated numbers, and escaped string literals only.
    // Model replies never enter evalScript.
    function callHost(script, callback) {
        try {
            bridge.evalScript(script, function (raw) {
                var result;
                try { result = JSON.parse(raw); }
                catch (_) { callback({ ok: false, error: 'Could not read the Photoshop result. If an edit was requested, check Layers and History before retrying. Verify host.jsx is installed and restart Photoshop.' }); return; }
                if (!result || typeof result.ok !== 'boolean') {
                    callback({ ok: false, error: 'Unexpected Photoshop response. Check Layers and History before retrying.' }); return;
                }
                callback(result);
            });
        } catch (_) {
            callback({ ok: false, error: 'The Photoshop scripting bridge could not complete the call. Check Layers and History before retrying.' });
        }
    }

    function validID(value) {
        return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
    }

    if (!bridge || typeof bridge.evalScript !== 'function') {
        notice('Photoshop scripting is unavailable. Open this extension inside Photoshop.', 'error');
        review.disabled = true;
        rename.disabled = true;
        opacity.disabled = true;
        apply.disabled = true;
        return;
    }

    window.ManualActions = {
        isBusy: function () { return busy; },
        setLocked: function (value) {
            locked = value;
            if (value) { pending = null; preview.hidden = true; }
            controls();
        }
    };

    function clearPreview() {
        pending = null;
        preview.hidden = true;
        controls();
    }

    function reviewAction(kind) {
        if (busy || locked) { return; }
        clearPreview();
        var value;
        if (kind === 'rename') {
            value = nameInput.value.trim();
            if (!value || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) {
                notice('Enter a layer name of 1–255 characters without line breaks or control characters.', 'error');
                return;
            }
        } else if (kind === 'opacity') {
            var raw = opacityInput.value.trim();
            value = Number(raw);
            if (!raw || !isFinite(value) || value < 0 || value > 100) {
                notice('Enter an opacity from 0 to 100.', 'error');
                return;
            }
        }
        busy = true;
        controls();
        notice('Reading the active layer...');
        callHost('PhotoshopAssistant.getSelection()', function (result) {
            busy = false;
            if (!result.ok) {
                notice(result.error || 'Could not read the active layer.', 'error');
            } else if (!validID(result.documentId) || !validID(result.layerId)) {
                notice('Photoshop returned an invalid layer target.', 'error');
            } else {
                pending = { target: result, kind: kind, value: value };
                var targetText = 'active layer "' + result.layerName + '" in "' + result.documentName + '"';
                if (kind === 'duplicate') {
                    plan.textContent = 'Duplicate ' + targetText + '. The new layer will be named "' + result.layerName + ' copy".';
                    apply.textContent = 'Apply duplicate';
                } else if (kind === 'rename') {
                    plan.textContent = 'Rename ' + targetText + ' to "' + value + '".';
                    apply.textContent = 'Apply rename';
                } else {
                    plan.textContent = 'Set opacity of ' + targetText + ' to ' + value + '%.';
                    apply.textContent = 'Apply opacity';
                }
                preview.hidden = false;
                notice('Review the target and value, then click Apply.');
            }
            controls();
        });
    }

    review.addEventListener('click', function () { reviewAction('duplicate'); });
    rename.addEventListener('click', function () { reviewAction('rename'); });
    opacity.addEventListener('click', function () { reviewAction('opacity'); });
    function inputChanged() {
        if (busy || locked || !pending) { return; }
        clearPreview();
        notice('Value changed. Review the action again.');
    }
    nameInput.addEventListener('input', inputChanged);
    opacityInput.addEventListener('input', inputChanged);

    // Escape every UTF-16 code unit, including quotes, backslashes and line separators.
    function stringLiteral(value) {
        var result = '"';
        for (var i = 0; i < value.length; i++) {
            result += '\\u' + ('0000' + value.charCodeAt(i).toString(16)).slice(-4);
        }
        return result + '"';
    }

    cancel.addEventListener('click', function () {
        if (busy || locked) { return; }
        pending = null;
        preview.hidden = true;
        notice('Cancelled. No edit was requested.');
        controls();
    });

    apply.addEventListener('click', function () {
        if (busy || locked || !pending) { return; }
        var action = pending;
        var target = action.target;
        pending = null;
        busy = true;
        controls();
        notice('Applying the reviewed edit...');
        var args = target.documentId + ',' + target.layerId;
        var script;
        if (action.kind === 'duplicate') { script = 'PhotoshopAssistant.duplicateLayer(' + args + ')'; }
        else if (action.kind === 'rename') { script = 'PhotoshopAssistant.renameLayer(' + args + ',' + stringLiteral(action.value) + ')'; }
        else { script = 'PhotoshopAssistant.setOpacity(' + args + ',' + action.value + ')'; }
        callHost(script, function (result) {
            busy = false;
            preview.hidden = true;
            if (result.ok) {
                var message = action.kind === 'duplicate' ? 'Created "' + result.copyName + '".' : result.message;
                notice(message + (result.unchanged ? '' : ' To undo, click back into Photoshop, then use Edit > Undo. Ctrl+Z inside an input only undoes typing.'), 'ok');
            } else {
                notice(result.error || 'Photoshop could not complete the edit.', 'error');
            }
            controls();
        });
    });
    controls();
}());
