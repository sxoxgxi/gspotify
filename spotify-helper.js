import Soup from "gi://Soup?version=3.0";
import GLib from "gi://GLib";

export async function getSpotifyUsername(accessToken) {
  const session = new Soup.Session();
  const msg = Soup.Message.new("GET", "https://api.spotify.com/v1/me");

  msg.get_request_headers().append("Authorization", `Bearer ${accessToken}`);

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
}
