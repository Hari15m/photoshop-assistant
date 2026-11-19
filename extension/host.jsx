// Photoshop ExtendScript (ES3). Loaded by the CEP manifest.
// These predefined functions are independent of Gemini-generated text.
var PhotoshopAssistant = (function () {
    var api = {};
    var lastResult = null;
    var pendingValue = null;
    var pendingSteps = null;

    function quote(value) {
        return '"' + String(value).replace(/[\u0000-\u001f\\"]/g, function (character) {
            var hex = character.charCodeAt(0).toString(16);
            return '\\u' + ('0000' + hex).slice(-4);
        }) + '"';
    }

    // Avoid relying on JSON.stringify, which older ExtendScript lacks.
    function encode(result) {
        var fields = [];
        for (var key in result) {
            if (result.hasOwnProperty(key)) {
                var value = result[key];
                var encoded = typeof value === 'boolean' ? String(value)
                    : typeof value === 'number' && isFinite(value) ? String(value)
                    : quote(value);
                fields.push(quote(key) + ':' + encoded);
            }
        }
        return '{' + fields.join(',') + '}';
    }

    function currentID(kind, property) {
        var reference = new ActionReference();
        reference.putProperty(charIDToTypeID('Prpr'), stringIDToTypeID(property));
        reference.putEnumerated(stringIDToTypeID(kind), stringIDToTypeID('ordinal'), stringIDToTypeID('targetEnum'));
        return executeActionGet(reference).getInteger(stringIDToTypeID(property));
    }

    function snapshot() {
        if (!app.documents.length) {
            throw new Error('Open a document and select one layer first.');
        }
        var document = app.activeDocument;
        var layer = document.activeLayer;
        if (!layer) { throw new Error('Select one layer first.'); }
        return {
            ok: true,
            documentId: currentID('document', 'documentID'),
            layerId: currentID('layer', 'layerID'),
            documentName: document.name,
            layerName: layer.name,
            opacity: layer.opacity
        };
    }

    api.getSelection = function () {
        try { return encode(snapshot()); }
        catch (error) { return encode({ ok: false, error: String(error.message || error) }); }
    };

    // Called only by the fixed suspendHistory command below.
    api._duplicateSelected = function () {
        try {
            var document = app.activeDocument;
            var source = document.activeLayer;
            var copy = source.duplicate();
            copy.name = source.name + ' copy';
            document.activeLayer = copy;
            lastResult = { ok: true, copyName: copy.name };
        } catch (error) {
            lastResult = { ok: false, error: 'Photoshop could not complete the duplicate: ' + String(error.message || error) + ' Check the Layers and History panels before trying again.' };
        }
    };

    api.duplicateLayer = function (documentId, layerId) {
        try {
            if (typeof documentId !== 'number' || typeof layerId !== 'number'
                || !isFinite(documentId) || !isFinite(layerId)
                || documentId !== Math.floor(documentId) || layerId !== Math.floor(layerId)) {
                throw new Error('Invalid layer target. Review the action again.');
            }
            var selected = snapshot();
            if (selected.documentId !== documentId || selected.layerId !== layerId) {
                throw new Error('The active document or layer changed. Review the action again. No duplicate was made.');
            }
            lastResult = null;
            app.activeDocument.suspendHistory(
                'Photoshop Assistant: Duplicate layer',
                'PhotoshopAssistant._duplicateSelected()'
            );
            return encode(lastResult || { ok: false, error: 'No completion result. Check the Layers and History panels before trying again.' });
        } catch (error) {
            return encode({ ok: false, error: String(error.message || error) });
        }
    };

    function checkedTarget(documentId, layerId) {
        if (typeof documentId !== 'number' || typeof layerId !== 'number'
            || !isFinite(documentId) || !isFinite(layerId)
            || documentId !== Math.floor(documentId) || layerId !== Math.floor(layerId)) {
            throw new Error('Invalid layer target. Review the action again.');
        }
        var selected = snapshot();
        if (selected.documentId !== documentId || selected.layerId !== layerId) {
            throw new Error('The active document or layer changed. Review the action again. No edit was made.');
        }
        return app.activeDocument.activeLayer;
    }

    api._renameSelected = function () {
        try {
            app.activeDocument.activeLayer.name = pendingValue;
            lastResult = { ok: true, message: 'Renamed layer to "' + app.activeDocument.activeLayer.name + '".' };
        } catch (error) {
            lastResult = { ok: false, error: String(error.message || error) + ' Check Layers and History before trying again.' };
        }
    };

    api._setOpacity = function () {
        try {
            app.activeDocument.activeLayer.opacity = pendingValue;
            lastResult = { ok: true, message: 'Layer opacity is now ' + Math.round(app.activeDocument.activeLayer.opacity) + '%.' };
        } catch (error) {
            lastResult = { ok: false, error: String(error.message || error) + ' Check Layers and History before trying again.' };
        }
    };

    api.renameLayer = function (documentId, layerId, name) {
        try {
            var layer = checkedTarget(documentId, layerId);
            if (typeof name !== 'string' || !/\S/.test(name) || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) {
                throw new Error('Enter a layer name of 1–255 characters without line breaks or control characters.');
            }
            if (layer.name === name) { return encode({ ok: true, unchanged: true, message: 'The layer already has that name. No change was made.' }); }
            pendingValue = name;
            lastResult = null;
            app.activeDocument.suspendHistory('Photoshop Assistant: Rename layer', 'PhotoshopAssistant._renameSelected()');
            pendingValue = null;
            return encode(lastResult || { ok: false, error: 'No completion result. Check Layers and History before trying again.' });
        } catch (error) {
            pendingValue = null;
            return encode({ ok: false, error: String(error.message || error) });
        }
    };

    api.setOpacity = function (documentId, layerId, opacity) {
        try {
            var layer = checkedTarget(documentId, layerId);
            if (typeof opacity !== 'number' || !isFinite(opacity) || opacity < 0 || opacity > 100) {
                throw new Error('Opacity must be a number from 0 to 100.');
            }
            if (layer.opacity === opacity) { return encode({ ok: true, unchanged: true, message: 'The layer already has that opacity. No change was made.' }); }
            pendingValue = opacity;
            lastResult = null;
            app.activeDocument.suspendHistory('Photoshop Assistant: Change opacity', 'PhotoshopAssistant._setOpacity()');
            pendingValue = null;
            return encode(lastResult || { ok: false, error: 'No completion result. Check Layers and History before trying again.' });
        } catch (error) {
            pendingValue = null;
            return encode({ ok: false, error: String(error.message || error) });
        }
    };
    function validSteps(steps) {
        if (Object.prototype.toString.call(steps) !== '[object Array]' || !steps.length || steps.length > 3) {
            throw new Error('Invalid action list. Nothing was applied.');
        }
        for (var i = 0; i < steps.length; i++) {
            var step = steps[i];
            if (!step || typeof step !== 'object') { throw new Error('Invalid action.'); }
            var count = 0;
            for (var key in step) {
                if (step.hasOwnProperty(key)) {
                    if (key !== 'kind' && key !== 'name' && key !== 'opacity') { throw new Error('Unknown action field.'); }
                    count++;
                }
            }
            if (count !== 3) { throw new Error('Incomplete action.'); }
            if (step.kind === 'duplicate' && step.name === null && step.opacity === null) { continue; }
            if (step.kind === 'rename' && typeof step.name === 'string' && /\S/.test(step.name)
                && step.name.length <= 255 && !/[\u0000-\u001f\u007f]/.test(step.name) && step.opacity === null) { continue; }
            if (step.kind === 'opacity' && step.name === null && typeof step.opacity === 'number'
                && isFinite(step.opacity) && step.opacity >= 0 && step.opacity <= 100) { continue; }
            throw new Error('Unsupported action or invalid value. Nothing was applied.');
        }
    }

    api._applyReviewedSteps = function () {
        var completed = 0;
        try {
            var document = app.activeDocument;
            for (var i = 0; i < pendingSteps.length; i++) {
                var step = pendingSteps[i];
                var layer = document.activeLayer;
                if (step.kind === 'duplicate') {
                    var copy = layer.duplicate();
                    copy.name = layer.name + ' copy';
                    document.activeLayer = copy;
                } else if (step.kind === 'rename') {
                    layer.name = step.name;
                } else if (step.kind === 'opacity') {
                    layer.opacity = step.opacity;
                }
                completed++;
            }
            lastResult = { ok: true, completed: completed, message: 'Applied ' + completed + ' action(s). Active layer: "'
                + document.activeLayer.name + '", opacity ' + Math.round(document.activeLayer.opacity) + '%.' };
        } catch (error) {
            lastResult = { ok: false, completed: completed, error: 'Stopped after ' + completed + ' completed action(s): '
                + String(error.message || error) + ' Some changes may remain, including part of the failed step. Check Layers and History; use Photoshop Edit > Undo if needed. Do not apply again blindly.' };
        }
    };

    api.applyPlan = function (documentId, layerId, expectedName, expectedOpacity, steps) {
        try {
            validSteps(steps); // Validate every step before the first mutation.
            var layer = checkedTarget(documentId, layerId);
            if (typeof expectedName !== 'string' || typeof expectedOpacity !== 'number' || !isFinite(expectedOpacity)
                || layer.name !== expectedName || Math.abs(layer.opacity - expectedOpacity) > 0.0001) {
                throw new Error('The layer name or opacity changed since your request. Send the request again to review its current state. Nothing was applied.');
            }
            var changes = false;
            for (var i = 0; i < steps.length; i++) {
                if (steps[i].kind === 'duplicate'
                    || (steps[i].kind === 'rename' && steps[i].name !== layer.name)
                    || (steps[i].kind === 'opacity' && Math.abs(steps[i].opacity - layer.opacity) > 0.0001)) { changes = true; }
            }
            if (!changes) { return encode({ ok: true, unchanged: true, message: 'The layer already has those values. No change was made.' }); }
            pendingSteps = steps;
            lastResult = null;
            app.activeDocument.suspendHistory('Photoshop Assistant: Chat edit', 'PhotoshopAssistant._applyReviewedSteps()');
            pendingSteps = null;
            return encode(lastResult || { ok: false, error: 'No completion result. Check Layers and History before trying again.' });
        } catch (error) {
            pendingSteps = null;
            return encode({ ok: false, error: String(error.message || error) });
        }
    };
    return api;
}());
