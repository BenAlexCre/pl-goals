import { useUiStore } from '../../store/uiStore'
import Toast from './Toast'

export default function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts)

  return (
    <div
      aria-live="polite"
      className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 lg:bottom-6 lg:right-6 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <Toast key={t.id} {...t} />
      ))}
    </div>
  )
}