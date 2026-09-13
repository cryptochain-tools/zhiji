import { useEffect, useRef } from 'react'

type Particle = {
  angle: number
  distance: number
  flatten: number
  radius: number
  alpha: number
  drift: number
  phase: number
  ring: number
  order: number
  anchor: boolean
}

const BRAND = '0, 185, 116'
const TAU = Math.PI * 2

function seeded(index: number, salt: number) {
  const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453123
  return value - Math.floor(value)
}

/**
 * A layered signal sphere for the marketing hero. It owns all motion
 * internally so the page can keep the canvas purely decorative.
 */
export function HeroParticles({ paused = false }: { paused?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 })
  const pointerRef = useRef({ x: 0, y: 0, active: false })
  const frameRef = useRef<number | null>(null)
  const visibleRef = useRef(true)
  const reducedRef = useRef(false)
  const documentVisibleRef = useRef(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let lastDraw = 0

    const createParticles = (width: number, height: number) => {
      const compact = width < 640
      const counts = compact ? [10, 13, 16, 14] : width < 980 ? [12, 16, 20, 22, 18] : [14, 18, 22, 26, 28, 24]
      const base = Math.min(width, height)
      const particles: Particle[] = []
      counts.forEach((count, ring) => {
        for (let order = 0; order < count; order += 1) {
          const index = particles.length
          const angle = (order / count) * TAU + ring * 0.31 + (seeded(index, 1) - 0.5) * 0.13
          particles.push({
            angle,
            distance: base * (0.105 + ring * (compact ? 0.061 : 0.056) + (seeded(index, 2) - 0.5) * 0.013),
            flatten: 0.5 + seeded(index, 3) * 0.13,
            radius: 0.65 + seeded(index, 4) * (compact ? 1.45 : 1.85),
            alpha: 0.34 + seeded(index, 5) * 0.38,
            drift: (ring % 2 ? -1 : 1) * (0.018 + seeded(index, 6) * 0.025),
            phase: seeded(index, 7) * TAU,
            ring,
            order,
            anchor: order % Math.max(4, Math.round(count / 5)) === ring % 3,
          })
        }
      })
      particlesRef.current = particles
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (sizeRef.current.width === width && sizeRef.current.height === height && sizeRef.current.dpr === dpr) return

      sizeRef.current = { width, height, dpr }
      canvas.width = width * dpr
      canvas.height = height * dpr
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      createParticles(width, height)
      draw(performance.now())
    }

    const draw = (timestamp: number) => {
      const { width, height } = sizeRef.current
      if (!width || !height) return

      context.clearRect(0, 0, width, height)
      const compact = width < 640
      const time = reducedRef.current ? 0 : timestamp / 1000
      const centerX = width * (compact ? 0.61 : 0.73)
      const centerY = height * (compact ? 0.73 : 0.49)
      const pointerX = pointerRef.current.active ? pointerRef.current.x * width : centerX
      const pointerY = pointerRef.current.active ? pointerRef.current.y * height : centerY
      const fieldX = (pointerX - centerX) * 0.06
      const fieldY = (pointerY - centerY) * 0.06
      const base = Math.min(width, height)

      // A restrained core gives the constellation depth while keeping the
      // headline side of the hero quiet.
      const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, base * 0.43)
      glow.addColorStop(0, `rgba(${BRAND}, 0.105)`)
      glow.addColorStop(0.34, `rgba(${BRAND}, 0.038)`)
      glow.addColorStop(1, `rgba(${BRAND}, 0)`)
      context.fillStyle = glow
      context.fillRect(0, 0, width, height)

      const ringCount = compact ? 4 : width < 980 ? 5 : 6
      context.lineCap = 'round'
      for (let ring = 0; ring < ringCount; ring += 1) {
        const radius = base * (0.105 + ring * (compact ? 0.061 : 0.056))
        const tilt = -0.36 + ring * 0.15 + Math.sin(time * 0.08 + ring) * 0.025
        context.beginPath()
        context.ellipse(centerX + fieldX * 0.6, centerY + fieldY * 0.6, radius, radius * (0.5 + ring * 0.018), tilt, 0.18 + ring * 0.07, TAU - 0.3 + ring * 0.025)
        context.lineWidth = ring % 2 ? 0.65 : 0.9
        context.strokeStyle = `rgba(${BRAND}, ${0.115 - ring * 0.009})`
        context.stroke()

        // A short brighter trace travels on alternating rings, suggesting a
        // useful signal moving through the system rather than random motion.
        if (ring % 2 === 0) {
          const head = (time * (0.12 + ring * 0.009) + ring * 1.7) % TAU
          context.beginPath()
          context.ellipse(centerX + fieldX * 0.6, centerY + fieldY * 0.6, radius, radius * (0.5 + ring * 0.018), tilt, head, head + (compact ? 0.32 : 0.42))
          context.lineWidth = 1.35
          context.strokeStyle = `rgba(${BRAND}, ${0.3 - ring * 0.018})`
          context.stroke()
        }
      }

      // Three quiet crossing paths add depth without turning the center into a
      // mesh. Their gaps keep the shape airy at both desktop and mobile sizes.
      for (let stream = 0; stream < (compact ? 2 : 3); stream += 1) {
        const radius = base * (0.18 + stream * 0.09)
        const tilt = -0.9 + stream * 0.78 + Math.sin(time * 0.06 + stream) * 0.035
        context.beginPath()
        context.ellipse(centerX + fieldX * 0.72, centerY + fieldY * 0.72, radius, radius * 0.28, tilt, 0.35, 5.55)
        context.lineWidth = 0.7
        context.strokeStyle = `rgba(${BRAND}, ${0.09 - stream * 0.012})`
        context.stroke()
      }

      const points = particlesRef.current.map(particle => {
        const orbit = particle.angle + time * particle.drift
        const tilt = -0.36 + particle.ring * 0.15
        const localX = Math.cos(orbit) * particle.distance
        const localY = Math.sin(orbit) * particle.distance * particle.flatten
        const x = centerX + localX * Math.cos(tilt) - localY * Math.sin(tilt) + fieldX * (0.45 + particle.ring * 0.08)
        const y = centerY + localX * Math.sin(tilt) + localY * Math.cos(tilt) + fieldY * (0.45 + particle.ring * 0.08)
        return { ...particle, x, y }
      })

      // Connect only short neighbour runs. Intentional gaps prevent the dense
      // polygon web that made the previous field visually noisy.
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index]
        const next = points[index + 1]
        if (next?.ring === point.ring && (point.order + point.ring * 2) % 6 !== 4) {
          context.beginPath()
          context.moveTo(point.x, point.y)
          context.lineTo(next.x, next.y)
          context.lineWidth = 0.65
          context.strokeStyle = `rgba(${BRAND}, ${compact ? 0.08 : 0.095})`
          context.stroke()
        }
      }

      points.forEach(point => {
        const pulse = reducedRef.current ? 1 : 0.9 + Math.sin(time * 1.1 + point.phase) * 0.1
        const edgeFade = compact ? 1 : Math.max(0.18, Math.min(1, (point.x - width * 0.32) / (width * 0.24)))
        if (point.anchor) {
          const halo = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, point.radius * 5.6)
          halo.addColorStop(0, `rgba(${BRAND}, ${0.17 * edgeFade})`)
          halo.addColorStop(0.35, `rgba(${BRAND}, ${0.075 * edgeFade})`)
          halo.addColorStop(1, `rgba(${BRAND}, 0)`)
          context.beginPath()
          context.arc(point.x, point.y, point.radius * 5.6, 0, TAU)
          context.fillStyle = halo
          context.fill()
          context.beginPath()
          context.arc(point.x, point.y, point.radius * 2.65, 0, TAU)
          context.lineWidth = 0.8
          context.strokeStyle = `rgba(${BRAND}, ${0.18 * edgeFade})`
          context.stroke()
        }
        context.beginPath()
        context.arc(point.x, point.y, point.radius * pulse * (point.anchor ? 1.18 : 1), 0, TAU)
        context.fillStyle = `rgba(${BRAND}, ${point.alpha * edgeFade * (point.anchor ? 1 : 0.82)})`
        context.fill()
      })

      // A small calibrated core finishes the composition without an opaque
      // decorative sphere.
      context.beginPath()
      context.arc(centerX + fieldX * 0.35, centerY + fieldY * 0.35, compact ? 3.2 : 4.2, 0, TAU)
      context.fillStyle = `rgba(${BRAND}, 0.72)`
      context.fill()
      context.beginPath()
      context.arc(centerX + fieldX * 0.35, centerY + fieldY * 0.35, compact ? 11 : 15, 0, TAU)
      context.lineWidth = 0.9
      context.strokeStyle = `rgba(${BRAND}, 0.18)`
      context.stroke()
    }

    const stop = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    const animate = (timestamp: number) => {
      if (paused || !visibleRef.current || !documentVisibleRef.current || reducedRef.current) {
        frameRef.current = null
        return
      }
      if (timestamp - lastDraw > 26) {
        draw(timestamp)
        lastDraw = timestamp
      }
      frameRef.current = requestAnimationFrame(animate)
    }

    const start = () => {
      stop()
      draw(performance.now())
      if (visibleRef.current && documentVisibleRef.current && !reducedRef.current && !paused) {
        frameRef.current = requestAnimationFrame(animate)
      }
    }

    const updateMotionPreference = () => {
      reducedRef.current = media.matches
      start()
    }
    const onVisibilityChange = () => {
      documentVisibleRef.current = !document.hidden
      start()
    }
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointerRef.current = {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        active: true,
      }
    }
    const onPointerLeave = () => { pointerRef.current.active = false }

    const observer = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting
      start()
    }, { threshold: 0.05 })
    const resizeObserver = new ResizeObserver(resize)

    reducedRef.current = media.matches
    resizeObserver.observe(canvas)
    observer.observe(canvas)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('blur', onPointerLeave)
    media.addEventListener('change', updateMotionPreference)
    resize()
    start()

    return () => {
      stop()
      observer.disconnect()
      resizeObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', onPointerLeave)
      media.removeEventListener('change', updateMotionPreference)
    }
  }, [paused])

  return <canvas ref={canvasRef} className="zhome-particles" aria-hidden="true" />
}
