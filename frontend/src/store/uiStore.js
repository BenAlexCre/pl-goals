import { create } from 'zustand'

let _toastId = 0

export const useUiStore = create((set, get) => ({
  toasts:        [],
  drawerOpen:    false,
  drawerContent: null,

  addToast({ type = 'info', message, duration = 4000 }) {
    const id = ++_toastId
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => get().removeToast(id), duration)
    return id
  },

  removeToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  openDrawer(content) {
    set({ drawerOpen: true, drawerContent: content })
  },

  closeDrawer() {
    set({ drawerOpen: false, drawerContent: null })
  },
}))