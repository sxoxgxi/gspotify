import Soup from "gi://Soup";
import GLib from "gi://GLib";
import { logInfo, logWarn } from "./utils.js";
import { getValidAccessToken, SpotifyError } from "./spotify-auth.js";

const API_ENDPOINT = "https://api.spotify.com/v1";

let activeSessions = new Set();

export async function getSpotifyUsername() {
  const accessToken = await getValidAccessToken();
  const session = new Soup.Session();
  activeSessions.add(session);

  const msg = Soup.Message.new("GET", `${API_ENDPOINT}/me`);
  msg.get_request_headers().append("Authorization", `Bearer ${accessToken}`);

  try {
    const response = await new Promise((resolve, reject) => {
      session.send_and_read_async(
        msg,
        GLib.PRIORITY_DEFAULT,
        null,
        (_session, result) => {
          try {
            const bytes = session.send_and_read_finish(result);
            resolve(bytes);
          } catch (e) {
            reject(e);
          }
        },
      );
    });

    const data = JSON.parse(new TextDecoder().decode(response.get_data()));
    return data.display_name || data.id;
  } catch (e) {
    throw new Error(`Failed to fetch Spotify username: ${e.message}`);
  } finally {
    activeSessions.delete(session);
  }
}

export async function isSpotifyLoggedIn() {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return false;
    }

    return true;
  } catch (e) {
    logWarn(`Failed to check Spotify login status: ${e.message}`);
    return false;
  }
}

async function libraryRequest(method, trackId) {
  if (typeof trackId !== "string" || !/^[a-zA-Z0-9]+$/.test(trackId)) {
    throw new SpotifyError("invalid-track");
  }
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new SpotifyError("not-authenticated");

  const session = new Soup.Session();
  activeSessions.add(session);
  const path = method === "GET" ? "/me/library/contains" : "/me/library";
  const uri = encodeURIComponent(`spotify:track:${trackId}`);
  const msg = Soup.Message.new(method, `${API_ENDPOINT}${path}?uris=${uri}`);
  msg.get_request_headers().append("Authorization", `Bearer ${accessToken}`);

  try {
    let response;
    try {
      response = await new Promise((resolve, reject) => {
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (_session, result) => {
          try {
            resolve(session.send_and_read_finish(result));
          } catch (e) {
            reject(e);
          }
        });
      });
    } catch {
      throw new SpotifyError("network");
    }
    const status = msg.get_status();
    if (status !== 200) {
      const code = { 401: "unauthorized", 403: "forbidden", 429: "rate-limited" }[status] || "http";
      const retryAfter = status === 429
        ? msg.get_response_headers().get_one("Retry-After") : null;
      throw new SpotifyError(code, status, retryAfter);
    }
    if (method !== "GET") return true;
    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(response.get_data()));
    } catch {
      throw new SpotifyError("invalid-response");
    }
    if (!Array.isArray(data) || data.length !== 1 || typeof data[0] !== "boolean") {
      throw new SpotifyError("invalid-response");
    }
    return data[0];
  } finally {
    activeSessions.delete(session);
  }
}

export async function isTrackLiked(trackId) {
  return libraryRequest("GET", trackId);
}

export async function likeTrack(trackId) {
  return libraryRequest("PUT", trackId);
}

export async function unlikeTrack(trackId) {
  return libraryRequest("DELETE", trackId);
}

export async function toggleLike(trackId) {
  const isLiked = await isTrackLiked(trackId);
  if (isLiked) {
    await unlikeTrack(trackId);
    return false;
  } else {
    await likeTrack(trackId);
    return true;
  }
}

export function cleanupSpotify() {
  for (const session of activeSessions) {
    session.abort();
  }
  logInfo("Active helper sessions cleared");
  activeSessions.clear();
}
