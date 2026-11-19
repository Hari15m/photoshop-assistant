# Photoshop Assistant

An AI-powered assistant inside Photoshop that answers learning questions and
turns natural-language editing requests into reviewed layer operations.
Built with Python, Gemini, Adobe CEP and ExtendScript.

**Version 1.4.0 — learning prototype, tested manually on Windows with Photoshop
21.2.2 (2020) and Python 3.13.5.** Other Photoshop versions and macOS have not been
verified. The manifest currently allows Photoshop 21.x only.

## Features

- Answers Photoshop questions with step-by-step guidance.
- Proposes duplicate-layer, rename-layer and opacity changes from chat.
- Supports up to three operations per request, in order.
- Shows the target and exact steps before Apply; Cancel makes no edit.
- Groups a chat edit into one Photoshop history entry for Undo.
- Rechecks the active document/layer, layer name and opacity before execution.
- Keeps optional manual shortcuts for the three operations.
- Uses predefined editing functions; never executes model-generated code.

Examples:

| Message | Expected behavior |
| --- | --- |
| How do I rename a layer? | Explain the steps |
| Rename this layer to Shadow | Propose a rename |
| Set this layer's opacity to 30% | Propose an opacity change |
| Duplicate this layer and set the copy's opacity to 30% | Propose two ordered steps |

After duplication, subsequent steps affect the new copy. Requests cannot select
another named layer, edit all layers, save files, or run arbitrary scripts.
Screenshot analysis and interactive lesson tracking are not implemented.

## Requirements

- Windows and an installed copy of Photoshop 21.2.2.
- Python 3.13 recommended; the developer used 3.13.5.
- Internet access and your own Gemini API key with access to the selected model.
- Node.js is optional for the JavaScript development tests; normal operation
  uses the Node runtime bundled with CEP.

OpenAI, Claude and other providers' keys are not supported by this version.
Model access, quotas and charges depend on your Google project; this project
does not promise unlimited or free API usage.

## Set up from a fresh download

Download/extract or clone this repository. Open PowerShell **inside the folder
containing this README and server_actions.py**.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
```

Replace the key placeholder in `.env` with your own key, then save. Do not share
that file. Keep only the model name after `GEMINI_MODEL=`. The developer's tested
model was `gemini-3.5-flash-lite`; it must be available to your project and support
the structured output and thinking settings used by this server.

If you already have a working `.env`, keep it instead of copying over it.

## Install the Photoshop panel

Save your work and close Photoshop first. From the repository folder:

```powershell
$panelPath = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.photoshopassistant"
New-Item -ItemType Directory -Force -Path $panelPath | Out-Null
Copy-Item -Path ".\extension\*" -Destination $panelPath -Recurse -Force
reg add "HKCU\Software\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f
```

The registry setting enables unsigned CEP 9 extensions for local development.
This project is distributed as an unsigned development extension.

Start the server:

```powershell
.\.venv\Scripts\python.exe server_actions.py
```

Keep the terminal open. The server listens on `127.0.0.1:5000` for one local user.
Do not expose it to the internet or use it as a shared hosted service.

Reopen Photoshop and choose **Window > Extensions > Photoshop Assistant**.
The panel should show **Panel 1.4.0** and **Server connected**.
If upgrading from the older project, stop `server.py` before starting
`server_actions.py`; both use port 5000.

## Try it

1. Open a practice document and select an unlocked layer.
2. Send `Rename this layer to Shadow`.
3. Read the review. The layer should not change yet.
4. Press Apply and check the name in Photoshop's Layers panel.
5. Click back into Photoshop's Layers panel, then choose **Edit > Undo**.

Ctrl+Z while an assistant input is focused undoes typing in that input, not the
Photoshop edit. When testing opacity, read Photoshop's actual Opacity field:
an identical layer underneath can hide the visual effect of transparency.

## Architecture and ML contribution

The CEP panel reads the active layer's state and sends a message to the local
Flask server. The server asks Gemini for a structured reply and action list.
Python and the panel validate that list. The panel builds a review, and only
the user's Apply click invokes predefined ExtendScript functions in Photoshop.

The project applies a **pretrained language model** to request interpretation
and planning. It does not train or fine-tune Gemini. Its implementation includes
application integration, structured output validation, target checks, human
review, conversation context and error handling.

| File | Purpose |
| --- | --- |
| `server_actions.py` | Local HTTP server and Gemini connection |
| `action_protocol.py` | Prompt, response schema and strict validation |
| `extension/panel.js` | Chat UI and local HTTP client |
| `extension/chat-actions.js` | Shared plan review, Apply and Cancel |
| `extension/actions.js` | Optional manual editing shortcuts |
| `extension/host.jsx` | Predefined Photoshop operations |
| `extension/CSXS/manifest.xml` | CEP compatibility and entry points |

## Data and cost behavior

Each sent message makes one Gemini generation attempt, without automatic retries.
Loading the panel, checking connection, Apply, Cancel and manual shortcuts do
not call Gemini. Failed/time-out requests may still count toward provider usage.

Gemini receives the message, active layer name and opacity, last chat-action
result, and up to 12 previous exchanges. No image is sent. Document identifiers
stay local; text you put into messages, layer names or action results is sent as
conversation context. The API key stays in the local Python environment.

The server retains the latest 12 exchanges in memory until restart. The panel's
visible chat clears on reload. There is no persistent chat database. Undo/manual
changes are not automatically added as outcomes; the next message captures the
current layer name and opacity again.

## Validation and known limitations

The developer manually confirmed chat answers, rename, opacity, duplication,
multi-step edits, Cancel, and Undo in Photoshop 21.2.2. These checks are not a
comprehensive accuracy benchmark or a guarantee for every document type.

Offline tests cover HTTP transport, validation, Unicode/code-like layer names,
stale targets, duplicate clicks, API errors, bounded history, cancellation,
compound edits and partial failures. Photoshop is simulated in automated tests;
those tests do not verify native Photoshop behavior or live model accuracy.

With the server stopped (port 5000 free), run:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s . -p "test_server_actions.py" -v
node test-panel.cjs
node test-actions.cjs
node test-chat-actions.cjs
```

These tests need no API key. Offline Python tests were also checked on Python
3.12 with the direct dependency versions in requirements.txt.

The model can misunderstand requests, so review each plan. Unsupported or
ambiguous requests should receive guidance or a clarification. Locked/background
layers may reject operations. If a step fails, earlier changes or part of the
failed step may remain: inspect Layers/History and Undo before trying again.
The snapshot guard does not detect every possible document modification.

Replies display as plain text, so Markdown symbols may remain visible.
Changing the provider requires backend changes, not just a different API key.

## Troubleshooting

- **Server unavailable:** run `server_actions.py`, not an older server, and check
  the connection. Only one process should occupy port 5000.
- **Panel missing / B01:** confirm the installation path, CEP 9 debug setting
  and updated manifest, then completely restart Photoshop.
- **B02:** the Node bridge exists but a required module failed; inspect the
  diagnostic text shown in the panel.
- **Model not found / quota error:** check the selected model and the current
  allowance in your Google project. Repeated Send clicks do not increase quota.
- **Target changed:** select the intended layer and resend the editing request.
- **Unexpected script result:** install all extension files together and restart.
  If Apply was pressed, inspect Layers and History before repeating it.

## Possible future work

Provider adapters, saved conversations, more predefined editing operations,
retrieval from version-specific Photoshop documentation, and a labeled request
evaluation set. These are plans, not current features.

Independent learning project; not affiliated with Adobe or Google.

References: [Google Gen AI SDK](https://googleapis.github.io/python-genai/) and
[Adobe CEP resources](https://github.com/Adobe-CEP/CEP-Resources).
