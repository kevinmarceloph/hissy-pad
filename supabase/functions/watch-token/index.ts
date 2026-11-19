// A sign-in for the Apple Watch, asked for by the phone app.
//
// The watch syncs on its own, so it needs a session of its own: sharing the phone's would
// not work, because a refresh token can be used once and whichever device refreshed
// second would sign both out. The phone app calls this with its own session; the answer is
// a one-time token for the same account, which the phone passes to the watch and the watch
// trades for a session at /auth/v1/verify (apps/mobile/src/watch.ts,
// apps/mobile/targets/watch/Remote.swift). Nothing is emailed.
//
// It gives a signed-in caller nothing they could not already do: a session can change its
// own account's email or password. The token lasts as long as an emailed sign-in link and
// works once.
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Not signed in' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // The gateway does not check the token (verify_jwt is off in config.toml, so this works
  // whichever way the project signs its tokens); the auth server does, here.
  const { data: who, error: whoError } = await admin.auth.getUser(jwt)
  const user = who?.user
  if (whoError || !user) return json({ error: 'Not signed in' }, 401)
  if (!user.email) return json({ error: 'This account has no email to sign in with' }, 400)

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email })
  const token = data?.properties?.hashed_token
  if (error || !token) return json({ error: error?.message ?? 'Could not make a sign-in token' }, 500)
  return json({ token_hash: token, user: user.id })
})
