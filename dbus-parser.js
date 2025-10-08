import Gio from "gi://Gio";
import GLib from "gi://GLib";

const spotifyDbus = `<node>
<interface name="org.mpris.MediaPlayer2.Player">
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="Shuffle" type="b" access="readwrite"/>
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
    this.initProxy();
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
            this.panelButton.updateLabel();
          }
        },
      );

      this.proxy.connectSignal("Seeked", (proxy, sender, [position]) => {
        this.panelButton.updateLabel({ position_ms: position / 1000 });
      });
    } catch (e) {
      logError(e, "Failed to create DBus proxy");
      this.proxy = null;
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
            log(
              "Unexpected inner variant type for Position:",
              positionValue.get_type_string(),
            );
          }
        } else {
          log(
            "Unexpected outer variant type for Position:",
            innerVariant.get_type_string(),
          );
        }

        const duration_ms = metadata["mpris:length"]
          ? metadata["mpris:length"].unpack() / 1000
          : 0;
        if (position_ms < 0 || (duration_ms > 0 && position_ms > duration_ms)) {
          log("Invalid position value, setting to 0");
          position_ms = 0;
        }
      } catch (e) {
        logError(e, "Failed to fetch Position via Properties.Get");
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
      logError(new Error("DBus proxy not available"), "Control action failed");
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
          log(`Unknown control action: ${action}`);
          return;
      }
      this.panelButton.updateLabel();
    } catch (e) {
      logError(e, `Failed to execute control action: ${action}`);
    }
  }

  getShuffle() {
    if (!this.proxy) {
      return;
    }
    try {
      return this.proxy.Shuffle;
    } catch (e) {
      logError(e, "Failed to get Shuffle state");
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
      log(`Shuffle set to ${newValue}`);
      this.panelButton.updateLabel();
    } catch (e) {
      logError(e, "Failed to toggle Shuffle");
    }
  }
}
