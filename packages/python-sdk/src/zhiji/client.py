"""A small, dependency-free server client for Zhiji's server ingest API.

The client deliberately has no global identity.  A caller supplies visitor and
business-user IDs per event, which keeps concurrent web requests isolated.
"""

from __future__ import annotations

import json
import re
import threading
import traceback
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Deque, Dict, Mapping, Optional, Sequence, Tuple, Union
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

JsonValue = Union[None, bool, int, float, str, Sequence["JsonValue"], Mapping[str, "JsonValue"]]
Transport = Callable[[str, bytes, Mapping[str, str], float], "HttpResponse"]

_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,119}$")
_PROPERTY_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,99}$")
_SENSITIVE_KEY = re.compile(r"(?:password|token|secret|cookie|authorization|email|phone|name|address)", re.I)
_SECRET_TEXT = re.compile(r"(?:bearer\s+|(?:api[_-]?key|token|password|secret|authorization|cookie|session)\s*[:=])", re.I)
_QUERY_SECRET = re.compile(r"([?&](?:token|password|authorization|cookie|session)=[^\s&#]+)", re.I)
_EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")

MAX_QUEUE_BYTES = 512 * 1024
MAX_BATCH_BYTES = 48 * 1024
MAX_BATCH_ITEMS = 50
MAX_RETRIES = 3


class TelemetryValidationError(ValueError):
    """The SDK refused an input before it was added to an in-memory queue."""


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes = b""
    headers: Mapping[str, str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.headers is None:
            object.__setattr__(self, "headers", {})


@dataclass(frozen=True)
class FlushResult:
    attempted: int = 0
    accepted: int = 0
    duplicate: int = 0
    dropped: int = 0
    pending: int = 0
    retryable: bool = False
    status: Optional[int] = None
    error: Optional[str] = None


@dataclass(frozen=True)
class FlushResults:
    analytics: FlushResult
    error: FlushResult


@dataclass(frozen=True)
class DeliveryState:
    analytics_pending: int
    error_pending: int
    locally_dropped: int
    last_error: Optional[str]


@dataclass
class _QueueItem:
    value: Dict[str, Any]
    bytes: int
    retries: int = 0


class _Lane:
    def __init__(self, max_items: int) -> None:
        self.items: Deque[_QueueItem] = deque()
        self.bytes = 0
        self.max_items = max_items


class ZhijiClient:
    """Buffer server events and errors, then post them to Zhiji in batches.

    ``flush()`` always exposes delivery status. Retryable failures retain their
    original ``client_event_id`` in memory, so a later flush is idempotent.
    The client never writes telemetry to disk or reads request headers/bodies.
    """

    def __init__(
        self,
        *,
        key: str,
        endpoint_base_url: str,
        release: Optional[str] = None,
        timeout_seconds: float = 5.0,
        max_queue_items: int = 100,
        transport: Optional[Transport] = None,
    ) -> None:
        if not _valid_text(key, 8, 512):
            raise TelemetryValidationError("Zhiji server SDK requires a server key")
        if not endpoint_base_url.startswith(("http://", "https://")):
            raise TelemetryValidationError("endpoint_base_url must be an http(s) URL")
        if not isinstance(timeout_seconds, (int, float)) or not 0 < timeout_seconds <= 30:
            raise TelemetryValidationError("timeout_seconds must be between 0 and 30")
        if not isinstance(max_queue_items, int) or not 1 <= max_queue_items <= 10_000:
            raise TelemetryValidationError("max_queue_items must be between 1 and 10000")
        if release is not None and not _valid_text(release, 1, 200):
            raise TelemetryValidationError("release must be a trimmed string up to 200 characters")
        self._key = key
        self._base_url = endpoint_base_url.rstrip("/")
        self._release = release
        self._timeout = float(timeout_seconds)
        self._transport = transport or _urllib_transport
        self._analytics = _Lane(max_queue_items)
        self._errors = _Lane(max_queue_items)
        self._instance_id = str(uuid.uuid4())
        self._sequence = 0
        self._lock = threading.RLock()
        self._locally_dropped = 0
        self._last_error: Optional[str] = None

    def track(
        self,
        name: str,
        *,
        visitor_id: str,
        business_user_id: Optional[str] = None,
        properties: Optional[Mapping[str, Any]] = None,
        client_event_id: Optional[str] = None,
        occurred_at: Optional[datetime] = None,
    ) -> str:
        """Queue one product event and return its idempotency key.

        Sensitive property keys are removed before queueing. Invalid identity,
        event name, timestamp, or explicit event ID raises rather than silently
        losing an intended business event.
        """
        _require_name(name)
        _require_identifier(visitor_id, "visitor_id")
        if business_user_id is not None:
            _require_identifier(business_user_id, "business_user_id")
        event_id = _event_id(client_event_id)
        event = self._analytics_base(event_id, visitor_id, business_user_id, occurred_at)
        event.update({"kind": "event", "name": name})
        cleaned = sanitize_properties(properties)
        if cleaned:
            event["properties"] = cleaned
        self._enqueue(self._analytics, event)
        return event_id

    def capture_exception(
        self,
        error: BaseException,
        *,
        visitor_id: str,
        business_user_id: Optional[str] = None,
        client_event_id: Optional[str] = None,
        occurred_at: Optional[datetime] = None,
        release: Optional[str] = None,
    ) -> str:
        """Queue a redacted exception for the dedicated error endpoint."""
        if not isinstance(error, BaseException):
            raise TelemetryValidationError("error must be an exception")
        _require_identifier(visitor_id, "visitor_id")
        if business_user_id is not None:
            _require_identifier(business_user_id, "business_user_id")
        if release is not None and not _valid_text(release, 1, 200):
            raise TelemetryValidationError("release must be a trimmed string up to 200 characters")
        event_id = _event_id(client_event_id)
        event: Dict[str, Any] = {
            "client_event_id": event_id,
            "kind": "error",
            "visitor_id": visitor_id,
            "occurred_at": _timestamp(occurred_at),
            "error": _normalize_error(error),
        }
        if business_user_id:
            event["business_user_id"] = business_user_id
        selected_release = release if release is not None else self._release
        if selected_release:
            event["release"] = selected_release
        self._enqueue(self._errors, event)
        return event_id

    def flush(self) -> FlushResults:
        """Try one bounded batch from each lane without hiding failed delivery."""
        return FlushResults(
            analytics=self._flush_lane(self._analytics, "/api/ingest/server/events"),
            error=self._flush_lane(self._errors, "/api/ingest/server/errors"),
        )

    def shutdown(self) -> FlushResults:
        """Alias for ``flush`` for process shutdown hooks."""
        return self.flush()

    @property
    def delivery_state(self) -> DeliveryState:
        with self._lock:
            return DeliveryState(len(self._analytics.items), len(self._errors.items), self._locally_dropped, self._last_error)

    def _analytics_base(self, event_id: str, visitor_id: str, business_user_id: Optional[str], occurred_at: Optional[datetime]) -> Dict[str, Any]:
        with self._lock:
            sequence = self._sequence
            self._sequence += 1
        event: Dict[str, Any] = {
            "client_event_id": event_id,
            "client_instance_id": self._instance_id,
            "client_sequence": sequence,
            "visitor_id": visitor_id,
            "occurred_at": _timestamp(occurred_at),
        }
        if business_user_id:
            event["business_user_id"] = business_user_id
        if self._release:
            event["release"] = self._release
        return event

    def _enqueue(self, lane: _Lane, value: Dict[str, Any]) -> None:
        size = _encoded_size(value)
        if size > MAX_BATCH_BYTES - 1024:
            raise TelemetryValidationError("telemetry item exceeds the 48 KiB ingest batch limit")
        with self._lock:
            while lane.items and (len(lane.items) >= lane.max_items or lane.bytes + size > MAX_QUEUE_BYTES):
                evicted = lane.items.popleft()
                lane.bytes -= evicted.bytes
                self._locally_dropped += 1
            lane.items.append(_QueueItem(value=value, bytes=size))
            lane.bytes += size

    def _flush_lane(self, lane: _Lane, endpoint: str) -> FlushResult:
        batch = self._take_batch(lane)
        if not batch:
            return self._result(lane)
        payload = json.dumps({"key": self._key, "events": [item.value for item in batch]}, separators=(",", ":")).encode("utf-8")
        try:
            response = self._transport(self._base_url + endpoint, payload, {"Content-Type": "application/json", "X-Zhiji-Key": self._key}, self._timeout)
        except Exception as error:  # transport errors must remain observable and retryable
            return self._retry_or_drop(lane, batch, None, _error_message(error))
        if response.status < 200 or response.status >= 300:
            detail = "HTTP %d" % response.status
            if response.status in (408, 429) or response.status >= 500:
                return self._retry_or_drop(lane, batch, response.status, detail)
            with self._lock:
                self._last_error = detail
            return FlushResult(attempted=len(batch), dropped=len(batch), pending=self._pending(lane), status=response.status, error=detail)
        try:
            data = json.loads(response.body.decode("utf-8")).get("data")
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            return self._retry_or_drop(lane, batch, response.status, "invalid ingest response")
        if not isinstance(data, Mapping):
            return self._retry_or_drop(lane, batch, response.status, "invalid ingest response")
        accepted = _count(data.get("accepted"))
        duplicate = _count(data.get("duplicate"))
        dropped = _count(data.get("dropped"))
        sampled = _count(data.get("sampled"))
        rate_limited = _count(data.get("rate_limited"))
        if accepted + duplicate + dropped + sampled + rate_limited != len(batch):
            return self._retry_or_drop(lane, batch, response.status, "invalid ingest response")
        result = FlushResult(
            attempted=len(batch),
            accepted=accepted,
            duplicate=duplicate,
            dropped=dropped,
            pending=self._pending(lane),
            status=response.status,
        )
        with self._lock:
            self._last_error = None
        return result

    def _take_batch(self, lane: _Lane) -> Tuple[_QueueItem, ...]:
        with self._lock:
            selected = []
            used = len('{"key":"","events":[]}')
            while lane.items and len(selected) < MAX_BATCH_ITEMS:
                next_item = lane.items[0]
                if selected and used + next_item.bytes + 1 > MAX_BATCH_BYTES:
                    break
                lane.items.popleft()
                lane.bytes -= next_item.bytes
                selected.append(next_item)
                used += next_item.bytes + 1
            return tuple(selected)

    def _retry_or_drop(self, lane: _Lane, batch: Tuple[_QueueItem, ...], status: Optional[int], detail: str) -> FlushResult:
        retryable = []
        dropped = 0
        with self._lock:
            self._last_error = detail
            for item in reversed(batch):
                item.retries += 1
                if item.retries > MAX_RETRIES:
                    dropped += 1
                    continue
                while lane.items and (len(lane.items) >= lane.max_items or lane.bytes + item.bytes > MAX_QUEUE_BYTES):
                    evicted = lane.items.pop()
                    lane.bytes -= evicted.bytes
                    self._locally_dropped += 1
                lane.items.appendleft(item)
                lane.bytes += item.bytes
                retryable.append(item)
        return FlushResult(attempted=len(batch), dropped=dropped, pending=self._pending(lane), retryable=bool(retryable), status=status, error=detail)

    def _pending(self, lane: _Lane) -> int:
        with self._lock:
            return len(lane.items)

    def _result(self, lane: _Lane) -> FlushResult:
        return FlushResult(pending=self._pending(lane))


def sanitize_properties(value: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """Return a bounded, privacy-safe JSON object for event properties/traits."""
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise TelemetryValidationError("properties must be a mapping")
    result: Dict[str, Any] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not _PROPERTY_KEY.fullmatch(key) or _SENSITIVE_KEY.search(key):
            continue
        cleaned = _sanitize_json(item, 1)
        if cleaned is not _DROP:
            result[key] = cleaned
        if len(result) == 40:
            break
    return result


_DROP = object()


def _sanitize_json(value: Any, depth: int) -> Any:
    if depth > 4:
        return _DROP
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value if isinstance(value, int) or value == value and abs(value) != float("inf") else _DROP
    if isinstance(value, str):
        return value[:512] if not _SECRET_TEXT.search(value) else "[redacted]"
    if isinstance(value, (list, tuple)):
        result = []
        for item in value[:20]:
            cleaned = _sanitize_json(item, depth + 1)
            if cleaned is not _DROP:
                result.append(cleaned)
        return result
    if isinstance(value, Mapping):
        result: Dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 128 or _SENSITIVE_KEY.search(key):
                continue
            cleaned = _sanitize_json(item, depth + 1)
            if cleaned is not _DROP:
                result[key] = cleaned
            if len(result) == 40:
                break
        return result
    return _DROP


def _normalize_error(error: BaseException) -> Dict[str, str]:
    error_type = type(error).__name__[:128] or "Error"
    message = _redact(str(error) or "Exception without a message", 2048)
    stack = "".join(traceback.format_exception(type(error), error, error.__traceback__))
    result = {"mechanism": "manual", "type": error_type, "message": message}
    if stack:
        result["stack"] = _redact(stack, 12 * 1024)
    return result


def _redact(value: str, maximum: int) -> str:
    return _EMAIL.sub("[redacted-email]", _QUERY_SECRET.sub("[redacted]", value))[:maximum]


def _urllib_transport(url: str, body: bytes, headers: Mapping[str, str], timeout: float) -> HttpResponse:
    request = Request(url, data=body, headers=dict(headers), method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            return HttpResponse(response.status, response.read(), dict(response.headers.items()))
    except HTTPError as error:
        return HttpResponse(error.code, error.read(), dict(error.headers.items()) if error.headers else {})
    except URLError as error:
        raise TimeoutError(str(error.reason)) from error


def _valid_text(value: Any, minimum: int, maximum: int) -> bool:
    return isinstance(value, str) and value == value.strip() and minimum <= len(value) <= maximum


def _require_identifier(value: Any, field: str) -> None:
    if not _valid_text(value, 1, 128):
        raise TelemetryValidationError("%s must be a trimmed string up to 128 characters" % field)


def _require_name(value: Any) -> None:
    if not isinstance(value, str) or not _NAME.fullmatch(value):
        raise TelemetryValidationError("event name must match [A-Za-z][A-Za-z0-9_.:-]{0,119}")


def _event_id(value: Optional[str]) -> str:
    if value is None:
        return str(uuid.uuid4())
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError) as error:
        raise TelemetryValidationError("client_event_id must be a UUID") from error
    return str(parsed)


def _timestamp(value: Optional[datetime]) -> str:
    instant = value or datetime.now(timezone.utc)
    if not isinstance(instant, datetime):
        raise TelemetryValidationError("occurred_at must be a datetime")
    if instant.tzinfo is None:
        raise TelemetryValidationError("occurred_at must include a timezone")
    return instant.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _encoded_size(value: Mapping[str, Any]) -> int:
    return len(json.dumps(value, separators=(",", ":")).encode("utf-8"))


def _count(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _error_message(error: Exception) -> str:
    if isinstance(error, TimeoutError):
        return "transport timeout"
    return (type(error).__name__ + ": " + str(error))[:512]
