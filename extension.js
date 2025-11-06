import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { SpotifyDBus } from "./dbus-parser.js";
import { SpotifyUI } from "./spotui.js";
import { SpotDLExecutor } from "./spotdl.js";
import { getStatusSymbol, toggleSpotifyWindow } from "./utils.js";

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
        this._label.text = `Volume: ${Math.round(newVol * 100)}%`;

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
      const metadata = this._dbus.getMetadata();

      if (overridePosition) {
        metadata.position_ms = overridePosition.position_ms;
      }

      if (metadata.success && metadata.title) {
        const displayText = `${metadata.title}`;
        this._label.text =
          displayText.length > 50
            ? displayText.substring(0, 47) + "..."
            : displayText;
        this._ui.update(metadata);
      } else {
        this._label.text = "Spotify";
        this._ui.update(null);
      }
    }

    destroy() {
      this._dbus = null;
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
      this._minimizeTimeout = null;

      this._icon = new St.Icon({
        gicon: Gio.Icon.new_for_string(
          `${this._extension.path}/icons/spotify-symbolic.svg`,
        ),
        icon_size: 16,
      });
      this.add_child(this._icon);
      this.connect("button-press-event", this._openSpotify.bind(this));
    }

    _openSpotify() {
      const openMinimize = this._extension._settings.get_boolean(
        "open-spotify-minimized",
      );
      let apps = Gio.AppInfo.get_all();
      let spotifyApp = apps.find((app) => {
        let name = app.get_name().toLowerCase();
        let id = app.get_id()?.toLowerCase() || "";
        return name.includes("spotify") || id.includes("spotify");
      });

      if (spotifyApp) {
        try {
          spotifyApp.launch([], null);
          console.log("Launching Spotify...");

          if (openMinimize) {
            this._stopMinimizeUpdate();
            let tries = 0;
            this._minimizeTimeout = GLib.timeout_add(
              GLib.PRIORITY_DEFAULT,
              500,
              () => {
                if (toggleSpotifyWindow("minimize") || tries++ > 10)
                  return GLib.SOURCE_REMOVE;
                return GLib.SOURCE_CONTINUE;
              },
            );
          }
        } catch (e) {
          console.error("Failed to launch Spotify: " + e);
        }
      } else {
        console.log("Spotify app not found");
      }
    }

    _stopMinimizeUpdate() {
      if (this._minimizeTimeout) {
        GLib.Source.remove(this._minimizeTimeout);
        this._minimizeTimeout = null;
      }
    }

    destroy() {
      this._stopMinimizeUpdate();
      super.destroy();
    }
  },
);

export default class SpotifyExtension extends Extension {
  enable() {
    this._indicator = null;
    this._iconIndicator = null;
    this._watcherId = null;

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

    this._watcherId = Gio.bus_watch_name(
      Gio.BusType.SESSION,
      "org.mpris.MediaPlayer2.spotify",
      Gio.BusNameWatcherFlags.NONE,
      this._onSpotifyAppeared.bind(this),
      this._onSpotifyVanished.bind(this),
    );

    const presistIndicator = this._settings.get_boolean("presist-indicator");
    if (presistIndicator && !this._indicator) {
      this._createIndicator(true);
    }
  }

  disable() {
    if (this._settingsHandlerId) {
      this._settings.disconnect(this._settingsHandlerId);
      this._settingsHandlerId = null;
    }

    if (this._presistSettingsHandlerId) {
      this._settings.disconnect(this._presistSettingsHandlerId);
      this._presistSettingsHandlerId = null;
    }

    if (this._watcherId) {
      Gio.bus_unwatch_name(this._watcherId);
      this._watcherId = null;
    }

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

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
      console.info("Spotify appeared on DBus");

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
      console.info("Spotify vanished from DBus");
      this._indicator.destroy();
      this._indicator = null;

      if (presistIndicator) {
        this._createIndicator(true);
      }
    }
  }

  control(action) {
    if (this._indicator && this._indicator._dbus) {
      this._indicator._dbus.control(action);
    } else {
      console.warn("Spotify indicator not found");
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
        console.log("SpotDL is not installed");
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
        } else {
          console.warn(`Download failed: ${result.error || result.exitCode}`);
          this._indicator._label.text = `${displayText} ✕`;
        }
      },
    );
  }
}
