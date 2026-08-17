import { useScrollReveal } from '../../hooks/useScrollReveal'

// Wraps any block in a subtle fade + rise on scroll-into-view. `delay` is a
// Tailwind arbitrary-value transition-delay (ms), for staggering a row of
// cards without each one needing its own IntersectionObserver timing logic.
export default function Reveal({ children, className = '', delay = 0, as: Tag = 'div' }) {
  const { ref, isVisible } = useScrollReveal()

  return (
    <Tag
      ref={ref}
      className={`
        transition-all duration-700 ease-out motion-reduce:transition-none
        ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}
        ${className}
      `}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}
