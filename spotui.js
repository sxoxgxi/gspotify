import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

import { EXTENSION_CONFIG, INFO_TIPS } from "./constants.js";

export class SpotifyUI {
  constructor(indicator, extension, onColorUpdate = null) {
    this._indicator = indicator;
    this._extension = extension;
    this._settings = extension._settings;
    this._onColorUpdate = onColorUpdate;
    this._currentColors = null;
    this._readableTextColor = null;
    this._currentArtworkUrl = null;
    this._isPlaying = false;
    this._progressTimeout = null;
    this._lastUpdateTime = null;
    this._currentPosition = 0;
    this._duration = 0;
    this._notificationSource = null;

    this._buildUI();
  }

  _buildUI() {
    this.container = new St.BoxLayout({
      style_class: "spotify-card",
      vertical: true,
      x_expand: true,
      y_expand: true,
    });

    this._buildHeader();
    this._buildProgressBar();
    if (this._settings.get_boolean("show-info-tip")) {
      this._buildInfoTip();
    }
  }

  _buildHeader() {
    this._headerBox = new St.BoxLayout({
      style_class: "spotify-header",
      vertical: false,
      x_align: Clutter.ActorAlign.FILL,
      x_expand: true,
    });

    this._buildArtworkSection();
    this._buildPrevButton();
    this._buildInfoSection();
    this._buildNextButton();

    this.container.add_child(this._headerBox);
  }

  _buildArtworkSection() {
    this._artworkContainer = new St.Widget({
      style_class: "spotify-artwork-container",
      layout_manager: new Clutter.BinLayout(),
      width: 64,
      height: 64,
    });

    this._artwork = new St.Bin({
      style_class: "spotify-artwork",
      width: 64,
      height: 64,
    });
    this._artworkContainer.add_child(this._artwork);

    this._overlayIcon = new St.Icon({
      icon_name: "media-playback-start-symbolic",
      icon_size: 32,
      opacity: 0,
    });
    this._artworkContainer.add_child(this._overlayIcon);
    this._overlayIcon.set_position((64 - 32) / 2, (64 - 32) / 2);

    this._artworkBox = new St.Button({
      style_class: "spotify-artwork-box",
      child: this._artworkContainer,
    });

    this._artworkBox.connect("clicked", () => this._onPlayPause());

    this._headerBox.add_child(this._artworkBox);
  }

  _buildInfoTip() {
    this._infoTipBox = new St.BoxLayout({
      reactive: true,
      track_hover: true,
      vertical: true,
    });

    INFO_TIPS.forEach((tip, index) => {
      const tipLabel = new St.Label({
        text: `✗ ${tip}`,
        style_class: "spotify-info-tip",
        reactive: true,
      });

      if (index !== INFO_TIPS.length - 1) {
        tipLabel.set_style("margin-bottom: 2px");
      }

      tipLabel.connect("button-press-event", () => {
        this._infoTipBox.remove_child(tipLabel);
        if (this._infoTipBox.get_n_children() === 0) {
          this._infoTipBox.destroy();
        }
      });
      this._infoTipBox.add_child(tipLabel);
    });

    this._infoTipBox.set_style("margin-top: 8px");
    this.container.add_child(this._infoTipBox);
  }

  _buildPrevButton() {
    this._prevButton = new St.Button({
      style_class: "spotify-button",
      child: new St.Icon({
        icon_name: "media-skip-backward-symbolic",
        icon_size: 16,
      }),
    });
    this._prevButton.connect("clicked", () => this._control("previous"));
    this._headerBox.add_child(this._prevButton);
  }

  _buildInfoSection() {
    this._infoBox = new St.BoxLayout({
      style_class: "spotify-info-box",
      vertical: true,
      x_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      reactive: true,
      track_hover: true,
    });

    this._titleLabel = new St.Label({
      style_class: "spotify-title",
      text: "No track playing",
    });
    this._infoBox.add_child(this._titleLabel);

    this._artistLabel = new St.Label({
      style_class: "spotify-artist",
      text: "",
      x_align: Clutter.ActorAlign.CENTER,
    });
    this._infoBox.add_child(this._artistLabel);

    this._headerBox.add_child(this._infoBox);
  }

  _buildNextButton() {
    this._nextButton = new St.Button({
      style_class: "spotify-button",
      child: new St.Icon({
        icon_name: "media-skip-forward-symbolic",
        icon_size: 16,
      }),
    });
    this._nextButton.connect("clicked", () => this._control("next"));
    this._headerBox.add_child(this._nextButton);
  }

  _buildProgressBar() {
    this._progressBarContainer = new St.BoxLayout({
      style_class: "spotify-progress-bar",
      vertical: false,
      style: "height: 4px; border-radius: 2px; margin-top: 5px;",
      x_expand: true,
    });

    this._progressFilled = new St.Widget({
      style_class: "spotify-progress-filled",
    });
    this._progressBarContainer.add_child(this._progressFilled);

    this._infoBox.add_child(this._progressBarContainer);
  }

  _buildAdditionalControls() {
    this._additionalControls = new St.BoxLayout({
      style_class: "spotify-additional-controls",
    });
    this._infoBox.add_child(this._additionalControls);
  }

  _onPlayPause() {
    const newPlaying = !this._isPlaying;

    this._overlayIcon.icon_name = newPlaying
      ? "media-playback-start-symbolic"
      : "media-playback-pause-symbolic";
    this._overlayIcon.opacity = 0;

    this._animateOverlayIcon();
    this._control("playpause");

    this._isPlaying = newPlaying;

    if (this._isPlaying) {
      this._startProgressUpdate();
    } else {
      this._stopProgressUpdate();
    }
  }

  _animateOverlayIcon() {
    this._overlayIcon.ease({
      opacity: 255,
      duration: 300,
      mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
      onComplete: () => {
        this._overlayIcon.ease({
          opacity: 0,
          duration: 300,
          mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        });
      },
    });
  }

  _control(action) {
    if (this._extension?.control) {
      this._extension.control(action);
    } else {
      log(`${action} requested`);
    }
  }

  update(metadata) {
    if (!metadata?.success) return;

    this._updateText(metadata);
    this._updateProgress(metadata);
    this._updatePlayState(metadata);
    this._updateArtwork(metadata);
    this._infoBox.connect("button-press-event", () => {
      if (metadata.url) {
        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, metadata.url);
        this._showNotification(
          EXTENSION_CONFIG.name,
          "Copied track URL to clipboard!",
        );
      } else {
        this._showNotification(
          EXTENSION_CONFIG.name,
          "No URL found for current track",
        );
      }
    });
  }

  _updateText(metadata) {
    this._titleLabel.text = metadata.title || "Unknown Title";
    this._artistLabel.text = metadata.artist || "Unknown Artist";
  }

  _updateProgress(metadata) {
    const position = metadata.position_ms || 0;
    const duration = metadata.duration_ms || 0;

    this._currentPosition = position;
    this._duration = duration;
    this._lastUpdateTime = GLib.get_monotonic_time() / 1000;

    this._updateProgressBar();

    if (this._isPlaying) {
      this._startProgressUpdate();
    }
  }

  _updateProgressBar() {
    if (this._duration <= 0) return;

    const progress = Math.min(this._currentPosition / this._duration, 1);
    const barWidth = this._infoBox.width;

    this._progressFilled.width = Math.floor(progress * barWidth);
  }

  _startProgressUpdate() {
    this._stopProgressUpdate();

    this._progressTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      if (!this._isPlaying) {
        this._progressTimeout = null;
        return GLib.SOURCE_REMOVE;
      }

      const currentTime = GLib.get_monotonic_time() / 1000;
      const elapsed = currentTime - this._lastUpdateTime;

      this._currentPosition += elapsed;
      this._lastUpdateTime = currentTime;

      if (this._currentPosition >= this._duration) {
        this._currentPosition = this._duration;
        this._updateProgressBar();
        this._progressTimeout = null;
        return GLib.SOURCE_REMOVE;
      }

      this._updateProgressBar();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _stopProgressUpdate() {
    if (this._progressTimeout) {
      GLib.source_remove(this._progressTimeout);
      this._progressTimeout = null;
    }
  }

  _updatePlayState(metadata) {
    const wasPlaying = this._isPlaying;
    this._isPlaying = metadata.isPlaying || false;

    if (this._isPlaying && !wasPlaying) {
      this._startProgressUpdate();
    } else if (!this._isPlaying && wasPlaying) {
      this._stopProgressUpdate();
    }
  }

  _updateArtwork(metadata) {
    if (
      metadata.artworkUrl &&
      metadata.artworkUrl !== this._currentArtworkUrl
    ) {
      this._currentArtworkUrl = metadata.artworkUrl;
      this._loadArtwork(metadata.artworkUrl);
    } else if (!metadata.artworkUrl) {
      this._artwork.style = "border-radius: 10px; background-color: #333333;";
    }
  }

  _loadArtwork(url) {
    try {
      if (url.startsWith("file://")) {
        this._loadLocalArtwork(url);
      } else if (url.startsWith("http://") || url.startsWith("https://")) {
        this._loadArtworkFromUrl(url);
      }
    } catch (e) {
      logError(e, "Failed to load artwork");
      this._setFallbackArtwork();
    }
  }

  _loadLocalArtwork(url) {
    const file = Gio.File.new_for_uri(url);
    file.load_contents_async(null, (src, res) => {
      try {
        const [success, bytes] = src.load_contents_finish(res);
        if (!success) throw new Error("Failed to load file");
        this._setArtworkFromBytes(bytes);
      } catch (e) {
        logError(e, "Failed to load local artwork");
        this._setFallbackArtwork();
      }
    });
  }

  _loadArtworkFromUrl(url) {
    const file = Gio.File.new_for_uri(url);
    file.load_contents_async(null, (src, res) => {
      try {
        const [success, bytes] = src.load_contents_finish(res);
        if (!success) throw new Error("Failed to load contents from URL");
        this._setArtworkFromBytes(bytes);
      } catch (e) {
        logError(e, "Failed to load artwork from URL");
        this._setFallbackArtwork();
      }
    });
  }

  _setArtworkFromBytes(bytes) {
    try {
      const tempDir = GLib.get_tmp_dir();
      const tempFile = GLib.build_filenamev([
        tempDir,
        "gnome-spotify-artwork.jpg",
      ]);

      const file = Gio.File.new_for_path(tempFile);
      const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);

      stream.write_bytes(GLib.Bytes.new(bytes), null);
      stream.close(null);

      const fileUri = file.get_uri();
      this._artwork.style = `background-image: url("${fileUri}");`;

      const colorData = this._getColorPaletteFromBytes(bytes);
      if (colorData) {
        this._currentColors = colorData;
        this._applyArtworkColor(
          colorData.main,
          colorData.accent,
          colorData.theme,
        );
      }
    } catch (e) {
      logError(e, "Failed to set artwork from bytes");
      this._setFallbackArtwork();
    }
  }

  _setFallbackArtwork() {
    this._artwork.style = "border-radius: 10px; background-color: #333333;";
  }

  _getColorPaletteFromBytes(bytes) {
    try {
      const stream = Gio.MemoryInputStream.new_from_bytes(
        GLib.Bytes.new(bytes),
      );
      const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_at_scale(
        stream,
        16,
        16,
        true,
        null,
      );

      if (!pixbuf) return null;

      const pixels = pixbuf.get_pixels();
      const hasAlpha = pixbuf.get_has_alpha();
      const rowstride = pixbuf.get_rowstride();
      const width = pixbuf.get_width();
      const height = pixbuf.get_height();

      let r = 0,
        g = 0,
        b = 0;
      let count = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = y * rowstride + x * (hasAlpha ? 4 : 3);
          r += pixels[offset];
          g += pixels[offset + 1];
          b += pixels[offset + 2];
          count++;
        }
      }

      if (count > 0) {
        const mainColor = {
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count),
        };

        const accentColor = this._getAccentColor(mainColor);

        return {
          main: mainColor,
          accent: accentColor,
          theme: this._getThemeColor(mainColor, accentColor),
        };
      }
    } catch (e) {
      logError(e, "Failed to get color palette");
    }
    return null;
  }

  _getAccentColor(color) {
    return {
      r: 255 - color.r,
      g: 255 - color.g,
      b: 255 - color.b,
    };
  }

  _getThemeColor(main, accent, ratio = 0.3) {
    if (!main || !accent) return null;

    return {
      r: Math.floor(main.r * (1 - ratio) + accent.r * ratio),
      g: Math.floor(main.g * (1 - ratio) + accent.g * ratio),
      b: Math.floor(main.b * (1 - ratio) + accent.b * ratio),
    };
  }

  _applyArtworkColor(dominantColor, accentColor, themeColor) {
    const dominantCssColor = `rgb(${dominantColor.r}, ${dominantColor.g}, ${dominantColor.b})`;
    const accentCssColor = `rgb(${accentColor.r}, ${accentColor.g}, ${accentColor.b})`;
    const themeCssColor = `rgb(${themeColor.r}, ${themeColor.g}, ${themeColor.b})`;
    const readableTextColor = this._getReadableTextColor(dominantColor);

    this.container.style = `background-color: ${dominantCssColor};`;
    this._progressFilled.style = `background-color: ${accentCssColor};`;

    this._progressBarContainer.style += ` background-color: ${themeCssColor};`;

    this._readableTextColor = readableTextColor;
    this._prevButton.style = `color: ${readableTextColor};`;
    this._nextButton.style = `color: ${readableTextColor};`;
    this._titleLabel.style = `color: ${readableTextColor};`;
    this._artistLabel.style = `color: ${readableTextColor};`;
    this._overlayIcon.style = `color: ${readableTextColor};`;

    if (this._onColorUpdate) {
      this._onColorUpdate(dominantColor);
    }
  }

  _getReadableTextColor(bgColor) {
    const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    return lum(bgColor) < 0.5 ? "#FFFFFF" : "#000000";
  }

  _ensureNotificationSource() {
    if (!this._notificationSource) {
      this._notificationSource = new MessageTray.Source({
        title: EXTENSION_CONFIG.name,
        iconName: "media-playback-start-symbolic",
      });
      Main.messageTray.add(this._notificationSource);
    }
    return this._notificationSource;
  }

  _showNotification(title, message) {
    const source = this._ensureNotificationSource();
    const notification = new MessageTray.Notification({
      source: source,
      title: title,
      body: message,
      isTransient: true,
    });
    source.addNotification(notification);
  }

  destroy() {
    this._stopProgressUpdate();
    if (this._notificationSource) {
      this._notificationSource.destroy();
      this._notificationSource = null;
    }
  }
}
