# `zhiji-sdk` Python server SDK

`zhiji-sdk` sends server-side product events and exceptions to a Zhiji project. It
uses only the Python standard library and keeps a separate, bounded in-memory
queue for analytics and errors. It never reads HTTP request bodies, cookies,
or authorization headers, and it does not persist telemetry to disk.

The package is released under the [MIT License](LICENSE). It is currently in
pre-release and is not yet published to PyPI.

## Install

```bash
python3 -m pip install zhiji-sdk
```

For a checkout of this repository:

```bash
python3 -m pip install ./packages/python-sdk
```

Use a server ingestion key only from a server-side environment variable. Do
not expose it in browser code.

## Capture business events

```python
import os
from zhiji import ZhijiClient

zhiji = ZhijiClient(
    key=os.environ["ZHIJI_SERVER_KEY"],
    endpoint_base_url="https://zhiji.example.com",
    release="web-2026.09.13",
)

zhiji.track(
    "document_opened",
    visitor_id="app:user:42",
    business_user_id="42",
    properties={"module": "document_center", "entry_point": "search_result"},
)

result = zhiji.flush()
if result.analytics.retryable:
    # Preserve the client and call flush again from the request lifecycle,
    # worker, or process shutdown hook.
    logger.warning("Zhiji delivery deferred: %s", result.analytics.error)
```

Use a stable `client_event_id` when an application outbox retries the same
business action. Zhiji uses that UUID for idempotency.

```python
zhiji.track(
    "email_provider_accepted",
    visitor_id="app:system:mail-worker",
    business_user_id="42",
    client_event_id=outbox_row.zhiji_event_id,
    properties={"source_module": "authorization", "mail_type": "approval"},
)
```

## Capture exceptions

```python
try:
    generate_report()
except Exception as error:
    zhiji.capture_exception(
        error,
        visitor_id="app:user:42",
        business_user_id="42",
    )
    raise
finally:
    zhiji.flush()
```

Errors go only to `/api/ingest/server/errors`; product events go only to
`/api/ingest/server/events`.

## Delivery behavior

- Each lane is capped by `max_queue_items` (default 100) and 512 KiB. When a
  lane is full, its oldest queued item is evicted; `delivery_state` exposes the
  cumulative local eviction count.
- A flush sends at most 50 events and 48 KiB per lane. `flush()` returns each
  lane's accepted, duplicate, dropped, pending, HTTP status, and error state.
- Network failure, timeout, `408`, `429`, and `5xx` retain the original event
  IDs for up to three later flush attempts. A retryable failure is never
  reported as successful; inspect `FlushResult.retryable` and `error`.
- Other `4xx` responses are terminal and are reported as `dropped`; correct the
  caller input or key configuration before sending new events.

## Privacy boundary

Properties with keys resembling `email`, `name`, `phone`, `address`, `token`,
`password`, `cookie`, `authorization`, or `secret` are excluded before entering
the queue. Nested values are bounded and values resembling credential text are
redacted. Send stable IDs in `business_user_id`; keep user-directory fields
such as email and display name outside telemetry event properties.

The service validates again and remains the final policy boundary.

## Test

```bash
PYTHONPATH=packages/python-sdk/src python3 -m unittest discover -s packages/python-sdk/tests -v
python3 -m pip wheel --no-deps --wheel-dir /tmp/zhiji-sdk-wheel packages/python-sdk
```
