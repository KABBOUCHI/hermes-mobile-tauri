# Tauri Plugin: Share Intent

Android bridge for inbound `ACTION_SEND` and `ACTION_SEND_MULTIPLE` intents.
It passes a bounded pending draft to the Vue composer through the plugin commands
`pending_share` and `clear_pending_share`.
