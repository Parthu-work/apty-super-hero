# WP6. AI configuration and model management

**Status: not started this round.**

Covers: live model lists per provider (fetched with the user's key, cached,
graceful fallback) instead of hardcoded names; a free-text combobox for
every provider's model field; auditing all 15 built-in presets for
OpenAI-compatible-adapter compatibility; an "Add custom model" quick
action for any OpenAI-compatible endpoint; local/private endpoints
(Ollama, LM Studio) behind explicit confirmation; Test connection that
names the specific cause (404/401/429), reports latency/rate-limit
headers, and includes a tool-calling capability probe; multiple
simultaneously-enabled models with per-model Test and rate limits; import/
export of model configs without keys unless opted in.

**Gate:** add/edit/enable/delete regression tests; three providers
configured and switchable; reload persistence; a fresh-profile e2e against
a fake LLM server.
