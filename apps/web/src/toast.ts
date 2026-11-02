// One toast line under the top bar, from anywhere in the app. The top bar renders it.
import { create } from 'zustand'

interface ToastState {
  text: string | null
  at: number
}

export const useToast = create<ToastState>(() => ({ text: null, at: 0 }))

export function showToast(text: string | null) {
  useToast.setState({ text, at: Date.now() })
}
