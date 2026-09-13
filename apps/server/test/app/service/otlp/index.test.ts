import assert from 'node:assert/strict'
import { IngestCounts } from '../../../../app/contracts/ingest'
import { OtlpTransportError, processOtlp } from '../../../../app/service/otlp'

const now = new Date('2026-09-12T10:00:00.000Z')
const nanos = (date: Date) => String(BigInt(date.getTime()) * 1_000_000n)
const scope = { tenantId: 'tenant', projectId: 'project', projectKeyId: 'key', pagePolicy: { allowedPageKeys: [], routeTemplates: [] } }
const counts: IngestCounts = { accepted: 1, duplicate: 0, sampled: 0, rate_limited: 0, dropped: 0 }
const attrs = (items: Record<string, string>) => Object.entries(items).map(([key, stringValue]) => ({ key, value: { stringValue } }))
function dependencies(received: unknown[]) {
  return { now, resolveProject: async (key: string) => key === 'zj_ote_key' ? scope : null, rateLimiter: { consume: async () => true }, writer: { write: async (input: unknown) => { received.push(input); return counts } } }
}
function trace() {
  const end = new Date(now.getTime() - 100)
  const start = new Date(end.getTime() - 42)
  return { resourceSpans: [{ resource: { attributes: attrs({ 'service.name': 'billing', 'service.version': '1.2.3' }) }, scopeSpans: [{ scope: { name: 'app' }, spans: [{ traceId: '1'.repeat(32), spanId: '2'.repeat(16), name: 'charge', startTimeUnixNano: nanos(start), endTimeUnixNano: nanos(end), attributes: [], links: [], events: [{ name: 'exception', timeUnixNano: nanos(end), attributes: attrs({ 'exception.type': 'DatabaseError', 'exception.message': 'failed user@example.com?token=abc', 'exception.stacktrace': 'DatabaseError: bad' }) }] }] }] }] }
}

describe('OTLP HTTP adapter', () => {
  it('projects a closed trace subset into duration performance and redacted existing errors', async () => {
    const received: unknown[] = []
    const result = await processOtlp('traces', 'zj_ote_key', trace(), dependencies(received))
    assert.deepEqual(result, { accepted: 2, duplicate: 0, sampled: 0, rate_limited: 0, dropped: 0 })
    assert.equal(received.length, 2)
    const performance = received.find((item: any) => item.lane === 'performance') as any
    const error = received.find((item: any) => item.lane === 'error') as any
    assert.equal(performance.payload.events[0].metric_name, 'SPAN_DURATION')
    assert.equal(performance.payload.events[0].value, 42)
    assert.equal(performance.payload.events[0].page_key, '/otel')
    assert.equal(error.payload.events[0].error.message, 'failed [redacted-email]?token=[redacted]')
  })

  it('accepts only the named duration gauge and uses the independent otel key', async () => {
    const received: unknown[] = []
    const metrics = { resourceMetrics: [{ resource: { attributes: attrs({ 'service.name': 'billing' }) }, scopeMetrics: [{ scope: { name: 'app' }, metrics: [{ name: 'zhiji.span.duration', gauge: { dataPoints: [{ timeUnixNano: nanos(now), asDouble: 123, attributes: [], exemplars: [] }] } }] }] }] }
    await processOtlp('metrics', 'zj_ote_key', metrics, dependencies(received))
    assert.equal((received[0] as any).payload.events[0].metric_name, 'SPAN_DURATION')
    await assert.rejects(() => processOtlp('metrics', 'zj_ote_key', { ...metrics, resourceMetrics: [{ ...metrics.resourceMetrics[0], scopeMetrics: [{ scope: { name: 'app' }, metrics: [{ name: 'http.server.duration', gauge: { dataPoints: [] } }] }] }] }, dependencies([])), (error: unknown) => error instanceof OtlpTransportError && error.code === 'invalid_otlp_payload')
    await assert.rejects(() => processOtlp('metrics', 'browser-key', metrics, dependencies([])), (error: unknown) => error instanceof OtlpTransportError && error.code === 'invalid_otel_key')
  })

  it('rejects raw log bodies, baggage-like unknown resources, and arbitrary span attrs', async () => {
    const logs = { resourceLogs: [{ resource: { attributes: attrs({ 'service.name': 'billing' }) }, scopeLogs: [{ scope: { name: 'app' }, logRecords: [{ timeUnixNano: nanos(now), severityText: 'ERROR', traceId: '1'.repeat(32), spanId: '2'.repeat(16), body: { stringValue: 'secret' }, attributes: attrs({ 'exception.type': 'Error', 'exception.message': 'nope' }) }] }] }] }
    await assert.rejects(() => processOtlp('logs', 'zj_ote_key', logs, dependencies([])), (error: unknown) => error instanceof OtlpTransportError && error.code === 'invalid_otlp_payload')
    const withUnknownResource = trace(); (withUnknownResource.resourceSpans[0]!.resource.attributes as any[]).push(...attrs({ 'process.command_line': 'secret' }))
    await assert.rejects(() => processOtlp('traces', 'zj_ote_key', withUnknownResource, dependencies([])), (error: unknown) => error instanceof OtlpTransportError && error.code === 'invalid_otlp_payload')
    const withSpanAttributes = trace(); (withSpanAttributes.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes as any[]).push(...attrs({ 'http.url': 'https://secret.example' }))
    await assert.rejects(() => processOtlp('traces', 'zj_ote_key', withSpanAttributes, dependencies([])), (error: unknown) => error instanceof OtlpTransportError && error.code === 'invalid_otlp_payload')
  })
})
