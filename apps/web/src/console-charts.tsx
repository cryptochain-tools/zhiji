import type { FunnelStep, TrendPoint } from './api'
import './console-charts.css'

const number = new Intl.NumberFormat('zh-CN')

type TrendBucket = { start: string; value: number }

function chartDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: value.includes('T') ? '2-digit' : undefined,
    minute: value.includes('T') ? '2-digit' : undefined,
  }).format(date)
}

function trendBuckets(points: TrendPoint[]): TrendBucket[] {
  const values = new Map<string, number>()
  for (const point of points) values.set(point.bucket_start, (values.get(point.bucket_start) ?? 0) + point.event_count)
  return Array.from(values, ([start, value]) => ({ start, value })).sort((left, right) => {
    const leftTime = Date.parse(left.start)
    const rightTime = Date.parse(right.start)
    return Number.isNaN(leftTime) || Number.isNaN(rightTime) ? left.start.localeCompare(right.start) : leftTime - rightTime
  })
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (!points.length) return null

  const buckets = trendBuckets(points)
  if (!buckets.length) return null

  const width = 760
  const height = 268
  const left = 48
  const right = 18
  const top = 22
  const bottom = 44
  const graphWidth = width - left - right
  const graphHeight = height - top - bottom
  const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0)
  const maximum = Math.max(1, ...buckets.map(bucket => bucket.value))
  const coordinate = (bucket: TrendBucket, index: number) => {
    const x = left + (buckets.length === 1 ? graphWidth / 2 : graphWidth * index / (buckets.length - 1))
    const y = top + graphHeight - bucket.value / maximum * graphHeight
    return { x, y }
  }
  const positions = buckets.map(coordinate)
  const line = positions.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const firstPosition = positions[0]!
  const lastPosition = positions[positions.length - 1]!
  const area = `${line} L${lastPosition.x.toFixed(2)},${(top + graphHeight).toFixed(2)} L${firstPosition.x.toFixed(2)},${(top + graphHeight).toFixed(2)} Z`
  const labelIndexes = Array.from(new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]))

  return <section className="console-trend-chart" aria-label={`事件趋势，总计 ${number.format(total)} 次`}>
    <div className="console-chart-heading">
      <div><span>事件趋势</span><small>单位：事件数</small></div>
      <strong>{number.format(total)}<small> 次</small></strong>
    </div>
    <svg className="console-trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`共 ${number.format(total)} 次事件，按时间趋势展示`}>
      <defs>
        <linearGradient id="console-trend-area" x1="0" x2="0" y1="0" y2="1">
          <stop className="console-trend-stop-start" offset="0%" />
          <stop className="console-trend-stop-end" offset="100%" />
        </linearGradient>
      </defs>
      {[0, .5, 1].map(level => {
        const y = top + graphHeight * level
        const value = Math.round(maximum * (1 - level))
        return <g className="console-trend-grid" key={level}>
          <line x1={left} x2={width - right} y1={y} y2={y} />
          <text x={left - 10} y={y + 4} textAnchor="end">{number.format(value)}</text>
        </g>
      })}
      <path className="console-trend-area" d={area} />
      <path className="console-trend-line" d={line} />
      {positions.map(({ x, y }, index) => { const bucket = buckets[index]!; return <circle className="console-trend-dot" cx={x} cy={y} r="3.5" key={bucket.start}><title>{`${chartDate(bucket.start)}：${number.format(bucket.value)} 次`}</title></circle> })}
      {labelIndexes.map(index => {
        const bucket = buckets[index]!
        const { x } = positions[index]!
        return <text className="console-trend-date" key={bucket.start} x={x} y={height - 15} textAnchor={index === 0 ? 'start' : index === buckets.length - 1 ? 'end' : 'middle'}>{chartDate(bucket.start)}</text>
      })}
    </svg>
  </section>
}

export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  if (!steps.length) return null
  const maximum = Math.max(1, ...steps.map(step => step.count))

  return <section className="console-funnel-chart" aria-label="漏斗转化图">
    <div className="console-chart-heading">
      <div><span>完成路径</span><small>人数相对首步比例</small></div>
      <span className="console-funnel-legend">每一步按完成该步的人数计算</span>
    </div>
    <ol>
      {steps.map((step, index) => {
        const percentage = Math.max(0, Math.min(100, step.count / maximum * 100))
        return <li key={`${step.name}-${index}`}>
          <div className="console-funnel-step">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong title={step.name}>{step.name}</strong>
            <b>{number.format(step.count)}</b>
          </div>
          <svg className="console-funnel-bar" viewBox="0 0 1000 34" preserveAspectRatio="none" role="img" aria-label={`${step.name}：${number.format(step.count)} 人，本步转化 ${step.conversion.toFixed(2)}%，流失 ${number.format(step.dropoff)} 人`}>
            <rect className="console-funnel-track" x="0" y="0" width="1000" height="34" rx="8" />
            <rect className="console-funnel-fill" x="0" y="0" width={percentage * 10} height="34" rx="8" />
          </svg>
          <div className="console-funnel-meta"><span>本步转化 {step.conversion.toFixed(2)}%</span><span>流失 {number.format(step.dropoff)} 人</span></div>
        </li>
      })}
    </ol>
  </section>
}
