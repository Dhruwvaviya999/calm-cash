# ADR 0004: Local-first AI through Ollama, no hosted fallback

Status: accepted (documented in Phase 12; decided in the phase that introduced it).

## Decision

AI features call a model served by Ollama on loopback or a private network. There is no hosted AI
provider and no automatic fallback. On Vercel `AI_ENABLED=false`.

## Why

- Financial records stay on infrastructure the operator controls.
- The model only chooses read-only tools and words answers; every figure comes from CalmCash's
  services, so a small local model is sufficient and errors cannot change money.

## Trade-offs

- Serverless hosting cannot run the model; AI is off there and the rest of the app must (and does)
  work without it.
- Answer latency depends on the operator's hardware (25–90 s on a CPU-only development machine).
