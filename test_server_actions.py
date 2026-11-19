"""Offline integration tests: no API key and no Gemini requests."""
import copy
import json
import unittest

from google.genai import errors, types
from action_protocol import SCHEMA, SYSTEM, validate_response
from server_actions import create_app


def action(kind, name=None, opacity=None):
    return {"kind": kind, "name": name, "opacity": opacity}


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.result = {"reply": "Ready for review. Nothing applied yet.", "actions": [action("rename", "Shadow")]}
        self.failure = None

        def generate(contents):
            self.calls.append(copy.deepcopy(contents))
            if self.failure:
                raise self.failure
            return json.dumps(self.result)

        self.client = create_app(generate).test_client()
        self.body = {"message": "Rename this layer to Shadow", "selection": {"layer_name": "Light", "opacity": 100}}

    def test_health_and_validation_never_call_model(self):
        self.assertEqual(self.client.get("/health").json["protocol"], "photoshop-actions-v1")
        for body in [None, [], {}, {"message": " "}, {"message": "x" * 4001}, {**self.body, "selection": {"opacity": 50}}]:
            self.assertEqual(self.client.post("/chat", json=body).status_code, 400)
        self.assertEqual(self.client.post("/chat", json=self.body, headers={"Origin": "https://example.com"}).status_code, 403)
        self.assertEqual(self.client.post("/chat", data="x" * 40000, content_type="application/json").status_code, 413)
        self.assertEqual(len(self.calls), 0)

    def test_plan_and_followup_outcome_one_call_each(self):
        result = self.client.post("/chat", json=self.body)
        self.assertEqual(result.json["actions"], self.result["actions"])
        self.assertEqual(len(self.calls), 1)
        self.body["last_action_result"] = "Cancelled. Nothing was applied."
        self.body["message"] = "How does opacity work?"
        self.result = {"reply": "Opacity controls transparency.", "actions": []}
        self.client.post("/chat", json=self.body)
        self.assertEqual(len(self.calls), 2)
        self.assertIn("Cancelled", self.calls[-1][-1]["parts"][0]["text"])
        self.assertEqual(len(self.calls[-1]), 3)

    def test_rejects_bad_plans_entirely(self):
        bad_actions = [action("delete"), action("opacity", opacity=True), action("opacity", opacity=101),
                       action("opacity", opacity="50"), action("rename", ""), action("rename", "bad\nname"),
                       {**action("duplicate"), "script": "evil()"}, action("duplicate", name="unexpected")]
        for bad in bad_actions:
            self.result["actions"] = [action("duplicate"), bad]
            self.assertEqual(self.client.post("/chat", json=self.body).status_code, 502)
        self.result["actions"] = [action("duplicate")] * 4
        self.assertEqual(self.client.post("/chat", json=self.body).status_code, 502)
        self.assertTrue(all(len(call) == 1 for call in self.calls), "Invalid replies must not enter history")

    def test_no_document_allows_teaching_but_not_plan(self):
        self.body["selection"] = None
        self.assertEqual(self.client.post("/chat", json=self.body).json["actions"], [])
        self.result = {"reply": "Layers are stacked image elements.", "actions": []}
        self.assertEqual(self.client.post("/chat", json=self.body).json["reply"], self.result["reply"])

    def test_api_failure_no_retry_or_history(self):
        self.failure = errors.ClientError(429, {"error": {"message": "Quota", "status": "RESOURCE_EXHAUSTED"}})
        self.assertEqual(self.client.post("/chat", json=self.body).status_code, 429)
        self.assertEqual(len(self.calls), 1)
        self.failure = None
        self.client.post("/chat", json=self.body)
        self.assertEqual(len(self.calls[-1]), 1)

    def test_history_bounded(self):
        self.result = {"reply": "Explanation", "actions": []}
        for _ in range(20):
            self.client.post("/chat", json=self.body)
        self.assertEqual(len(self.calls[-1]), 25)  # 12 pairs + this user message

    def test_schema_sdk_and_unicode_names(self):
        cfg = types.GenerateContentConfig(system_instruction=SYSTEM, response_mime_type="application/json",
                                           response_json_schema=SCHEMA, max_output_tokens=2048,
                                           thinking_config=types.ThinkingConfig(thinking_level="minimal"))
        self.assertEqual(cfg.response_json_schema, SCHEMA)
        retry = types.HttpOptions(timeout=30000, retry_options=types.HttpRetryOptions(attempts=1))
        self.assertEqual(retry.retry_options.attempts, 1)
        for name in ['தமிழ் 🌟', '"; app.close(); //', 'Back\\slash\u2028name']:
            self.assertEqual(validate_response({"reply": "Review", "actions": [action("rename", name)]})["actions"][0]["name"], name)
        with self.assertRaises(ValueError):
            validate_response({"reply": "Review", "actions": [action("rename", "🌟" * 128)]})


if __name__ == "__main__":
    unittest.main(verbosity=2)
