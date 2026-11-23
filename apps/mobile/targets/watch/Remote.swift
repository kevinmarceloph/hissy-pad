// The watch talking to Supabase itself, over plain HTTPS: the auth server for its session
// and PostgREST for the rows. No SDK. Foundation only, so it also runs on a Mac.
import Foundation

// A sign-in handed over by the phone (apps/mobile/src/watch.ts): where the server is, and
// a one-time token to trade for a session there.
struct Handoff: Codable, Equatable {
  let url: String
  let key: String // the public (anon) key
  let token: String
  let user: String
}

// The watch's own session. It is not the phone's: a refresh token works once, so two
// devices sharing one would sign each other out.
struct Session: Codable, Equatable {
  let url: String
  let key: String
  let user: String
  var access: String
  var refresh: String
  var expires: Double // seconds since 1970
}

struct Remote {
  let url: String
  let key: String

  enum Failure: Error, Equatable {
    case offline         // no network, a timeout, the server having a bad moment: try later
    case unauthorized    // the access token was not accepted: refresh it and try again
    case refused(String) // the server said no and will say no again
  }

  private static let http: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 20
    config.timeoutIntervalForResource = 40
    return URLSession(configuration: config)
  }()

  private func send(_ method: String, _ path: String, access: String? = nil, body: [String: Any]? = nil, prefer: String? = nil) async throws -> Data {
    guard let target = URL(string: url + path) else { throw Failure.refused("Bad server address") }
    var request = URLRequest(url: target)
    request.httpMethod = method
    request.setValue(key, forHTTPHeaderField: "apikey")
    if let access { request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization") }
    if let prefer { request.setValue(prefer, forHTTPHeaderField: "Prefer") }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await Remote.http.data(for: request)
    } catch {
      throw Failure.offline
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    switch status {
    case 200..<300: return data
    case 401: throw Failure.unauthorized
    case 408, 429, 500...: throw Failure.offline
    default:
      let said = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      let why = said?["msg"] ?? said?["message"] ?? said?["error_description"] ?? said?["error"]
      throw Failure.refused("\(why ?? "HTTP \(status)")")
    }
  }

  private struct Granted: Decodable {
    struct User: Decodable { let id: String }
    let access_token: String
    let refresh_token: String
    let expires_in: Double
    let user: User
  }

  private func session(from data: Data) throws -> Session {
    guard let g = try? JSONDecoder().decode(Granted.self, from: data) else { throw Failure.refused("The server sent no session") }
    return Session(url: url, key: key, user: g.user.id, access: g.access_token, refresh: g.refresh_token, expires: Date().timeIntervalSince1970 + g.expires_in)
  }

  // The auth server answers a bad or used token with 401 or 403; either way it is a no.
  private func auth(_ path: String, _ body: [String: Any]) async throws -> Session {
    do {
      return try session(from: try await send("POST", path, body: body))
    } catch Failure.unauthorized {
      throw Failure.refused("Not accepted")
    }
  }

  // Trade the phone's one-time token for a session.
  func signIn(token: String) async throws -> Session {
    try await auth("/auth/v1/verify", ["type": "magiclink", "token_hash": token])
  }

  // A new access token. Refused means the session is over (signed out, revoked).
  func refresh(_ session: Session) async throws -> Session {
    try await auth("/auth/v1/token?grant_type=refresh_token", ["refresh_token": session.refresh])
  }

  // Rows the server stamped after `since`, oldest first.
  func pull(since: String?, limit: Int, access: String) async throws -> [WireRow] {
    var path = "/rest/v1/nodes?select=\(WireRow.columns)&order=synced_at.asc,id.asc&limit=\(limit)"
    if let since {
      // A "+" in a time zone would arrive as a space unless it is escaped.
      let safe = since.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? since
      path += "&synced_at=gt.\(safe)"
    }
    let data = try await send("GET", path, access: access)
    guard let rows = try? JSONDecoder().decode([WireRow].self, from: data) else { throw Failure.refused("Rows the watch could not read") }
    return rows
  }

  // A line typed here. Sent as it was when made; if it was crossed out since, that goes
  // after it as a Done of its own. A second send of the same line (the answer to the
  // first was lost) is ignored by the server instead of refused.
  func add(_ patch: AddPatch, access: String) async throws {
    var body: [String: Any] = ["id": patch.id, "rank": patch.rank, "text": patch.text, "updated_at": Stamp.iso(patch.at)]
    if let parent = patch.parent { body["parent_id"] = parent }
    _ = try await send("POST", "/rest/v1/nodes?on_conflict=id", access: access, body: body, prefer: "resolution=ignore-duplicates,return=minimal")
  }

  // Cross a line out on the server. Only these three columns are written, so whatever
  // else changed on the row meanwhile is kept, and the server still drops the write if
  // the row has a newer updated_at (the last-write-wins trigger).
  func done(_ patch: DonePatch, access: String) async throws {
    let at = Stamp.iso(patch.at)
    _ = try await send("PATCH", "/rest/v1/nodes?id=eq.\(patch.id)", access: access, body: ["done": true, "done_at": at, "updated_at": at], prefer: "return=minimal")
  }
}
