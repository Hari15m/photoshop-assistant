r"""Run instead of server.py: .\.venv\Scripts\python.exe server_actions.py"""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from google import genai
from google.genai import errors, types

from action_protocol import PROTOCOL, SCHEMA, SYSTEM, validate_request, validate_response


def create_app(generate):
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 32 * 1024
    history = []  # One local user; bounded to the latest 12 exchanges.

    @app.get("/health")
    def health():
        return jsonify(status="ok", protocol=PROTOCOL, message="Photoshop Assistant chat actions server is running")

    @app.post("/chat")
    def chat():
        # The CEP Node client does not send browser Origin headers.
        if request.headers.get("Origin"):
            return jsonify(error="Use the Photoshop panel to send requests."), 403
        try:
            body = validate_request(request.get_json(silent=True))
        except ValueError as error:
            return jsonify(error=str(error)), 400
        user_content = {"role": "user", "parts": [{"text": json.dumps(body, ensure_ascii=True)}]}
        try:
            response = generate(history + [user_content])
            result = validate_response(response)
        except errors.APIError as error:
            if error.code == 429:
                return jsonify(error="Gemini usage limit reached. Wait for your quota to reset; no automatic retry was sent."), 429
            return jsonify(error=f"Gemini request failed (code {error.code}). No edit was made and no automatic retry was sent."), 502
        except (ValueError, TypeError):
            return jsonify(error="Gemini returned an invalid plan. Nothing was applied. Try a simpler request."), 502
        except Exception as error:
            app.logger.warning("Gemini request failed: %s", type(error).__name__)
            return jsonify(error="Could not get a Gemini response. No edit was made. Check the server terminal."), 502
        if result["actions"] and body["selection"] is None:
            result = {"reply": "Open a document and select one layer, then ask for the edit again. Nothing was applied.", "actions": []}
        history.extend([user_content, {"role": "model", "parts": [{"text": json.dumps(result, ensure_ascii=True)}]}])
        del history[:-24]
        return jsonify(**result, protocol=PROTOCOL)

    @app.errorhandler(413)
    def too_large(_):
        return jsonify(error="The request is too large."), 413

    return app


def main():
    load_dotenv(Path(__file__).with_name(".env"), encoding="utf-8-sig")
    key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", "").strip()
    if not key or key == "replace_with_your_key":
        raise SystemExit("API key missing: check your existing .env file.")
    if not model or model.startswith("GEMINI_MODEL="):
        raise SystemExit("Check .env: GEMINI_MODEL must contain only the model name after the equals sign.")
    client = genai.Client(api_key=key, http_options=types.HttpOptions(
        timeout=30000, retry_options=types.HttpRetryOptions(attempts=1)))
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM, response_mime_type="application/json",
        response_json_schema=SCHEMA, max_output_tokens=2048,
        thinking_config=types.ThinkingConfig(thinking_level="minimal"),
    )

    def generate(contents):
        response = client.models.generate_content(model=model, contents=contents, config=config)
        return response.text

    print("Photoshop Assistant 1.4.0 — chat + reviewed actions")
    print("Only this server should run on port 5000. Press Ctrl+C to stop.")
    try:
        create_app(generate).run(host="127.0.0.1", port=5000, debug=False, use_reloader=False, threaded=False)
    finally:
        client.close()


if __name__ == "__main__":
    main()
