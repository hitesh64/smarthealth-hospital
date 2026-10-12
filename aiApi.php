<?php
// AI Symptom Checker API (logged-in patients).
// The Gemini API key lives in settings.php / the GEMINI_API_KEY environment variable and is used
// only here, so it never reaches the browser.
//  symptoms : POST symptoms -> {status, html}
include "lib.php";

// keeps an older settings.php (without the key) working
if (!defined('GEMINI_API_KEY')) define('GEMINI_API_KEY', '');

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'symptoms':
        require_user();
        $symptoms = post('symptoms');
        if ($symptoms === '') fail("Please describe your symptoms first!");
        if (mb_strlen($symptoms) > 2000) fail("Please describe your symptoms in under 2000 characters.");
        if (GEMINI_API_KEY === '') fail("The AI Symptom Checker is not set up yet. Please consult a doctor through the 'Find Doctors' tab.", 503);

        // one request every 5 seconds per patient, so the key's quota cannot be used up by one browser
        if (time() - ($_SESSION['ai_last_request'] ?? 0) < 5) fail("Please wait a few seconds before asking again.", 429);
        $_SESSION['ai_last_request'] = time();
        // the AI call takes several seconds: do not hold up the patient's other requests meanwhile
        session_write_close();

        $prompt = "You are a helpful, professional medical AI assistant for an app called SmartHealth. "
            . "A user describes their symptoms: \"$symptoms\".\n"
            . "Please provide a structured, cautious preliminary analysis.\n"
            . "Format your response purely in HTML format (using <h4>, <p>, <ul>, <li>, <strong>) without markdown backticks.\n"
            . "Structure it strictly as:\n"
            . "1. <h4>Preliminary Assessment</h4>\n"
            . "2. <h4>Suggested Immediate Steps (Home Care)</h4>\n"
            . "3. <h4>Recommended Specialist</h4>\n"
            . "Always end with a strong medical disclaimer that they should consult a real doctor.";

        $ch = curl_init("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . GEMINI_API_KEY],
            CURLOPT_POSTFIELDS => json_encode(["contents" => [["parts" => [["text" => $prompt]]]]]),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 60,
        ]);
        $body = curl_exec($ch);
        $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            error_log("Gemini request failed: $error");
            fail("Could not reach the AI server. Please try again in a moment.", 502);
        }
        $data = json_decode($body, true);
        if ($http !== 200) {
            // the full reason goes to the server log only; it can name the key or the project
            error_log("Gemini error $http: " . ($data['error']['message'] ?? substr($body, 0, 300)));
            fail($http === 429 ? "The AI is busy right now. Please try again in a minute." : "The AI server could not answer. Please try again later.", 502);
        }
        $html = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
        if ($html === '') fail("No response generated. The AI might have blocked the input due to safety filters.", 502);

        $html = str_replace(['```html', '```'], '', $html);
        // only the formatting tags asked for are kept, so the answer cannot carry a script into the page
        $html = strip_tags($html, '<h4><p><ul><ol><li><strong><em><b><i><br>');
        $html = preg_replace('/<(\w+)\s[^>]*>/', '<$1>', $html);
        json_out(["status" => "success", "html" => trim($html)]);

    default:
        fail("Unknown action", 404);
}
?>
