import { useEffect, useRef, useState } from 'react'

/**
 * Считает FPS по кадрам requestAnimationFrame и раз в секунду
 * обновляет состояние. Используется в HUD сцены.
 */
export function useFpsSampler(enabled = true) {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const last = useRef(performance.now())

  useEffect(() => {
    if (!enabled) return
    let id = 0

    const tick = (now) => {
      frames.current += 1
      const elapsed = now - last.current
      if (elapsed >= 1000) {
        setFps(Math.round((frames.current * 1000) / elapsed))
        frames.current = 0
        last.current = now
      }
      id = requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)

    return () => cancelAnimationFrame(id)
  }, [enabled])

  return fps
}
