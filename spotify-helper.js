import Soup from "gi://Soup";
import GLib from "gi://GLib";
import { logInfo } from "./utils.js";
import { getValidAccessToken } from "./spotify-auth.js";

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

export async function isTrackLiked(trackId) {
  const accessToken = await getValidAccessToken();
  const session = new Soup.Session();
  activeSessions.add(session);

  const url = `${API_ENDPOINT}/me/tracks/contains?ids=${trackId}`;
  const msg = Soup.Message.new("GET", url);
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
    return data[0] === true;
  } finally {
    activeSessions.delete(session);
  }
}

export async function likeTrack(trackId) {
  const accessToken = await getValidAccessToken();
  const session = new Soup.Session();
  activeSessions.add(session);

  const url = `${API_ENDPOINT}/me/tracks?ids=${trackId}`;
  const msg = Soup.Message.new("PUT", url);
  msg.get_request_headers().append("Authorization", `Bearer ${accessToken}`);
  msg.get_request_headers().append("Content-Type", "application/json");

  const bodyBytes = new TextEncoder().encode("{}");
  const bytes = new GLib.Bytes(bodyBytes);
  msg.set_request_body_from_bytes("application/json", bytes);

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

    const statusCode = msg.get_status();
    if (statusCode === 200) {
      logInfo("Track liked successfully:", trackId);
      return true;
    } else {
      throw new Error(`Failed to like track: ${statusCode}`);
    }
  } finally {
    activeSessions.delete(session);
  }
}

export async function unlikeTrack(trackId) {
  const accessToken = await getValidAccessToken();
  const session = new Soup.Session();
  activeSessions.add(session);

  const url = `${API_ENDPOINT}/me/tracks?ids=${trackId}`;
  const msg = Soup.Message.new("DELETE", url);
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

    const statusCode = msg.get_status();
    if (statusCode === 200) {
      logInfo("Track unliked successfully:", trackId);
      return true;
    } else {
      throw new Error(`Failed to unlike track: ${statusCode}`);
    }
  } finally {
    activeSessions.delete(session);
  }
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
