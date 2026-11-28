// The Mac app's way back in from a sign-in. The email's link, or Google's page, ends at
// hissypad://auth#access_token=…, which the system hands to the app, and the app hands its
// parts to the page here (apps/mac/Sources/HissyPad/main.swift).
import type { SupabaseClient } from '@supabase/supabase-js'

type Opener = Window & { hissypadOpen?: (params: Record<string, string>) => void }

export function bindMacLinks(supabase: SupabaseClient | null, say: (text: string) => void): void {
  (window as Opener).hissypadOpen = (params) => {
    if (!supabase) return
    const failed = (message: string) => say(`Sign-in did not go through: ${message}`)
    if (params.error_description || params.error) return failed(params.error_description || params.error || '')
    if (params.access_token && params.refresh_token) {
      void supabase.auth.setSession({ access_token: params.access_token, refresh_token: params.refresh_token }).then(({ error }) => {
        if (error) failed(error.message)
      })
    } else if (params.code) {
      void supabase.auth.exchangeCodeForSession(params.code).then(({ error }) => {
        if (error) failed(error.message)
      })
    }
  }
}
