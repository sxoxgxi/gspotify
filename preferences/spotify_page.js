import Adw from "gi://Adw";
import Gtk from "gi://Gtk";

import { getSpotifyUsername } from "../spotify-helper.js";
import {
  storeRefreshToken,
  generatePKCE,
  exchangeCode,
  openSpotifyAuth,
  startCallbackServer,
  getRefreshToken,
  deleteRefreshToken,
  clearAccessToken,
} from "../spotify-auth.js";

export function buildSpotifyPage(window) {
  const spotifyPage = new Adw.PreferencesPage({
    title: "Spotify",
    icon_name: "dialog-password-symbolic",
  });

  const spotifyGroup = new Adw.PreferencesGroup({
    title: "Settings for Spotify",
    description:
      "Everything you need to configure GSpotify to work with your Spotify account",
  });

  const connectRow = new Adw.ActionRow({
    title: "Connect to Spotify",
    subtitle: "Allow Gspotify to connect to Spotify via Spotify Web API",
    activatable: true,
  });

  const connectButton = new Gtk.Button({
    icon_name: "send-to-symbolic",
    valign: Gtk.Align.CENTER,
    css_classes: ["suggested-action"],
  });

  const disconnectButton = new Gtk.Button({
    label: "Disconnect",
    valign: Gtk.Align.CENTER,
    css_classes: ["destructive-action"],
  });

  const testRow = new Adw.ActionRow({
    title: "Test Connection",
    subtitle: "Check if your Spotify token is still valid",
    activatable: true,
    visible: false,
  });

  const testButton = new Gtk.Button({
    icon_name: "network-wireless-symbolic",
    valign: Gtk.Align.CENTER,
  });

  const testSpinner = new Gtk.Spinner({
    valign: Gtk.Align.CENTER,
  });

  async function updateConnectionStatus() {
    try {
      const refreshToken = await getRefreshToken();
      if (refreshToken) {
        connectRow.set_title("Connected to Spotify");
        connectRow.set_subtitle("Your account is linked");

        connectRow.remove(connectButton);
        connectRow.add_suffix(disconnectButton);
        connectRow.activatable_widget = disconnectButton;

        testRow.set_visible(true);
      } else {
        connectRow.set_title("Connect to Spotify");
        connectRow.set_subtitle(
          "Allow Gspotify to connect to Spotify via Spotify Web API",
        );
        connectRow.remove(disconnectButton);
        connectRow.add_suffix(connectButton);
        connectRow.activatable_widget = connectButton;

        testRow.set_visible(false);
      }
    } catch (e) {
      connectRow.set_title("Connect to Spotify");
      connectRow.set_subtitle(
        "Allow Gspotify to connect to Spotify via Spotify Web API",
      );
      connectRow.remove(disconnectButton);
      connectRow.add_suffix(connectButton);
      connectRow.activatable_widget = connectButton;

      testRow.set_visible(false);
    }
  }

  connectButton.connect("clicked", () => {
    const dialog = new Adw.MessageDialog({
      transient_for: window,
      heading: "Connect Spotify",
      body: "This will connect GSpotify to your Spotify account via the web interface.",
    });

    dialog.add_response("cancel", "Cancel");
    dialog.add_response("connect", "Connect");
    dialog.set_response_appearance("connect", Adw.ResponseAppearance.SUGGESTED);

    dialog.connect("response", (self, response) => {
      if (response === "connect") {
        const { verifier, challenge } = generatePKCE();

        startCallbackServer(async (code) => {
          try {
            const tokens = await exchangeCode(code, verifier);
            await storeRefreshToken(tokens.refresh_token);

            const successDialog = new Adw.MessageDialog({
              transient_for: window,
              heading: "Connection Successful",
              body: "Token saved successfully on your system.",
            });
            successDialog.add_response("ok", "OK");
            successDialog.connect("response", () => {
              updateConnectionStatus();
            });
            successDialog.present();
          } catch (e) {
            const errorDialog = new Adw.MessageDialog({
              transient_for: window,
              heading: "Error",
              body: `Failed to connect to Spotify: ${e.message}`,
            });
            errorDialog.add_response("ok", "OK");
            errorDialog.present();
          }
        });

        openSpotifyAuth(challenge);
      }
    });

    dialog.present();
  });

  disconnectButton.connect("clicked", () => {
    const dialog = new Adw.MessageDialog({
      transient_for: window,
      heading: "Disconnect from Spotify",
      body: "Are you sure you want to disconnect your Spotify account?",
    });

    dialog.add_response("cancel", "Cancel");
    dialog.add_response("disconnect", "Disconnect");
    dialog.set_response_appearance(
      "disconnect",
      Adw.ResponseAppearance.DESTRUCTIVE,
    );

    dialog.connect("response", async (self, response) => {
      if (response === "disconnect") {
        try {
          await deleteRefreshToken();
          await clearAccessToken();
          updateConnectionStatus();
        } catch (e) {
          const errorDialog = new Adw.MessageDialog({
            transient_for: window,
            heading: "Error",
            body: `Failed to disconnect: ${e.message}`,
          });
          errorDialog.add_response("ok", "OK");
          errorDialog.present();
        }
      }
    });

    dialog.present();
  });

  testButton.connect("clicked", async () => {
    testRow.remove(testButton);
    testRow.add_suffix(testSpinner);
    testSpinner.start();
    testRow.set_subtitle("Testing connection...");

    try {
      const username = await getSpotifyUsername();

      testRow.set_subtitle(`✓ Connected as ${username}`);

      const successDialog = new Adw.MessageDialog({
        transient_for: window,
        heading: "Connection Valid",
        body: `Your Spotify account is connected and working.\n\nLogged in as: ${username}`,
      });
      successDialog.add_response("ok", "OK");
      successDialog.present();
    } catch (e) {
      testRow.set_subtitle("✗ Connection failed - please reconnect");

      const errorDialog = new Adw.MessageDialog({
        transient_for: window,
        heading: "Connection Invalid",
        body: `Your Spotify token is invalid or expired.\n\nError: ${e.message}\n\nPlease disconnect and reconnect your account.`,
      });
      errorDialog.add_response("ok", "OK");
      errorDialog.set_response_appearance(
        "ok",
        Adw.ResponseAppearance.DESTRUCTIVE,
      );
      errorDialog.present();
    } finally {
      testSpinner.stop();
      testRow.remove(testSpinner);
      testRow.add_suffix(testButton);
    }
  });

  connectRow.add_suffix(connectButton);
  connectRow.activatable_widget = connectButton;

  testRow.add_suffix(testButton);
  testRow.activatable_widget = testButton;

  spotifyGroup.add(connectRow);
  spotifyGroup.add(testRow);
  spotifyPage.add(spotifyGroup);

  updateConnectionStatus();

  return spotifyPage;
}
