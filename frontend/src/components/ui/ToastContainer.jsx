import { useUiStore } from '../../store/uiStore'
import Toast from './Toast'

export default function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts)

  return (
    <div
      aria-live="polite"
      className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <Toast key={t.id} {...t} />
      ))}
    </div>
  )
}