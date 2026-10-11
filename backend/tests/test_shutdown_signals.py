"""Tests for app/shutdown_signals.py and its wiring in main.py's lifespan: the hook
that ends every open SSE stream as soon as the server starts shutting down. Without
it uvicorn's graceful shutdown waited on those endless streams forever, so Ctrl+C
and every `--reload` left the dev server hanging (login included) with a tab open.

Handlers are called directly rather than by raising real signals, and every test
puts the process's original SIGTERM handler back.
"""
from __future__ import annotations

import asyncio
import logging
import signal
import threading

import pytest

from app.services import sse_manager
from app.services.sse_manager import CLOSE_STREAM, ConnectionManager
from app.shutdown_signals import chain_shutdown_signal_handlers


@pytest.fixture
def events():
    """Stands in for the server's own SIGTERM handler (what uvicorn installs before
    the lifespan starts); every call is recorded in the yielded list."""
    calls: list = []

    def server_handler(signum, frame):
        calls.append(("server", signum))

    original = signal.signal(signal.SIGTERM, server_handler)
    try:
        yield calls
    finally:
        signal.signal(signal.SIGTERM, original)


def _deliver_sigterm() -> None:
    signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)


def test_callback_runs_first_then_the_servers_own_handler(events):
    restore = chain_shutdown_signal_handlers(lambda: events.append("callback"))
    try:
        _deliver_sigterm()
    finally:
        restore()
    assert events == ["callback", ("server", signal.SIGTERM)]


def test_restore_puts_the_servers_handler_back(events):
    server_handler = signal.getsignal(signal.SIGTERM)
    restore = chain_shutdown_signal_handlers(lambda: None)
    assert signal.getsignal(signal.SIGTERM) is not server_handler
    restore()
    assert signal.getsignal(signal.SIGTERM) is server_handler


def test_a_failing_callback_never_blocks_the_servers_shutdown(events, caplog):
    def broken():
        raise RuntimeError("boom")

    restore = chain_shutdown_signal_handlers(broken)
    try:
        with caplog.at_level(logging.ERROR, logger="app.shutdown_signals"):
            _deliver_sigterm()  # must not raise into whatever code the signal interrupted
    finally:
        restore()
    assert events == [("server", signal.SIGTERM)]
    assert "shutdown-signal callback failed" in caplog.text


def test_signals_without_a_python_handler_are_left_alone():
    original = signal.signal(signal.SIGTERM, signal.SIG_DFL)
    try:
        restore = chain_shutdown_signal_handlers(lambda: None)
        assert signal.getsignal(signal.SIGTERM) == signal.SIG_DFL
        restore()
    finally:
        signal.signal(signal.SIGTERM, original)


def test_off_the_main_thread_it_is_a_no_op(events):
    server_handler = signal.getsignal(signal.SIGTERM)
    results = []
    worker = threading.Thread(target=lambda: results.append(chain_shutdown_signal_handlers(lambda: None)))
    worker.start()
    worker.join()
    assert signal.getsignal(signal.SIGTERM) is server_handler
    results[0]()  # the returned restore is still safe to call


def test_restore_keeps_a_handler_installed_after_ours(events):
    restore = chain_shutdown_signal_handlers(lambda: None)

    def later_handler(signum, frame):
        pass

    signal.signal(signal.SIGTERM, later_handler)
    restore()
    assert signal.getsignal(signal.SIGTERM) is later_handler


def test_lifespan_closes_open_sse_streams_when_a_shutdown_signal_arrives(events, monkeypatch):
    from app import main

    manager = ConnectionManager()
    monkeypatch.setattr(sse_manager, "manager", manager)

    async def scenario():
        queue = manager.connect(user_id=1)
        async with main.lifespan(main.app):
            _deliver_sigterm()
            # close_all is handed to the loop, not run inside the signal handler:
            # nothing has happened yet when the handler returns.
            assert queue.empty()
            return await asyncio.wait_for(queue.get(), timeout=2)

    server_handler = signal.getsignal(signal.SIGTERM)
    assert asyncio.run(scenario()) is CLOSE_STREAM
    assert events == [("server", signal.SIGTERM)]
    assert signal.getsignal(signal.SIGTERM) is server_handler  # restored on lifespan exit
