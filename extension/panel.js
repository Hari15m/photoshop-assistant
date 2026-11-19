(function () {
    'use strict';
    var status = document.getElementById('status');
    var reconnect = document.getElementById('reconnect');
    var form = document.getElementById('chat-form');
    var question = document.getElementById('question');
    var send = document.getElementById('send');
    var activity = document.getElementById('activity');
    var messages = document.getElementById('messages');
    var http, BufferType;
    var busy = false;
    var connected = false;

    function setStatus(text, style) {
        status.textContent = text;
        status.className = style || '';
    }

    function updateControls() {
        var blocked = window.ChatActions && window.ChatActions.isBlocked();
        send.disabled = busy || blocked || !connected || !question.value.trim();
        question.disabled = busy;
        reconnect.disabled = busy;
    }

    // CEP's bundled Node HTTP client talks only to our local server.
    // No API key, remote script, CORS exception, or generated code is needed.
    function requestJSON(method, path, payload, callback) {
        var body = payload ? JSON.stringify(payload) : '';
        var finished = false;
        var deadline;
        var req;
        function finish(error, data) {
            if (finished) { return; }
            finished = true;
            clearTimeout(deadline);
            callback(error, data);
        }
        try {
            req = http.request({
                hostname: '127.0.0.1', port: 5000, path: path, method: method,
                headers: { 'Content-Type': 'application/json',
                    'Content-Length': BufferType.byteLength(body, 'utf8') }
            }, function (res) {
                var text = '';
                res.setEncoding('utf8');
                res.on('data', function (chunk) {
                    text += chunk;
                    if (text.length > 1000000) {
                        finish(new Error('The server response was too large.'));
                        req.destroy();
                    }
                });
                res.on('error', function () { finish(new Error('The connection was interrupted.')); });
                res.on('aborted', function () { finish(new Error('The connection was interrupted.')); });
                res.on('end', function () {
                    var data;
                    try { data = JSON.parse(text); }
                    catch (_) { finish(new Error('The server returned an unexpected response.')); return; }
                    if (!data || typeof data !== 'object') {
                        finish(new Error('The server returned an unexpected response.')); return;
                    }
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        var detail = typeof data.error === 'string' ? data.error : 'Request failed (' + res.statusCode + ').';
                        finish(new Error(detail)); return;
                    }
                    finish(null, data);
                });
            });
            req.on('error', function () {
                finish(new Error('Cannot reach the Python server. Start server_actions.py, then check the connection.'));
            });
            deadline = setTimeout(function () {
                finish(new Error('Timed out. No automatic retry was sent; the original request may still count toward your quota.'));
                req.destroy();
            }, method === 'GET' ? 5000 : 40000);
            req.end(body);
        } catch (_) {
            finish(new Error('Could not send the request to the local server.'));
        }
    }

    function addMessage(role, text) {
        var welcome = messages.querySelector('.welcome');
        if (welcome) { messages.removeChild(welcome); }
        var box = document.createElement('div');
        box.className = 'message ' + role;
        var speaker = document.createElement('span');
        speaker.className = 'speaker';
        speaker.textContent = role === 'user' ? 'YOU' : role === 'error' ? 'NOTICE' : 'PHOTOSHOP ASSISTANT';
        var content = document.createElement('p');
        // Treat model replies as text, never as HTML or executable JavaScript.
        content.textContent = text;
        box.appendChild(speaker);
        box.appendChild(content);
        messages.appendChild(box);
        messages.scrollTop = messages.scrollHeight;
    }

    function checkConnection() {
        if (busy) { return; }
        busy = true;
        setStatus('Checking connection...');
        updateControls();
        requestJSON('GET', '/health', null, function (error, data) {
            busy = false;
            connected = !error && data.status === 'ok' && data.protocol === 'photoshop-actions-v1';
            setStatus(connected ? 'Server connected' : 'Server unavailable', connected ? 'ok' : 'error');
            activity.textContent = connected ? 'Enter to send · Shift + Enter for a new line' : 'Start server_actions.py (stop the old server first), then click Check connection.';
            updateControls();
        });
    }

    function submit(event) {
        event.preventDefault();
        var text = question.value.trim();
        if (busy || !connected || !text || (window.ChatActions && window.ChatActions.isBlocked())) { return; }
        if (text.length > 4000) { activity.textContent = 'Keep your question under 4,000 characters.'; return; }
        busy = true;
        updateControls();
        addMessage('user', text);
        activity.textContent = 'Waiting for Gemini...';
        if (!window.ChatActions) {
            busy = false;
            activity.textContent = 'Editing bridge missing. Install all 1.4.0 files and restart Photoshop.';
            updateControls();
            return;
        }
        window.ChatActions.begin(function (captureError, target) {
            if (captureError) {
                busy = false;
                activity.textContent = captureError.message;
                updateControls();
                return;
            }
            var payload = { message: text, selection: target ? { layer_name: target.layerName, opacity: target.opacity } : null,
                last_action_result: window.ChatActions.lastResult().slice(0, 2000) };
            requestJSON('POST', '/chat', payload, function (error, data) {
                busy = false;
                window.ChatActions.release();
                if (error) {
                    addMessage('error', error.message);
                    activity.textContent = 'Request failed. Your question is kept below.';
                } else if (data.protocol !== 'photoshop-actions-v1' || typeof data.reply !== 'string'
                    || !data.reply.trim() || !Array.isArray(data.actions)) {
                    addMessage('error', 'The server returned an incompatible reply. Run server_actions.py and check the connection.');
                    activity.textContent = 'No valid reply. Your question is kept below.';
                } else {
                    addMessage('assistant', data.reply);
                    question.value = '';
                    if (data.actions.length) {
                        window.ChatActions.present(data.actions, target);
                        activity.textContent = 'Review the edit above. Apply or Cancel before sending another message.';
                    } else {
                        activity.textContent = 'Enter to send · Shift + Enter for a new line';
                    }
                }
                updateControls();
                if (!window.ChatActions.isBlocked()) { question.focus(); }
            });
        });
    }
    if (window.ChatActions) {
        window.ChatActions.onStateChange = function () {
            if (!busy && !window.ChatActions.isBlocked()) { activity.textContent = 'Enter to send · Shift + Enter for a new line'; }
            updateControls();
        };
    }

    // CEP exposes Node globals differently in separate and mixed contexts.
    // Try each documented entry point, rather than assuming a window property.
    var loaders = [];
    if (typeof cep_node !== 'undefined' && cep_node && typeof cep_node.require === 'function') {
        loaders.push(function (name) { return cep_node.require(name); });
    }
    if (window.cep_node && typeof window.cep_node.require === 'function') {
        loaders.push(function (name) { return window.cep_node.require(name); });
    }
    if (typeof require === 'function') {
        loaders.push(function (name) { return require(name); });
    }
    if (typeof window.require === 'function') {
        loaders.push(function (name) { return window.require(name); });
    }
    var bridgeReady = false;
    var bridgeError = '';
    for (var i = 0; i < loaders.length; i++) {
        try {
            http = loaders[i]('http');
            BufferType = loaders[i]('buffer').Buffer;
            if (!http || typeof http.request !== 'function' || !BufferType || typeof BufferType.byteLength !== 'function') {
                throw new Error('Required HTTP modules are incomplete.');
            }
            bridgeReady = true;
            break;
        } catch (error) {
            bridgeError = error && error.message ? String(error.message).slice(0, 180) : 'Module loading failed.';
        }
    }
    if (!bridgeReady) {
        setStatus('Connection bridge unavailable (1.4.0)', 'error');
        activity.textContent = loaders.length === 0
            ? 'B01: No Node bridge detected. Confirm the updated manifest was installed and fully restart Photoshop.'
            : 'B02: Node bridge found, but modules failed: ' + bridgeError;
        reconnect.disabled = true;
        question.disabled = true;
        return;
    }
    form.addEventListener('submit', submit);
    question.addEventListener('input', updateControls);
    question.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
            submit(event);
        }
    });
    reconnect.addEventListener('click', checkConnection);
    checkConnection();
}());
