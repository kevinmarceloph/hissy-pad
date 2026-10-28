import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { usePad, requestSync } from '@hissypad/state'
import { supabase } from '../supabase'
import { serif, type Theme } from '../theme'

WebBrowser.maybeCompleteAuthSession()
export const AUTH_REDIRECT = 'hissypad://auth'

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Session from the return link, in either shape Supabase sends:
//   hissypad://auth#access_token=…&refresh_token=…   (implicit flow)
//   hissypad://auth?code=…                            (PKCE flow)
// Returns a short status for the UI; errors are shown, not swallowed.
// The same link can arrive twice (getInitialURL at launch and the 'url' event), and two
// concurrent exchanges cancel each other ("fetch failed: cancelled"), so links are
// de-duplicated and handled one at a time.
let lastUrl = ''
let lastAt = 0
let chain: Promise<unknown> = Promise.resolve()
export function completeAuthFromUrl(url: string): Promise<string | null> {
  const now = Date.now()
  if (url === lastUrl && now - lastAt < 30_000) return Promise.resolve(null)
  lastUrl = url
  lastAt = now
  const run = chain.then(() => completeAuthFromUrlOnce(url))
  chain = run.catch(() => undefined)
  return run
}

async function completeAuthFromUrlOnce(url: string): Promise<string | null> {
  if (!supabase) return null
  if (!url.startsWith(AUTH_REDIRECT) && !url.startsWith('hissypad://')) return null
  try {
    const u = new URL(url.replace('hissypad://', 'https://hissypad.local/'))
    const code = u.searchParams.get('code')
    const err = u.searchParams.get('error_description') ?? u.searchParams.get('error')
    if (err) return `Sign-in failed: ${err}`
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      return error ? `Sign-in failed: ${error.message}` : 'Signed in.'
    }
    const p = new URLSearchParams(u.hash.replace(/^#/, ''))
    const access_token = p.get('access_token')
    const refresh_token = p.get('refresh_token')
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token })
      return error ? `Sign-in failed: ${error.message}` : 'Signed in.'
    }
    return `Sign-in link had no session (${url.slice(0, 40)}…). Is hissypad://** in Supabase's redirect URLs?`
  } catch (e) {
    return `Sign-in failed: ${(e as Error).message}`
  }
}

export function Account({ theme }: { theme: Theme }) {
  const session = usePad((s) => s.session)
  const sync = usePad((s) => s.sync)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState<string | null>(null)

  if (!supabase) return <Text style={[s.foot, s.pad, { color: theme.inkMute }]}>Saved on this phone only.</Text>

  async function sendLink() {
    const { error } = await supabase!.auth.signInWithOtp({ email, options: { emailRedirectTo: AUTH_REDIRECT } })
    setNote(error ? error.message : `Link sent to ${email}. Open it on this phone.`)
  }

  async function google() {
    const { data, error } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true } })
    if (error || !data.url) return setNote(error?.message ?? 'Could not start Google sign-in')
    const res = await WebBrowser.openAuthSessionAsync(data.url, AUTH_REDIRECT)
    if (res.type === 'success') {
      const msg = await completeAuthFromUrl(res.url)
      setNote(msg)
      if (msg === 'Signed in.') setOpen(false)
    } else {
      setNote(`Google sign-in ${res.type}. If the browser showed the web app instead of returning here, hissypad://** is missing from Supabase's redirect URLs.`)
    }
  }

  if (!session) {
    return (
      <View style={s.footRow}>
        <Text style={[s.foot, { color: theme.inkMute }]}>Saved on this phone. </Text>
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button">
          <Text style={[s.foot, { color: theme.link, textDecorationLine: 'underline' }]}>Sign in to sync</Text>
        </Pressable>
        <Modal visible={open} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setOpen(false)}>
          <View style={[s.sheet, { backgroundColor: theme.paper }]}>
            <Text style={[s.h2, { color: theme.ink }]}>Sign in</Text>
            <Text style={[s.p, { color: theme.inkSoft }]}>Your lines stay on this phone either way. Signing in copies them to your account and keeps every device the same.</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={theme.inkMute}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={[s.input, { color: theme.ink, borderColor: theme.rule, backgroundColor: theme.paperRaised }]}
              accessibilityLabel="Email for a magic link"
            />
            {note && <Text style={[s.p, { color: theme.inkSoft }]}>{note}</Text>}
            <View style={s.actions}>
              <Pressable onPress={() => setOpen(false)} style={[s.btn, { borderColor: theme.rule }]}><Text style={[s.btnText, { color: theme.ink }]}>Cancel</Text></Pressable>
              <Pressable onPress={google} style={[s.btn, { borderColor: theme.rule }]}><Text style={[s.btnText, { color: theme.ink }]}>Continue with Google</Text></Pressable>
              <Pressable onPress={sendLink} disabled={!email} style={[s.btn, { backgroundColor: theme.ink, borderColor: theme.ink, opacity: email ? 1 : 0.5 }]}><Text style={[s.btnText, { color: theme.paper }]}>Send link</Text></Pressable>
            </View>
          </View>
        </Modal>
      </View>
    )
  }

  let line: string
  if (!sync || sync.state === 'syncing') line = 'Syncing…'
  else if (sync.state === 'error') line = `Sync failed: ${sync.error ?? 'unknown error'}.`
  else if (sync.pending > 0) line = `${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'} waiting.`
  else line = sync.lastSyncAt ? `Synced ${timeOf(sync.lastSyncAt)}.` : 'Synced.'
  return (
    <View style={s.footRow}>
      <Text style={[s.foot, { color: theme.inkMute }]}>{line} </Text>
      {sync?.state === 'error' && <Pressable onPress={requestSync}><Text style={[s.foot, { color: theme.link }]}>Retry </Text></Pressable>}
      <Text style={[s.foot, { color: theme.inkSoft }]}>{session.user.email} </Text>
      <Pressable onPress={() => void supabase!.auth.signOut()}><Text style={[s.foot, { color: theme.link, textDecorationLine: 'underline' }]}>Sign out</Text></Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  footRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', paddingHorizontal: 16, paddingVertical: 10 },
  pad: { paddingHorizontal: 16, paddingVertical: 10 },
  foot: { fontFamily: serif, fontSize: 13 },
  sheet: { flex: 1, padding: 20, gap: 12 },
  h2: { fontFamily: serif, fontSize: 22 },
  p: { fontFamily: serif, fontSize: 15, lineHeight: 22 },
  input: { fontFamily: serif, fontSize: 17, borderWidth: 1, borderRadius: 4, padding: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  btn: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
  btnText: { fontFamily: serif, fontSize: 16 },
})
