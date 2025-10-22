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
import { getStatusSymbol } from "./utils.js";

const SpotifyIndicator = GObject.registerClass(
  class SpotifyIndicator extends PanelMenu.Button {
    _init(extension, panelPosition = 0) {
      super._init(0.5, "Spotify Indicator", false);
      this._extension = extension;
      this._panelPosition = panelPosition;
      this._dbus = new SpotifyDBus(this);

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
    }

    _onColorUpdate(dominantColor) {
      if (dominantColor) {
        this.menu.box.style = `background-color: rgb(${dominantColor.r}, ${dominantColor.g}, ${dominantColor.b});`;
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
      super.destroy();
    }
  },
);

export default class SpotifyExtension extends Extension {
  enable() {
    this._indicator = null;
    this._watcherId = null;

    this._settings = this.getSettings();

    this._settingsHandlerId = this._settings.connect(
      "changed::panel-position",
      () => {
        this._onPanelPositionChanged();
      },
    );

    this._watcherId = Gio.bus_watch_name(
      Gio.BusType.SESSION,
      "org.mpris.MediaPlayer2.spotify",
      Gio.BusNameWatcherFlags.NONE,
      this._onSpotifyAppeared.bind(this),
      this._onSpotifyVanished.bind(this),
    );
  }

  disable() {
    if (this._settingsHandlerId) {
      this._settings.disconnect(this._settingsHandlerId);
      this._settingsHandlerId = null;
    }

    if (this._watcherId) {
      Gio.bus_unwatch_name(this._watcherId);
      this._watcherId = null;
    }

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
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
      this._recreateIndicator();
    }
  }

  _recreateIndicator() {
    if (this._indicator) {
      const oldIndicator = this._indicator;
      this._indicator = null;
      oldIndicator.destroy();

      this._createIndicator();
    }
  }

  _createIndicator() {
    if (this._indicator) return;

    const panelPosition = this._getPanelPosition();
    this._indicator = new SpotifyIndicator(this, panelPosition);

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

    Main.panel.addToStatusArea(this.uuid, this._indicator, gravity, alignment);
  }

  _onSpotifyAppeared() {
    if (!this._indicator) {
      console.info("Spotify appeared on DBus");
      this._createIndicator();
    }
  }

  _onSpotifyVanished() {
    if (this._indicator) {
      console.info("Spotify vanished from DBus");
      this._indicator.destroy();
      this._indicator = null;
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

  toggleSpotifyWindow() {
    const windowActors = global.get_window_actors();

    for (const actor of windowActors) {
      const win = actor.get_meta_window();
      const wmClass = win.get_wm_class()?.toLowerCase();

      if (wmClass && wmClass.includes("spotify")) {
        if (win.minimized) {
          win.unminimize();
          win.activate(global.get_current_time());
          console.log("Spotify window restored");
        } else {
          win.minimize();
          console.log("Spotify window minimized");
        }

        return true;
      }
    }

    console.warn("Spotify window not found");
    return false;
  }
}
