import json
import unittest

from zhiji import HttpResponse, TelemetryValidationError, ZhijiClient


def ok_transport(calls):
    def transport(url, body, headers, timeout):
        calls.append((url, json.loads(body), headers, timeout))
        return HttpResponse(202, b'{"data":{"accepted":1,"duplicate":0,"sampled":0,"rate_limited":0,"dropped":0}}')
    return transport


class ZhijiClientTest(unittest.TestCase):
    def test_posts_exact_server_event_envelope_and_filters_sensitive_properties(self):
        calls = []
        client = ZhijiClient(key="zj_ser_abcdefghijklmnopqrstuvwxyz", endpoint_base_url="https://zhiji.test/", transport=ok_transport(calls))
        event_id = "b410c8e4-9bb0-467a-b073-e7ace5c1bd72"
        client.track("document_opened", visitor_id="app:user:42", business_user_id="42", client_event_id=event_id, properties={"module": "document_center", "email": "drop@example.test", "nested": {"result": "success", "token": "nope"}})

        result = client.flush().analytics

        self.assertEqual(result.accepted, 1)
        self.assertEqual(calls[0][0], "https://zhiji.test/api/ingest/server/events")
        event = calls[0][1]["events"][0]
        self.assertEqual(event["client_event_id"], event_id)
        self.assertEqual(event["business_user_id"], "42")
        self.assertEqual(event["properties"], {"module": "document_center", "nested": {"result": "success"}})
        self.assertEqual(calls[0][2]["X-Zhiji-Key"], "zj_ser_abcdefghijklmnopqrstuvwxyz")

    def test_retryable_timeout_preserves_original_event_and_exposes_failure(self):
        calls = []
        def transport(url, body, headers, timeout):
            calls.append(json.loads(body))
            if len(calls) == 1:
                raise TimeoutError("slow upstream")
            return HttpResponse(202, b'{"data":{"accepted":1,"duplicate":0,"sampled":0,"rate_limited":0,"dropped":0}}')

        client = ZhijiClient(key="zj_ser_abcdefghijklmnopqrstuvwxyz", endpoint_base_url="https://zhiji.test", transport=transport)
        event_id = client.track("email_queued", visitor_id="mail-worker")
        failed = client.flush().analytics
        delivered = client.flush().analytics

        self.assertTrue(failed.retryable)
        self.assertEqual(failed.pending, 1)
        self.assertEqual(failed.error, "transport timeout")
        self.assertEqual(delivered.accepted, 1)
        self.assertEqual(calls[0]["events"][0]["client_event_id"], event_id)
        self.assertEqual(calls[1]["events"][0]["client_event_id"], event_id)

    def test_error_lane_is_separate_redacted_and_bounded(self):
        calls = []
        client = ZhijiClient(key="zj_ser_abcdefghijklmnopqrstuvwxyz", endpoint_base_url="https://zhiji.test", max_queue_items=1, transport=ok_transport(calls))
        client.track("one", visitor_id="v")
        try:
            raise RuntimeError("contact a@example.test?token=very-secret")
        except RuntimeError as error:
            client.capture_exception(error, visitor_id="v")

        result = client.flush()

        self.assertEqual(result.analytics.accepted, 1)
        self.assertEqual(result.error.accepted, 1)
        error_payload = calls[1][1]["events"][0]["error"]
        self.assertIn("[redacted-email]", error_payload["message"])
        self.assertNotIn("very-secret", error_payload["message"])

    def test_invalid_input_is_not_silently_lost_and_full_queue_is_visible(self):
        client = ZhijiClient(key="zj_ser_abcdefghijklmnopqrstuvwxyz", endpoint_base_url="https://zhiji.test", max_queue_items=1, transport=lambda *_: HttpResponse(202, b'{"data":{"accepted":1,"duplicate":0,"sampled":0,"rate_limited":0,"dropped":0}}'))
        with self.assertRaises(TelemetryValidationError):
            client.track("bad event", visitor_id="v")
        client.track("first", visitor_id="v")
        client.track("second", visitor_id="v")
        self.assertEqual(client.delivery_state.locally_dropped, 1)
        self.assertEqual(client.flush().analytics.attempted, 1)

    def test_client_event_id_must_be_uuid(self):
        client = ZhijiClient(key="zj_ser_abcdefghijklmnopqrstuvwxyz", endpoint_base_url="https://zhiji.test")
        with self.assertRaises(TelemetryValidationError):
            client.track("document_opened", visitor_id="v", client_event_id="outbox-42")


if __name__ == "__main__":
    unittest.main()
