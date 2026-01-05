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
import { logError } from "../utils.js";
import { createOpenURLButton } from "./prefs_utils.js";
import { scopes } from "../constants.js";

export function buildSpotifyPage(window, settings) {
  const spotifyPage = new Adw.PreferencesPage({
    title: "Spotify",
    icon_name: "dialog-password-symbolic",
  });

  const helpGroup = new Adw.PreferencesGroup({
    title: "Getting Started",
    description: "If you are new to Spotify Web API configuration",
  });

  const infoRow = new Adw.ActionRow({
    title: "Why to Provide Own Credentials?",
    subtitle: "This sums up Spotify’s API quota extension update",
  });

  const helpRow = new Adw.ActionRow({
    title: "Spotify App Credentials",
    subtitle: "Click here to open docs for getting your credentials",
  });

  const spotifyInfoButton = createOpenURLButton(
    "https://community.spotify.com/t5/Spotify-for-Developers/Updating-the-Criteria-for-Web-API-Extended-Access/m-p/6948230/highlight/true#M17776",
  );
  const spotifyHelpButton = createOpenURLButton(
    "https://developer.spotify.com/documentation/web-api/concepts/apps",
  );
  infoRow.add_suffix(spotifyInfoButton);
  infoRow.activatable_widget = spotifyInfoButton;
  helpRow.add_suffix(spotifyHelpButton);
  helpRow.activatable_widget = spotifyHelpButton;

  helpGroup.add(infoRow);
  helpGroup.add(helpRow);

  const advancedGroup = new Adw.PreferencesGroup({
    title: "Spotify App Setup",
    description: "Configure your Spotify App credentials first",
  });

  const clientIdRow = new Adw.EntryRow({
    title: "Client ID",
    show_apply_button: true,
  });

  const callbackPortRow = new Adw.SpinRow({
    title: "Callback Port",
    subtitle: "Local port for OAuth callback (1024-65535)",
    adjustment: new Gtk.Adjustment({
      lower: 1024,
      upper: 65535,
      step_increment: 1,
      page_increment: 10,
      value: 8888,
    }),
  });

  const redirectUriRow = new Adw.ActionRow({
    title: "Redirect URI",
  });

  const redirectUriLabel = new Gtk.Label({
    label: "http://127.0.0.1:8888/callback",
    selectable: true,
    css_classes: ["monospace"],
    valign: Gtk.Align.CENTER,
  });

  const copyButton = new Gtk.Button({
    icon_name: "edit-copy-symbolic",
    valign: Gtk.Align.CENTER,
    tooltip_text: "Copy to clipboard",
  });

  function updateRedirectUri() {
    const port = callbackPortRow.get_value();
    const uri = `http://127.0.0.1:${port}/callback`;
    redirectUriLabel.set_label(uri);
  }

  copyButton.connect("clicked", () => {
    const clipboard = window.get_clipboard();
    clipboard.set(redirectUriLabel.get_label());

    const toast = new Adw.Toast({
      title: "Copied, now paste it into your Spotify app",
      timeout: 3,
    });
    window.add_toast(toast);
  });

  redirectUriRow.add_suffix(redirectUriLabel);
  redirectUriRow.add_suffix(copyButton);

  const scopesExpander = new Adw.ExpanderRow({
    title: "OAuth Scopes",
    subtitle: "Select permissions for Spotify API access",
  });

  const scopeCheckboxes = new Map();

  scopes.forEach((scope) => {
    const scopeRow = new Adw.ActionRow({
      title: scope.id,
      subtitle: scope.label,
      activatable: true,
    });

    const checkButton = new Gtk.CheckButton({
      active: scope.default,
      valign: Gtk.Align.CENTER,
    });

    scopeRow.add_suffix(checkButton);
    scopeRow.set_activatable_widget(checkButton);

    scopesExpander.add_row(scopeRow);
    scopeCheckboxes.set(scope.id, checkButton);

    checkButton.connect("toggled", () => saveScopes());
  });

  function getSelectedScopes() {
    const selected = [];
    scopes.forEach((scope) => {
      const checkbox = scopeCheckboxes.get(scope.id);
      if (checkbox.get_active()) {
        selected.push(scope.id);
      }
    });
    return selected.join(" ");
  }

  function saveScopes() {
    const scopeString = getSelectedScopes();
    settings.set_string("spotify-scopes", scopeString);
  }

  function loadScopes() {
    try {
      const savedScopes = settings.get_string("spotify-scopes");
      if (savedScopes && savedScopes.trim() !== "") {
        const scopeArray = savedScopes.split(" ");

        scopeCheckboxes.forEach((checkbox) => {
          checkbox.set_active(false);
        });

        scopeArray.forEach((scopeId) => {
          const checkbox = scopeCheckboxes.get(scopeId);
          if (checkbox) {
            checkbox.set_active(true);
          }
        });
      }
    } catch (e) {
      logError(`Failed to load saved scopes: ${e.message}`);
    }
  }

  const spotifyGroup = new Adw.PreferencesGroup({
    title: "Spotify Connection",
    description: "Connect your Spotify account",
    visible: false,
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

  function updateUIVisibility() {
    const clientId = settings.get_string("spotify-client-id");
    const hasClientId =
      clientId && clientId.length > 0 && clientId !== "YOUR_SPOTIFY_CLIENT_ID";

    spotifyGroup.set_visible(hasClientId);

    if (hasClientId) {
      clientIdRow.set_text(clientId);
    } else {
      clientIdRow.set_text("Paste your Client ID here");
    }
  }

  const savedPort = settings.get_int("spotify-callback-port");
  if (savedPort >= 1024 && savedPort <= 65535) {
    callbackPortRow.set_value(savedPort);
  }
  updateRedirectUri();

  clientIdRow.connect("apply", () => {
    const clientId = clientIdRow.get_text().trim();
    if (clientId) {
      settings.set_string("spotify-client-id", clientId);

      const toast = new Adw.Toast({
        title: "Client ID saved - You can now connect to Spotify",
        timeout: 3,
      });
      window.add_toast(toast);

      updateUIVisibility();
    }
  });

  callbackPortRow.connect("changed", () => {
    const port = callbackPortRow.get_value();
    updateRedirectUri();
    settings.set_int("spotify-callback-port", port);
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

        startCallbackServer(
          async (code) => {
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
          },
          (error) => {
            const errorDialog = new Adw.MessageDialog({
              transient_for: window,
              heading: "Port Already in Use",
              body: error.message,
            });
            errorDialog.add_response("ok", "OK");
            errorDialog.set_response_appearance(
              "ok",
              Adw.ResponseAppearance.DESTRUCTIVE,
            );
            errorDialog.present();
          },
        );

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
        body: "Spotify returned an invalid response when validating your session.",
      });
      errorDialog.add_response("ok", "OK");
      errorDialog.set_response_appearance(
        "ok",
        Adw.ResponseAppearance.DESTRUCTIVE,
      );
      logError(`Error validating connection: ${e.message}`);
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

  advancedGroup.add(clientIdRow);
  advancedGroup.add(callbackPortRow);
  advancedGroup.add(redirectUriRow);
  advancedGroup.add(scopesExpander);

  spotifyPage.add(helpGroup);
  spotifyPage.add(advancedGroup);
  spotifyPage.add(spotifyGroup);

  updateUIVisibility();
  updateConnectionStatus();
  loadScopes();

  return spotifyPage;
}
