import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { logWarn } from "./utils.js";
import { getStatsManager } from "./stats.js";

const spotifyDbus = `<node>
<interface name="org.mpris.MediaPlayer2.Player">
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="Volume" type="d" access="readwrite"/>
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <signal name="Seeked">
        <arg name="Position" type="x"/>
    </signal>
</interface>
</node>`;

export class SpotifyDBus {
  constructor(panelButton) {
    this.proxy = null;
    this.panelButton = panelButton;
    this.collectStats =
      panelButton._extension._settings.get_boolean("collect-stats");

    this._settingsChangedId = panelButton._extension._settings.connect(
      "changed::collect-stats",
      this._onCollectStatsChanged.bind(this),
    );

    this._lastTrackUrl = null;
    this._lastTitle = "";
    this._lastArtist = "";
    this._lastDuration = 0;
    this._lastPosition = 0;
    this._lastUpdateTime = null;
    this._playTimeAccumulator = 0;
    this._playTimeInterval = null;

    this._currentTrackPlayed = false;

    this.initProxy();

    if (this.collectStats) {
      this.stats = getStatsManager();
      this._startPlayTimeTracking();
    }
  }

  initProxy() {
    try {
      this.proxy = Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SESSION,
        Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
        Gio.DBusInterfaceInfo.new_for_xml(spotifyDbus),
        "org.mpris.MediaPlayer2.spotify",
        "/org/mpris/MediaPlayer2",
        "org.mpris.MediaPlayer2.Player",
        null,
      );

      this.proxy.connect(
        "g-properties-changed",
        (proxy, changed, invalidated) => {
          const props = changed.deepUnpack();
          if ("Metadata" in props || "PlaybackStatus" in props) {
            if (this.collectStats) {
              this._handleTrackChange(props);
            }
            this.panelButton.updateLabel();
          }
        },
      );

      this.proxy.connectSignal("Seeked", (proxy, sender, [position]) => {
        this._lastPosition = position / 1000;
        this._lastUpdateTime = Date.now();
        this.panelButton.updateLabel({ position_ms: position / 1000 });
      });
    } catch (e) {
      logWarn("Failed to create DBus proxy");
      this.proxy = null;
    }
  }
  _handleTrackChange(props) {
    const metadata = this.getMetadata();

    if (!metadata.success) return;
    const currentUrl = metadata.url;

    if (currentUrl && currentUrl !== this._lastTrackUrl) {
      if (this._lastTrackUrl) {
        const wasCompleted = this._lastPosition >= this._lastDuration - 5000;
        if (wasCompleted && !this._currentTrackPlayed) {
          this.stats.recordEvent("play", {
            trackId: this._lastTrackUrl,
            title: this._lastTitle,
            artist: this._lastArtist,
          });
          this._currentTrackPlayed = true;
        }
        if (!this._currentTrackPlayed) {
          this.stats.recordEvent("skip");
        }
        if (this._playTimeAccumulator > 0) {
          this.stats.recordEvent("playtime", {
            seconds: Math.floor(this._playTimeAccumulator / 1000),
          });
          this._playTimeAccumulator = 0;
        }
      }

      this._lastTrackUrl = currentUrl;
      this._lastTitle = metadata.title;
      this._lastArtist = metadata.artist;
      this._lastDuration = metadata.duration_ms;
      this._currentTrackPlayed = false;
      this._lastPosition = metadata.position_ms;
      this._lastUpdateTime = Date.now();
    }
  }

  _recordTrackPlay(metadata) {
    this.stats.recordEvent("play", {
      trackId: metadata.url,
      title: metadata.title,
      artist: metadata.artist,
    });

    this._currentTrackPlayed = true;
  }

  _startPlayTimeTracking() {
    this._playTimeInterval = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      5,
      () => {
        this._updatePlayTime();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _updatePlayTime() {
    const metadata = this.getMetadata();
    if (!metadata.success || !metadata.isPlaying) {
      this._lastUpdateTime = null;
      return;
    }

    const now = Date.now();
    if (this._lastUpdateTime) {
      const elapsed = now - this._lastUpdateTime;
      if (elapsed > 0 && elapsed < 10000) {
        this._playTimeAccumulator += elapsed;
      }
    }

    this._lastUpdateTime = now;
    this._lastPosition = metadata.position_ms;
    if (this._playTimeAccumulator >= 30000 && !this._currentTrackPlayed) {
      this._recordTrackPlay(metadata);
    }

    if (this._playTimeAccumulator >= 30000) {
      this.stats.recordEvent("playtime", {
        seconds: Math.floor(this._playTimeAccumulator / 1000),
      });
      this._playTimeAccumulator = 0;
    }
  }

  _onCollectStatsChanged() {
    this.collectStats =
      this.panelButton._extension._settings.get_boolean("collect-stats");

    if (this.collectStats) {
      if (!this.stats) {
        this.stats = getStatsManager();
      }
      if (!this._playTimeInterval) {
        this._startPlayTimeTracking();
      }
    } else {
      if (this._playTimeInterval) {
        GLib.Source.remove(this._playTimeInterval);
        this._playTimeInterval = null;
      }
      if (this._playTimeAccumulator > 0 && this.stats) {
        this.stats.recordEvent("playtime", {
          seconds: Math.floor(this._playTimeAccumulator / 1000),
        });
        this._playTimeAccumulator = 0;
      }
    }
  }

  getMetadata() {
    if (!this.proxy) {
      return {
        title: "",
        artist: "",
        url: "",
        album: "",
        artworkUrl: "",
        duration_ms: 0,
        position_ms: 0,
        isPlaying: false,
        success: false,
      };
    }

    try {
      const metadata = this.proxy.Metadata;
      let position_ms = 0;

      try {
        const positionVariant = this.proxy.call_sync(
          "org.freedesktop.DBus.Properties.Get",
          new GLib.Variant("(ss)", [
            "org.mpris.MediaPlayer2.Player",
            "Position",
          ]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
        );

        const innerVariant = positionVariant.get_child_value(0);
        if (innerVariant.is_of_type(GLib.VariantType.new("v"))) {
          const positionValue = innerVariant.get_variant();
          if (positionValue.is_of_type(GLib.VariantType.new("x"))) {
            position_ms = positionValue.get_int64() / 1000;
          } else {
            logWarn(
              "Unexpected inner variant type for Position:",
              positionValue.get_type_string(),
            );
          }
        } else {
          logWarn(
            "Unexpected outer variant type for Position:",
            innerVariant.get_type_string(),
          );
        }

        const duration_ms = metadata["mpris:length"]
          ? metadata["mpris:length"].unpack() / 1000
          : 0;
        if (position_ms < 0 || (duration_ms > 0 && position_ms > duration_ms)) {
          logWarn("Invalid position value, setting to 0");
          position_ms = 0;
        }
      } catch (e) {
        logWarn(e, "Failed to fetch Position via Properties.Get");
      }

      return {
        title: metadata["xesam:title"] ? metadata["xesam:title"].unpack() : "",
        artist: metadata["xesam:artist"]
          ? metadata["xesam:artist"].get_strv()[0]
          : "",
        album: metadata["xesam:album"] ? metadata["xesam:album"].unpack() : "",
        artworkUrl: metadata["mpris:artUrl"]
          ? metadata["mpris:artUrl"].unpack()
          : "",
        url: metadata["xesam:url"] ? metadata["xesam:url"].unpack() : "",
        duration_ms: metadata["mpris:length"]
          ? metadata["mpris:length"].unpack() / 1000
          : 0,
        position_ms,
        isPlaying: this.proxy.PlaybackStatus
          ? this.proxy.PlaybackStatus === "Playing"
          : false,
        shuffle: this.getShuffle(),
        success: true,
      };
    } catch (e) {
      return {
        title: "",
        artist: "",
        url: "",
        album: "",
        artworkUrl: "",
        duration_ms: 0,
        position_ms: 0,
        isPlaying: false,
        success: false,
      };
    }
  }

  control(action) {
    if (!this.proxy) {
      logWarn("DBus proxy not available for control action");
      return;
    }

    try {
      switch (action) {
        case "playpause":
          this.proxy.call_sync(
            "PlayPause",
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
          );
          break;
        case "next":
          this.proxy.call_sync("Next", null, Gio.DBusCallFlags.NONE, -1, null);
          break;
        case "previous":
          this.proxy.call_sync(
            "Previous",
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
          );
          break;
        default:
          logWarn(`Unknown control action: ${action}`);
          return;
      }
      this.panelButton.updateLabel();
    } catch (e) {
      logWarn(`Failed to execute control action: ${action}`);
    }
  }

  getShuffle() {
    if (!this.proxy) {
      return;
    }
    try {
      return this.proxy.Shuffle;
    } catch (e) {
      logWarn("Failed to get Shuffle state");
      return false;
    }
  }

  toggleShuffle() {
    if (!this.proxy) {
      return;
    }
    try {
      const current = this.getShuffle();
      const newValue = !current;
      this.proxy.call_sync(
        "org.freedesktop.DBus.Properties.Set",
        new GLib.Variant("(ssv)", [
          "org.mpris.MediaPlayer2.Player",
          "Shuffle",
          new GLib.Variant("b", newValue),
        ]),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      );
      this.panelButton.updateLabel();
      return newValue;
    } catch (e) {
      logWarn("Failed to toggle Shuffle");
    }
  }

  getVolume() {
    if (!this.proxy) {
      logWarn("DBus proxy not available for getVolume");
      return null;
    }

    try {
      const volumeVariant = this.proxy.call_sync(
        "org.freedesktop.DBus.Properties.Get",
        new GLib.Variant("(ss)", ["org.mpris.MediaPlayer2.Player", "Volume"]),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      );

      const innerVariant = volumeVariant.get_child_value(0);
      if (innerVariant.is_of_type(GLib.VariantType.new("v"))) {
        const volumeValue = innerVariant.get_variant();
        if (volumeValue.is_of_type(GLib.VariantType.new("d"))) {
          return volumeValue.get_double();
        }
      }
      logWarn("Unexpected variant type for Volume");
      return null;
    } catch (e) {
      logWarn("Failed to get Volume");
      return null;
    }
  }

  setVolume(volume) {
    if (!this.proxy) {
      logWarn("DBus proxy not available for setVolume");
      return false;
    }

    const clampedVolume = Math.max(0.0, Math.min(1.0, volume));

    try {
      this.proxy.call_sync(
        "org.freedesktop.DBus.Properties.Set",
        new GLib.Variant("(ssv)", [
          "org.mpris.MediaPlayer2.Player",
          "Volume",
          new GLib.Variant("d", clampedVolume),
        ]),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      );
      return true;
    } catch (e) {
      logWarn(`Failed to set Volume to ${clampedVolume}`);
      return false;
    }
  }

  adjustVolume(delta, step = 0.1) {
    const currentVolume = this.getVolume();
    if (currentVolume === null) {
      return null;
    }

    const adjustment = delta > 0 ? step : -step;
    const newVolume = Math.max(0.0, Math.min(1.0, currentVolume + adjustment));

    if (this.setVolume(newVolume)) {
      return newVolume;
    }
    return null;
  }

  increaseVolume(step = 0.1) {
    return this.adjustVolume(1, step);
  }

  decreaseVolume(step = 0.1) {
    return this.adjustVolume(-1, step);
  }

  destroy() {
    if (this._settingsChangedId) {
      this.panelButton._extension._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }

    if (this._playTimeAccumulator > 0) {
      this.stats.recordEvent("playtime", {
        seconds: Math.floor(this._playTimeAccumulator / 1000),
      });
    }

    if (this._playTimeInterval) {
      GLib.Source.remove(this._playTimeInterval);
      this._playTimeInterval = null;
    }
  }
}
