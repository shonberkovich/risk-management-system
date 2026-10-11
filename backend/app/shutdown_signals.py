"""Lets the app react the moment the server *starts* shutting down.

Why this exists: uvicorn's graceful shutdown (Ctrl+C, and every `--reload` restart —
on Windows the reloader delivers a Ctrl+C to the worker) stops accepting new
connections and then waits, with no timeout by default, for every open connection
to finish its response before the old worker exits and the new one starts. A
`GET /api/sse/stream` response (routers/sse.py) never finishes on its own, so a
single open browser tab used to hold the old worker in "Waiting for connections to
close" forever: every request — login included — hung until the process was killed
by hand. The ASGI lifespan "shutdown" event can't help, because uvicorn only sends
it *after* those connections have closed.

What uvicorn does do is install its own SIGINT/SIGTERM(/SIGBREAK) handlers before
running the lifespan startup. `chain_shutdown_signal_handlers` (called from
main.py's lifespan) wraps whichever handlers are installed at that point, so the
callback runs first and the server's own handler still runs right after it,
unchanged. No uvicorn internals are touched.
"""
from __future__ import annotations

import logging
import signal
import threading
from collections.abc import Callable

logger = logging.getLogger(__name__)

# The signals uvicorn treats as "shut down" (uvicorn.server.HANDLED_SIGNALS).
SHUTDOWN_SIGNALS: tuple[int, ...] = tuple(
    sig for sig in (signal.SIGINT, signal.SIGTERM, getattr(signal, "SIGBREAK", None)) if sig is not None
)


def chain_shutdown_signal_handlers(callback: Callable[[], None]) -> Callable[[], None]:
    """Runs `callback` whenever a shutdown signal arrives, before the handler that was
    installed for it until now. Returns a function that puts the previous handlers back.

    Only signals that already have a Python-level handler (i.e. the server installed
    one) are wrapped: SIG_DFL/SIG_IGN are left alone, since in that case there's no
    graceful shutdown for the callback to run ahead of. A no-op outside the main
    thread, where Python can't install signal handlers at all — e.g. TestClient
    runs the lifespan in a worker thread.

    `callback` runs inside a signal handler, so it should only hand work off (e.g.
    `loop.call_soon_threadsafe(...)`). If it raises, the error is logged and the
    previous handler still runs — a failure here must never block the server's own
    shutdown."""
    if threading.current_thread() is not threading.main_thread():
        return lambda: None

    installed: dict[int, tuple[Callable, object]] = {}
    for sig in SHUTDOWN_SIGNALS:
        previous = signal.getsignal(sig)
        if not callable(previous):
            continue

        def _handler(signum, frame, _previous=previous):
            try:
                callback()
            except Exception:  # noqa: BLE001 — see docstring
                logger.exception("shutdown-signal callback failed")
            _previous(signum, frame)

        signal.signal(sig, _handler)
        installed[sig] = (_handler, previous)

    def restore() -> None:
        for sig, (handler, previous) in installed.items():
            # Leave it alone if something else has replaced our handler since.
            if signal.getsignal(sig) is handler:
                signal.signal(sig, previous)

    return restore
