import { useEffect, useRef, useState } from 'react'

// Landing page only — a tiny IntersectionObserver wrapper so marketing
// sections can fade/slide in on scroll without pulling in an animation
// library. Fires once (unobserves after the first intersection) since a
// marketing page re-animating every time you scroll past it reads as
// gimmicky, not premium.
export function useScrollReveal({ threshold = 0.15, rootMargin = '0px 0px -80px 0px' } = {}) {
  const ref = useRef(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.unobserve(node)
        }
      },
      { threshold, rootMargin }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [threshold, rootMargin])

  return { ref, isVisible }
}
