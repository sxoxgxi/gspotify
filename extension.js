import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as Config from "resource:///org/gnome/shell/misc/config.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { SpotifyDBus } from "./dbus-parser.js";
import { SpotifyUI } from "./spotui.js";
import { SpotDLExecutor } from "./spotdl.js";
import { getStatusSymbol, toggleSpotifyWindow } from "./utils.js";
import { logInfo, logWarn, logError } from "./utils.js";
import { destroyStatsManager } from "./stats.js";
import { cleanupSpotify, isSpotifyLoggedIn } from "./spotify-helper.js";
import { cleanupSpotifyAuth } from "./spotify-auth.js";

const SHELL_VERSION = parseFloat(Config.PACKAGE_VERSION);

const SpotifyIndicator = GObject.registerClass(
  class SpotifyIndicator extends PanelMenu.Button {
    _init(extension, panelPosition = 0) {
      super._init(0.5, "Spotify Indicator", false);
      this._extension = extension;
      this._panelPosition = panelPosition;
      this._dbus = new SpotifyDBus(this);
      this._volumeTimeout = null;

      this._ui = new SpotifyUI(this, extension, (dominantColor) => {
        this._onColorUpdate(dominantColor);
      });

      this._spotdl = new SpotDLExecutor();

      this._label = new St.Label({
        text: "Spotify",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.add_child(this._label);
      this.menu.box.add_child(this._ui.container);

      this.updateLabel();
      this.connect("scroll-event", this._handleScrollEvent.bind(this));
    }

    _onColorUpdate(dominantColor) {
      if (dominantColor) {
        this.menu.box.style = `background-color: rgb(${dominantColor.r}, ${dominantColor.g}, ${dominantColor.b});`;
      }
    }

    _handleScrollEvent(actor, event) {
      const volumeStep = this._extension._settings.get_double("volume-step");
      const invertScroll =
        this._extension._settings.get_boolean("invert-scroll");
      const direction = event.get_scroll_direction();
      let newVol = null;

      if (direction === Clutter.ScrollDirection.UP)
        newVol =
          this._dbus[invertScroll ? "decreaseVolume" : "increaseVolume"](
            volumeStep,
          );
      else if (direction === Clutter.ScrollDirection.DOWN)
        newVol =
          this._dbus[invertScroll ? "increaseVolume" : "decreaseVolume"](
            volumeStep,
          );

      if (newVol !== null) {
        this._label.text = `Current Volume: ${Math.round(newVol * 100)}%`;

        if (this._volumeTimeout) GLib.Source.remove(this._volumeTimeout);

        this._volumeTimeout = GLib.timeout_add(
          GLib.PRIORITY_DEFAULT,
          1000,
          () => {
            this.updateLabel();
            this._volumeTimeout = null;
            return GLib.SOURCE_REMOVE;
          },
        );

        return Clutter.EVENT_STOP;
      }
    }

    updateLabel(overridePosition) {
      if (!this._dbus) {
        return;
      }
      const labelLength = this._extension._settings.get_int("label-length");
      const showArtist = this._extension._settings.get_boolean("show-artist");
      const metadata = this._dbus.getMetadata();

      this._settingsChangedId =
      this._extension._settings.connect("changed::show-artist", () => {
        this.updateLabel();
      });

      if (overridePosition) {
        metadata.position_ms = overridePosition.position_ms;
      }

      if (metadata.success && metadata.title && (!showArtist || metadata.artist)) {
        const displayText = showArtist ? `${metadata.artist}    |    ${metadata.title}` : `${metadata.title}`;
        this._label.text =
          displayText.length > labelLength
            ? displayText.substring(0, labelLength - 3) + "..."
            : displayText;

        this._ui._checkSpotifyConnection();
        this._ui.update(metadata);
      } else {
        this._label.text = "Spotify";
        this._ui.update(null);
      }
    }

    destroy() {
      if (this._dbus) {
        this._dbus.destroy();
        this._dbus = null;
      }
      this._ui.destroy();
      this._ui = null;
      this._spotdl.destroy();

      if (this._volumeTimeout) {
        GLib.Source.remove(this._volumeTimeout);
        this._volumeTimeout = null;
      }

      super.destroy();
    }
  },
);

const IconIndicator = GObject.registerClass(
  class IconIndicator extends PanelMenu.Button {
    _init(extension, panelPosition = 0) {
      super._init(0.5, "Icon Indicator", false);
      this._extension = extension;
      this._panelPosition = panelPosition;

      this._icon = new St.Icon({
        gicon: Gio.Icon.new_for_string(
          `${this._extension.path}/icons/spotify-symbolic.svg`,
        ),
        icon_size: 20,
      });
      this.add_child(this._icon);
      this.connect("button-press-event", this._openSpotify.bind(this));
    }

    _openSpotify() {
      const openMinimize = this._extension._settings.get_boolean(
        "open-spotify-minimized",
      );

      const apps = Gio.AppInfo.get_all();
      const spotifyApp = apps.find((app) => {
        const name = app.get_name().toLowerCase();
        const id = app.get_id()?.toLowerCase() || "";
        return name.includes("spotify") || id.includes("spotify");
      });

      if (!spotifyApp) {
        logInfo("Spotify app not found");
        return;
      }

      try {
        spotifyApp.launch([], null);
        logInfo("Launching Spotify...");

        if (openMinimize) {
          this._extension.scheduleSpotifyMinimize();
        }
      } catch (e) {
        logError("Failed to launch Spotify: " + e);
      }
    }

    destroy() {
      super.destroy();
    }
  },
);

export default class SpotifyExtension extends Extension {
  enable() {
    this._indicator = null;
    this._iconIndicator = null;
    this._watcherId = null;
    this._minimizeTimeout = null;

    this._settings = this.getSettings();

    this._settingsHandlerId = this._settings.connect(
      "changed::panel-position",
      () => {
        this._onPanelPositionChanged();
      },
    );

    this._presistSettingsHandlerId = this._settings.connect(
      "changed::presist-indicator",
      () => {
        this._onPresistIndicatorChanged();
      },
    );

    this._labelLengthHandlerId = this._settings.connect(
      "changed::label-length",
      () => {
        this._onLabelLengthChanged();
      },
    );

    this._watcherId = Gio.bus_watch_name(
      Gio.BusType.SESSION,
      "org.mpris.MediaPlayer2.spotify",
      Gio.BusNameWatcherFlags.NONE,
      this._onSpotifyAppeared.bind(this),
      this._onSpotifyVanished.bind(this),
    );

    this._controlOrderHandlerId = this._settings.connect(
      "changed::additional-controls-order",
      () => {
        this._checkSpotifyLoginStatus();
      },
    );

    this._checkSpotifyLoginStatus();

    const presistIndicator = this._settings.get_boolean("presist-indicator");
    if (presistIndicator && !this._indicator) {
      this._createIndicator(true);
    }
  }

  disable() {
    this._clearMinimizeTimeout();

    if (this._settingsHandlerId) {
      this._settings.disconnect(this._settingsHandlerId);
      this._settingsHandlerId = null;
    }

    if (this._presistSettingsHandlerId) {
      this._settings.disconnect(this._presistSettingsHandlerId);
      this._presistSettingsHandlerId = null;
    }

    if (this._labelLengthHandlerId) {
      this._settings.disconnect(this._labelLengthHandlerId);
      this._labelLengthHandlerId = null;
    }

    if (this._controlOrderHandlerId) {
      this._settings.disconnect(this._controlOrderHandlerId);
      this._controlOrderHandlerId = null;
    }

    if (this._watcherId) {
      Gio.bus_unwatch_name(this._watcherId);
      this._watcherId = null;
    }

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    destroyStatsManager();
    cleanupSpotify();
    cleanupSpotifyAuth();

    if (this._iconIndicator) {
      this._iconIndicator.destroy();
      this._iconIndicator = null;
    }

    if (this._settings) {
      this._settings = null;
    }
  }

  _getPanelPosition() {
    if (!this._settings) return 0;
    return this._settings.get_int("panel-position");
  }

  _onPanelPositionChanged() {
    if (this._indicator) {
      this._recreateIndicator(false);
    } else if (this._iconIndicator) {
      this._recreateIndicator(true);
    }
  }

  _onPresistIndicatorChanged() {
    const presistIndicator = this._settings.get_boolean("presist-indicator");

    if (!this._indicator) {
      if (presistIndicator && !this._iconIndicator) {
        this._createIndicator(true);
      } else if (!presistIndicator && this._iconIndicator) {
        this._iconIndicator.destroy();
        this._iconIndicator = null;
      }
    }
  }

  _onLabelLengthChanged() {
    if (this._indicator) {
      this._indicator.updateLabel();
    } else {
      logInfo("Indicator not created yet to show changes");
    }
  }

  _recreateIndicator(isIconOnly = false) {
    if (isIconOnly && this._iconIndicator) {
      const oldIconIndicator = this._iconIndicator;
      this._iconIndicator = null;
      oldIconIndicator.destroy();
    } else if (!isIconOnly && this._indicator) {
      const oldIndicator = this._indicator;
      this._indicator = null;
      oldIndicator.destroy();
    }

    this._createIndicator(isIconOnly);
  }

  _createIndicator(isIconOnly = false) {
    if (isIconOnly && this._iconIndicator) return;
    if (!isIconOnly && this._indicator) return;

    const panelPosition = this._getPanelPosition();

    if (isIconOnly) {
      this._iconIndicator = new IconIndicator(this, panelPosition);
    } else {
      this._indicator = new SpotifyIndicator(this, panelPosition);
    }

    let alignment = "left";
    let gravity = 0;

    switch (panelPosition) {
      case 0:
        alignment = "left";
        gravity = -1;
        break;
      case 1:
        alignment = "center";
        gravity = -1;
        break;
      case 2:
        alignment = "right";
        gravity = 0;
        break;
      case 3:
        alignment = "left";
        gravity = 0;
        break;
      case 4:
        alignment = "right";
        gravity = -1;
        break;
    }

    const indicator = isIconOnly ? this._iconIndicator : this._indicator;
    const statusAreaId = isIconOnly ? `${this.uuid}-icon` : this.uuid;
    Main.panel.addToStatusArea(statusAreaId, indicator, gravity, alignment);
  }

  _onSpotifyAppeared() {
    if (!this._indicator) {
      logInfo("Spotify appeared on DBus");

      if (this._iconIndicator) {
        this._iconIndicator.destroy();
        this._iconIndicator = null;
      }

      this._createIndicator(false);
    }
  }

  _onSpotifyVanished() {
    const presistIndicator = this._settings.get_boolean("presist-indicator");

    if (this._indicator) {
      logInfo("Spotify vanished from DBus");
      this._indicator.destroy();
      this._indicator = null;

      if (presistIndicator) {
        this._createIndicator(true);
      }
    }
  }

  _checkSpotifyLoginStatus() {
    const controlsOrder = this._settings.get_strv("additional-controls-order");
    const hasLikeButton = controlsOrder.includes("like");

    if (!hasLikeButton) {
      return;
    }

    isSpotifyLoggedIn()
      .then((isLoggedIn) => {
        if (!isLoggedIn) {
          this.sendOSDMessage(
            "Connect to Spotify to use the Like button",
            "dialog-warning-symbolic",
          );
          logInfo("User needs to login to Spotify for like functionality");
        } else {
          logInfo("User is logged in to Spotify");
        }
      })
      .catch((e) => {
        logWarn(`Error checking Spotify login: ${e.message}`);
      });
  }

  control(action) {
    if (this._indicator && this._indicator._dbus) {
      this._indicator._dbus.control(action);
    } else {
      logWarn("Spotify indicator not found");
    }
  }

  downloadTrack() {
    const metadata = this._indicator._dbus.getMetadata();
    const displayText =
      metadata.title.length > 40
        ? metadata.title.substring(0, 37) + "..."
        : metadata.title;
    this._indicator._label.text = `${displayText} ⦿`;
    this._indicator._spotdl.checkSpotDLInstalled((installed) => {
      if (!installed) {
        logInfo("SpotDL is not installed");
        this.sendOSDMessage("SpotDL is not installed", "dialog-error-symbolic");
        this._indicator._label.text = "SpotDL is not installed";
        return;
      }
    });

    const rawFolder = this._settings.get_string("download-folder");
    let output_folder;

    if (GLib.path_is_absolute(rawFolder)) {
      output_folder = rawFolder;
    } else if (rawFolder.startsWith("~/")) {
      output_folder = GLib.build_filenamev([
        GLib.get_home_dir(),
        rawFolder.slice(2),
      ]);
    } else {
      output_folder = GLib.build_filenamev([GLib.get_home_dir(), rawFolder]);
    }

    this._indicator._spotdl.downloadSong(
      {
        url: metadata.url,
        output: output_folder,
      },
      (output) => {
        this._indicator._label.text = `${displayText} ${getStatusSymbol(output.message)}`;
      },
      (result) => {
        if (result.success) {
          this._indicator._label.text = `${displayText} ✓`;
          this.sendOSDMessage(
            "Track downloaded successfully",
            "dialog-information-symbolic",
          );
        } else {
          logWarn(`Download failed: ${result.error || result.exitCode}`);
          this.sendOSDMessage(
            "Download failed, Check SpotDL logs for details",
            "dialog-warning-symbolic",
          );
          this._indicator._label.text = `${displayText} ✕`;
        }
      },
    );
  }

  scheduleSpotifyMinimize() {
    this._clearMinimizeTimeout();

    let tries = 0;
    this._minimizeTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
      const success = toggleSpotifyWindow("minimize");
      if (success || tries++ > 10) {
        if (!success) logWarn("Minimize timeout exceeded");
        this._minimizeTimeout = null;
        return GLib.SOURCE_REMOVE;
      }
      return GLib.SOURCE_CONTINUE;
    });
  }

  sendOSDMessage(message, iconName) {
    const icon = this.getIconByName(iconName);
    if (SHELL_VERSION >= 49) {
      Main.osdWindowManager.showAll(icon, message, null, null);
    } else {
      Main.osdWindowManager.show(-1, icon, message, null, null);
    }
  }

  getIconByName(name) {
    let icon = Gio.Icon.new_for_string(name);
    if (icon) {
      return icon;
    }
    logError(`Icon ${name} not found`);
    return null;
  }

  _clearMinimizeTimeout() {
    if (this._minimizeTimeout) {
      GLib.Source.remove(this._minimizeTimeout);
      this._minimizeTimeout = null;
    }
  }
}
