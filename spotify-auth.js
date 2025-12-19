import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Soup from "gi://Soup?version=3.0";
import Secret from "gi://Secret";

import { buildQueryString } from "./utils.js";

const CLIENT_ID = "48fee64225164274a00562eff58100b5";
const PORT = 9000;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

let tokenCache = {
  accessToken: null,
  expiresAt: null,
};

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
  checksum.update(verifierUtf8, verifierUtf8.length);

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

export function startCallbackServer(onCode) {
  const service = new Gio.SocketService();
  const address = new Gio.InetSocketAddress({
    address: Gio.InetAddress.new_from_string("127.0.0.1"),
    port: PORT,
  });
  service.add_address(
    address,
    Gio.SocketType.STREAM,
    Gio.SocketProtocol.TCP,
    null,
  );
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
}

export function openSpotifyAuth(challenge) {
  const params = {
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: "",
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
  const msg = Soup.Message.new(
    "POST",
    "https://accounts.spotify.com/api/token",
  );

  const bodyBytes = new TextEncoder().encode(bodyString);
  const bytes = new GLib.Bytes(bodyBytes);

  msg.set_request_body_from_bytes("application/x-www-form-urlencoded", bytes);

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
}

const schema = new Secret.Schema(
  "io.github.gspotify.sxoxgxi",
  Secret.SchemaFlags.NONE,
  {
    refresh_token: Secret.SchemaAttributeType.STRING,
  },
);

export function storeRefreshToken(token) {
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

const ACCESS_TOKEN_SCHEMA = new Secret.Schema(
  "io.github.gspotify.access",
  Secret.SchemaFlags.NONE,
  {
    access_token: Secret.SchemaAttributeType.STRING,
  },
);

export function storeAccessToken(token, expiresIn) {
  tokenCache.accessToken = token;
  tokenCache.expiresAt = Date.now() + (expiresIn - 60) * 1000;

  return new Promise((resolve, reject) => {
    const tokenData = JSON.stringify({
      token,
      expiresAt: tokenCache.expiresAt,
    });

    Secret.password_store(
      ACCESS_TOKEN_SCHEMA,
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
  return new Promise((resolve, reject) => {
    Secret.password_lookup(
      ACCESS_TOKEN_SCHEMA,
      { access_token: "spotify" },
      null,
      (source, result) => {
        try {
          const password = Secret.password_lookup_finish(result);
          if (password) {
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

  return new Promise((resolve, reject) => {
    Secret.password_clear(
      ACCESS_TOKEN_SCHEMA,
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
  if (
    tokenCache.accessToken &&
    tokenCache.expiresAt &&
    Date.now() < tokenCache.expiresAt
  ) {
    return tokenCache.accessToken;
  }

  const storedToken = await getStoredAccessToken();
  if (storedToken) {
    return storedToken;
  }

  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    throw new Error("No refresh token found");
  }

  const tokenData = await getAccessTokenFromRefresh(refreshToken);

  await storeAccessToken(tokenData.access_token, tokenData.expires_in || 3600);

  if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
    await storeRefreshToken(tokenData.refresh_token);
  }

  return tokenData.access_token;
}

async function getAccessTokenFromRefresh(refreshToken) {
  const session = new Soup.Session();
  const msg = Soup.Message.new(
    "POST",
    "https://accounts.spotify.com/api/token",
  );

  const bodyString = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${CLIENT_ID}`;
  const bodyBytes = new TextEncoder().encode(bodyString);
  const bytes = new GLib.Bytes(bodyBytes);

  msg.set_request_body_from_bytes("application/x-www-form-urlencoded", bytes);

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

  if (data.error) {
    throw new Error(
      `Spotify API error: ${data.error} - ${data.error_description || ""}`,
    );
  }

  return data;
}
