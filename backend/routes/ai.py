"""AI Symptom Checker (logged-in patients). The Gemini key is used only here and never reaches the browser."""
import re

import requests
from flask import Blueprint

from .. import config
from ..utils import arg, fail, ok, post, require_user, too_soon

bp = Blueprint("ai", __name__)

ALLOWED_TAGS = {"h4", "p", "ul", "ol", "li", "strong", "em", "b", "i", "br"}


def clean_html(html):
    """Keeps only the formatting tags asked for, without attributes, so the answer cannot carry a script."""
    html = html.replace("```html", "").replace("```", "")
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S | re.I)

    def tag(m):
        closing, name = m.group(1), m.group(2).lower()
        return f"<{closing}{name}>" if name in ALLOWED_TAGS else ""
    return re.sub(r"<(/?)([a-zA-Z0-9]+)[^>]*>", tag, html).strip()


@bp.route("/api/ai", methods=["POST"])
def ai_api():
    if arg("action") != "symptoms":
        fail("Unknown action", 404)
    require_user()
    symptoms = post("symptoms")
    if not symptoms:
        fail("Please describe your symptoms first!")
    if len(symptoms) > 2000:
        fail("Please describe your symptoms in under 2000 characters.")
    if not config.GEMINI_API_KEY:
        fail("The AI Symptom Checker is not set up yet. Please consult a doctor through the 'Find Doctors' tab.", 503)
    # one request every 5 seconds per patient, so the key's quota cannot be used up by one browser
    if too_soon("ai", 5):
        fail("Please wait a few seconds before asking again.", 429)

    prompt = ("You are a helpful, professional medical AI assistant for an app called SmartHealth. "
              f"A user describes their symptoms: \"{symptoms}\".\n"
              "Please provide a structured, cautious preliminary analysis.\n"
              "Format your response purely in HTML format (using <h4>, <p>, <ul>, <li>, <strong>) without markdown backticks.\n"
              "Structure it strictly as:\n"
              "1. <h4>Preliminary Assessment</h4>\n"
              "2. <h4>Suggested Immediate Steps (Home Care)</h4>\n"
              "3. <h4>Recommended Specialist</h4>\n"
              "4. <h4>Lab Tests That May Help</h4> (common tests a doctor may order, e.g. CBC, blood sugar)\n"
              "Always end with a strong medical disclaimer that they should consult a real doctor.")
    try:
        res = requests.post("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
                            headers={"Content-Type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY},
                            json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=(10, 60))
    except requests.RequestException as exc:
        print(f"[ai] Gemini request failed: {exc}")
        fail("Could not reach the AI server. Please try again in a moment.", 502)
    try:
        data = res.json()
    except ValueError:
        data = {}
    if res.status_code != 200:
        # the full reason goes to the server log only; it can name the key or the project
        print(f"[ai] Gemini error {res.status_code}: {(data.get('error') or {}).get('message', res.text[:300])}")
        fail("The AI is busy right now. Please try again in a minute." if res.status_code == 429
             else "The AI server could not answer. Please try again later.", 502)
    try:
        html = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        html = ""
    if not html:
        fail("No response generated. The AI might have blocked the input due to safety filters.", 502)
    return ok(html=clean_html(html))
