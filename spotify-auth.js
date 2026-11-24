import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Soup from "gi://Soup";
import Secret from "gi://Secret";

import { buildQueryString, logError, logInfo } from "./utils.js";

let tokenCache = {
  accessToken: null,
  expiresAt: null,
};

let CLIENT_ID = null;
let PORT = 9000;
let REDIRECT_URI = null;
let settings = null;

let settingsSignalIds = [];
let authGeneration = 0;

export class SpotifyError extends Error {
  constructor(code, status = null, retryAfter = null) {
    super(`Spotify request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function initializeAuth(settingsInstance) {
  cleanupSpotifyAuth();
  settings = settingsInstance;

  const updateConfiguration = () => {
    CLIENT_ID = settings.get_string("spotify-client-id").trim() || null;
    PORT = settings.get_int("spotify-callback-port");
    if (PORT <= 0 || PORT > 65535) PORT = 9000;
    REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
    tokenCache = { accessToken: null, expiresAt: null };
    authGeneration++;
  };
  updateConfiguration();
  settingsSignalIds = [
    settings.connect("changed::spotify-client-id", updateConfiguration),
    settings.connect("changed::spotify-callback-port", updateConfiguration),
  ];
}

let activeSessions = new Set();

export function generatePKCE() {
  const verifierBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    verifierBytes[i] = GLib.random_int_range(0, 256);
  }

  const verifierBase64 = GLib.base64_encode(verifierBytes);
  const verifier = verifierBase64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const checksum = new GLib.Checksum(GLib.ChecksumType.SHA256);

  const verifierUtf8 = new TextEncoder().encode(verifier);
  checksum.update(verifierUtf8);

  const digestHex = checksum.get_string();

  const digestBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    digestBytes[i] = parseInt(digestHex.substr(i * 2, 2), 16);
  }

  const challengeBase64 = GLib.base64_encode(digestBytes);
  const challenge = challengeBase64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return { verifier, challenge };
}

export function startCallbackServer(onCode, onError) {
  try {
    const service = new Gio.SocketService();
    const address = new Gio.InetSocketAddress({
      address: Gio.InetAddress.new_from_string("127.0.0.1"),
      port: PORT,
    });

    try {
      service.add_address(
        address,
        Gio.SocketType.STREAM,
        Gio.SocketProtocol.TCP,
        null,
      );
    } catch (e) {
      if (onError) {
        onError(
          new Error(
            `Port ${PORT} is already in use. Please choose a different port in settings or close the application using it.`,
          ),
        );
      }
      return;
    }

    service.connect("incoming", (_svc, connection) => {
      const input = connection.get_input_stream();
      const data = input.read_bytes(4096, null).toArray();
      const request = new TextDecoder().decode(data);
      const match = request.match(/GET \/callback\?code=([^&\s]+)/);
      if (match) {
        onCode(match[1]);
      }
      const output = connection.get_output_stream();
      const responseText = `HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<h2>Gspotify: You can close this window.</h2>`;
      const responseBytes = new TextEncoder().encode(responseText);
      output.write_all(responseBytes, null);
      connection.close(null);
      service.stop();
      return true;
    });
    service.start();
  } catch (e) {
    logError(`Failed to start callback server: ${e.message}`);
    if (onError) {
      onError(e);
    }
  }
}
export function openSpotifyAuth(challenge) {
  if (!CLIENT_ID) {
    logError("Missing client id, please set it in settings");
    return;
  }

  let scopeString = null;
  if (settings) {
    try {
      scopeString = settings.get_string("spotify-scopes");
    } catch (e) {
      logError(`Failed to load saved scopes: ${e.message}`);
    }
  }

  if (!scopeString || scopeString.trim() === "") {
    scopeString = "user-library-read user-library-modify";
  }

  const params = {
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: scopeString,
  };
  const queryString = buildQueryString(params);
  const url = `https://accounts.spotify.com/authorize?${queryString}`;
  Gio.AppInfo.launch_default_for_uri(url, null);
}

export async function exchangeCode(code, verifier) {
  const bodyString = buildQueryString({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const session = new Soup.Session();
  activeSessions.add(session);

  const msg = Soup.Message.new(
    "POST",
    "https://accounts.spotify.com/api/token",
  );

  const bodyBytes = new TextEncoder().encode(bodyString);
  const bytes = new GLib.Bytes(bodyBytes);

  msg.set_request_body_from_bytes("application/x-www-form-urlencoded", bytes);

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

    return JSON.parse(new TextDecoder().decode(response.get_data()));
  } finally {
    activeSessions.delete(session);
  }
}

function getRefreshTokenSchema() {
  return new Secret.Schema(
    "io.github.gspotify.sxoxgxi",
    Secret.SchemaFlags.NONE,
    {
      refresh_token: Secret.SchemaAttributeType.STRING,
    },
  );
}

export function storeRefreshToken(token) {
  const schema = getRefreshTokenSchema();
  return new Promise((resolve, reject) => {
    Secret.password_store(
      schema,
      { refresh_token: "spotify" },
      Secret.COLLECTION_DEFAULT,
      "GSpotify Spotify Refresh Token",
      token,
      null,
      (source, result) => {
        try {
          const success = Secret.password_store_finish(result);
          resolve(success);
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

export function getRefreshToken() {
  const schema = getRefreshTokenSchema();
  return new Promise((resolve, reject) => {
    Secret.password_lookup(
      schema,
      { refresh_token: "spotify" },
      null,
      (source, result) => {
        try {
          const password = Secret.password_lookup_finish(result);
          resolve(password);
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

export function deleteRefreshToken() {
  const schema = getRefreshTokenSchema();
  return new Promise((resolve, reject) => {
    Secret.password_clear(
      schema,
      { refresh_token: "spotify" },
      null,
      (source, result) => {
        try {
          const success = Secret.password_clear_finish(result);
          resolve(success);
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

function getAccessTokenSchema() {
  return new Secret.Schema(
    "io.github.gspotify.access",
    Secret.SchemaFlags.NONE,
    {
      access_token: Secret.SchemaAttributeType.STRING,
    },
  );
}

export function storeAccessToken(token, expiresIn) {
  tokenCache.accessToken = token;
  tokenCache.expiresAt = Date.now() + (expiresIn - 60) * 1000;

  const schema = getAccessTokenSchema();
  return new Promise((resolve, reject) => {
    const tokenData = JSON.stringify({
      token,
      expiresAt: tokenCache.expiresAt,
    });

    Secret.password_store(
      schema,
      { access_token: "spotify" },
      Secret.COLLECTION_DEFAULT,
      "GSpotify Spotify Access Token",
      tokenData,
      null,
      (source, result) => {
        try {
          const success = Secret.password_store_finish(result);
          resolve(success);
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

export function getStoredAccessToken() {
  const generation = authGeneration;
  const schema = getAccessTokenSchema();
  return new Promise((resolve, reject) => {
    Secret.password_lookup(
      schema,
      { access_token: "spotify" },
      null,
      (source, result) => {
        try {
          const password = Secret.password_lookup_finish(result);
          if (password && generation === authGeneration) {
            const data = JSON.parse(password);
            if (data.expiresAt && Date.now() < data.expiresAt) {
              tokenCache.accessToken = data.token;
              tokenCache.expiresAt = data.expiresAt;
              resolve(data.token);
            } else {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      },
    );
  });
}

export function clearAccessToken() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt = null;

  const schema = getAccessTokenSchema();
  return new Promise((resolve, reject) => {
    Secret.password_clear(
      schema,
      { access_token: "spotify" },
      null,
      (source, result) => {
        try {
          const success = Secret.password_clear_finish(result);
          resolve(success);
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

export async function getValidAccessToken() {
  const generation = authGeneration;
  if (
    tokenCache.accessToken &&
    tokenCache.expiresAt &&
    Date.now() < tokenCache.expiresAt
  ) {
    return tokenCache.accessToken;
  }

  const storedToken = await getStoredAccessToken();
  if (generation !== authGeneration) throw new SpotifyError("cancelled");
  if (storedToken) {
    return storedToken;
  }

  const refreshToken = await getRefreshToken();
  if (generation !== authGeneration) throw new SpotifyError("cancelled");
  if (!refreshToken) throw new SpotifyError("not-authenticated");
  if (!CLIENT_ID) throw new SpotifyError("missing-client-id");

  const tokenData = await getAccessTokenFromRefresh(refreshToken);

  if (generation !== authGeneration) throw new SpotifyError("cancelled");
  await storeAccessToken(tokenData.access_token, tokenData.expires_in || 3600);

  if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
    await storeRefreshToken(tokenData.refresh_token);
  }

  return tokenData.access_token;
}

async function getAccessTokenFromRefresh(refreshToken) {
  const session = new Soup.Session();
  activeSessions.add(session);

  const msg = Soup.Message.new(
    "POST",
    "https://accounts.spotify.com/api/token",
  );

  const bodyString = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${encodeURIComponent(CLIENT_ID)}`;
  const bodyBytes = new TextEncoder().encode(bodyString);
  const bytes = new GLib.Bytes(bodyBytes);

  msg.set_request_body_from_bytes("application/x-www-form-urlencoded", bytes);

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
            reject(new SpotifyError("network"));
          }
        },
      );
    });

    const statusCode = msg.get_status();
    const responseText = new TextDecoder().decode(response.get_data());

    if (statusCode !== 200) {
      const code = { 401: "unauthorized", 403: "forbidden", 429: "rate-limited" }[statusCode]
        || (statusCode >= 500 ? "http" : "refresh-failed");
      throw new SpotifyError(code, statusCode);
    }
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new SpotifyError("invalid-response");
    }
    if (!data || data.error || typeof data.access_token !== "string" || !data.access_token) {
      throw new SpotifyError("refresh-failed", statusCode);
    }

    return data;
  } finally {
    activeSessions.delete(session);
  }
}
export function cleanupSpotifyAuth() {
  authGeneration++;
  for (const id of settingsSignalIds) settings.disconnect(id);
  settingsSignalIds = [];
  settings = null;
  CLIENT_ID = null;
  REDIRECT_URI = null;
  for (const session of activeSessions) {
    session.abort();
  }
  activeSessions.clear();
  logInfo("Active auth sessions cleared");

  tokenCache.accessToken = null;
  tokenCache.expiresAt = null;
}
