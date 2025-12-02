Agent Development Guidelines (General)

These principles are broadly applicable across projects and help avoid fragile integrations, reduce noise, and improve reliability.

1) Stream and protocol hygiene
- Only emit messages defined by the protocol on the data channel. Keep control-plane messages (internal syncs, diagnostics) off the data stream.
- Prefer NDJSON or line-delimited framing for streams. Never interleave non-protocol text with protocol JSON.
- Use heartbeats/keepalives with a simple, documented format and interval.
- Treat request end and socket close separately; keep streams open as intended and clean up on close.

2) Structured logging and verbosity
- Default to minimal, high-signal logs (start/done, error summaries). Make verbose traces opt-in via env flags.
- Redact secrets in logs (auth headers, tokens). Avoid dumping raw request bodies unless necessary.
- Use stable, structured fields to aid correlation (ids, timings, counts).

3) Robust event handling
- Be liberal in what you accept: tolerate extra fields and minor schema variations; detect intent (e.g., callback/tool) by multiple cues when reasonable.
- Always correlate tool execution with an id when present; return either { id, result } or { id, error }.
- Avoid top-level fields that could collide with protocol semantics (e.g., do not emit arbitrary top-level "error" objects on shared channels).

4) Background work and concurrency
- Run background jobs (syncs, refreshers) without blocking the main event loop or stream handling.
- Prevent overlapping runs of the same job; use lightweight locks/flags.
- Keep background activity from emitting on client-facing streams unless explicitly part of the protocol.

5) Configuration defaults
- Choose safe, non-intrusive defaults. Use 0/empty values to disable optional behaviors by default.
- Gate optional or noisy features behind explicit env flags.
- Validate required configuration early and fail with clear messages.

6) Error handling
- Distinguish between user-facing errors and internal errors; include actionable messages without leaking sensitive data.
- Prefer structured error payloads with a stable shape and codes over free-form text.
- Handle expected errors (e.g., missing files) gracefully and document when they are normal.

7) Filesystem and command execution
- Always resolve paths within an allowed root to avoid escapes.
- Enforce size/time limits on I/O and subprocesses.
- Normalize line endings and encodings where applicable; document assumptions.

8) Resource lifecycle and shutdown
- Make teardown idempotent; clear intervals/timeouts/listeners on close.
- Add graceful shutdown hooks to flush critical work within a bounded time.
- Prefer fire-and-forget finalization over blocking shutdown when time-limited.

9) Observability and diagnostics
- Include cheap counters/timings (e.g., items processed, bytes) in start/done logs.
- Provide a health endpoint for liveness/readiness.
- Keep correlation ids consistent across logs, responses, and metrics.

10) Security posture
- Make authentication/authorization explicit and optional by configuration; fail closed when enabled.
- Scope credentials narrowly (least privilege) and never log raw secrets.

11) Protocol vs. application failures
- Separate transport/delivery from business outcome. Acknowledge and advance cursors/offsets based on delivery/completion, not only on success.
- Treat tool/handler errors as valid outcomes: return { id, error } (or { id, result }) rather than surfacing them as transport failures.
- Reserve retries/rejections for transport/runtime faults (timeouts, connection loss, framing errors), not expected tool errors (e.g., ENOENT, nonzero exit).
- Callbacks should carry structured fields (e.g., result and error) and remain backward-compatible; when necessary, wrap payloads or version schemas.
- Log at high-signal points (send/receive/commit) and keep retry policy explicit and bounded for transport faults.

These guidelines are intended to remain stable; refine cautiously and keep examples generic rather than project-specific.