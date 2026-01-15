import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf";

import { INFO_TIPS } from "./constants.js";
import { toggleSpotifyWindow, logWarn, logInfo } from "./utils.js";
import { toggleLike, isTrackLiked } from "./spotify-helper.js";
import { getValidAccessToken } from "./spotify-auth.js";

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
    this._shuffleState = false;
    this._currentTrackId = null;
    this._isLiked = false;
    this._isSpotifyConnected = false;

    this.useFixedWidth = extension._settings.get_boolean("use-fixed-width");
    this.fixedWidth = extension._settings.get_int("ui-width");

    this._widthChangedId = this._settings.connect("changed::ui-width", () => {
      this._onWidthSettingsChanged();
    });

    this._useFixedWidthChangedId = this._settings.connect(
      "changed::use-fixed-width",
      () => {
        this._onWidthSettingsChanged();
      },
    );

    this._buildUI();
  }

  _buildUI() {
    this.container = new St.BoxLayout({
      style_class: "spotify-card",
      vertical: true,
      width: this.useFixedWidth ? this.fixedWidth : -1,
      x_expand: !this.useFixedWidth,
      y_expand: true,
    });

    this._buildHeader();
    this._buildProgressBar();

    this._separator = new St.Widget({
      style_class: "spotify-separator",
      x_expand: true,
      y_expand: false,
    });
    this.container.add_child(this._separator);

    this._buildAdditionalControls();
    if (this._settings.get_boolean("show-info-tip")) {
      this._tipSeparator = new St.Widget({
        style_class: "spotify-separator",
        x_expand: true,
        y_expand: false,
      });
      this.container.add_child(this._tipSeparator);
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
          this._tipSeparator.destroy();
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
    const infoBoxWidth = this.useFixedWidth
      ? this.fixedWidth - 64 - 32 - 40
      : -1;
    this._infoBox = new St.BoxLayout({
      style_class: "spotify-info-box",
      vertical: true,
      width: infoBoxWidth,
      x_expand: !this.useFixedWidth,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      reactive: true,
      track_hover: true,
    });

    this._titleLabel = new St.Label({
      style_class: "spotify-title",
      text: "No track playing",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._titleLabel.clutter_text.ellipsize = 3;
    this._titleLabel.clutter_text.line_wrap = false;
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
      vertical: false,
      x_align: Clutter.ActorAlign.FILL,
    });

    this.container.add_child(this._additionalControls);

    this._controls = {
      shuffle: this._buildShuffleButton(),
      spotify: this._buildSpotifyToggleButton(),
      spacer: this._buildSpacerLabel(),
      download: this._buildDownloadButton(),
      settings: this._buildSettingsButton(),
      like: this._buildLikeButton(),
    };

    this._rebuildAdditionalControls();

    this._controlsOrderChangedId = this._settings.connect(
      "changed::additional-controls-order",
      () => {
        this._rebuildAdditionalControls();
      },
    );
  }

  _rebuildAdditionalControls() {
    this._additionalControls.remove_all_children();

    const order = this._settings.get_strv("additional-controls-order") || [
      "shuffle",
      "toggle",
      "spacer",
      "download",
      "settings",
    ];

    for (const key of order) {
      const actor = this._controls[key];
      if (actor) {
        this._additionalControls.add_child(actor);
      }
    }
  }

  _buildSpacerLabel() {
    this._spacerLabel = new St.Label({
      text: "",
      style_class: "spotify-spacer-label",
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });

    return this._spacerLabel;
  }

  _buildShuffleButton() {
    this._shuffleButton = new St.Button({
      style_class: "spotify-button-secondary",
      child: new St.Icon({
        icon_name: "media-playlist-shuffle-symbolic",
        icon_size: 16,
      }),
    });

    this._shuffleButton.connect("clicked", () => this._updateShuffleState());
    return this._shuffleButton;
  }

  _buildSpotifyToggleButton() {
    this._spotifyToggleButton = new St.Button({
      style_class: "spotify-button-secondary",
      child: new St.Icon({
        icon_name: "view-reveal-symbolic",
        icon_size: 16,
      }),
    });

    this._spotifyToggleButton.connect("clicked", () => toggleSpotifyWindow());
    return this._spotifyToggleButton;
  }

  _buildSettingsButton() {
    this._settingsButton = new St.Button({
      style_class: "spotify-button-secondary",
      child: new St.Icon({
        icon_name: "preferences-system-symbolic",
        icon_size: 16,
      }),
    });

    this._settingsButton.connect("clicked", () => {
      this._indicator.menu._getTopMenu().close();
      this._extension.openPreferences();
    });

    return this._settingsButton;
  }

  _buildDownloadButton() {
    this._downloadButton = new St.Button({
      style_class: "spotify-button-secondary",
      child: new St.Icon({
        icon_name: "folder-download-symbolic",
        icon_size: 16,
      }),
    });
    this._downloadButton.connect("clicked", () => {
      this._extension.downloadTrack();
    });

    return this._downloadButton;
  }

  _buildLikeButton() {
    this._likeButton = new St.Button({
      style_class: "spotify-button-secondary",
      child: new St.Icon({
        gicon: Gio.Icon.new_for_string(
          `${this._extension.path}/icons/heart-outline-thin-symbolic.svg`,
        ),
        icon_size: 20,
      }),
    });

    this._likeButton.connect("clicked", () => {
      this._onLikeButtonClicked();
    });
    return this._likeButton;
  }

  async _checkSpotifyConnection() {
    try {
      const accessToken = await getValidAccessToken();
      this._isSpotifyConnected = accessToken && accessToken.length > 0;
    } catch (e) {
      this._isSpotifyConnected = false;
    }
  }

  async _onLikeButtonClicked() {
    logInfo("Spotify Connection Status:", this._isSpotifyConnected);
    if (!this._isSpotifyConnected) {
      this._extension.sendOSDMessage(
        "Connect Spotify account from extension's setting to like songs",
        "dialog-warning-symbolic",
      );
    }

    if (!this._currentTrackId) {
      this._extension.sendOSDMessage(
        "No track playing",
        "dialog-error-symbolic",
      );
      return;
    }

    try {
      this._likeButton.reactive = false;
      const newLikedState = await toggleLike(this._currentTrackId);
      this._isLiked = newLikedState;

      this._updateLikeButtonIcon();
      const message = newLikedState
        ? "Added to Liked Songs"
        : "Removed from Liked Songs";
      const icon = newLikedState
        ? "emote-love-symbolic"
        : "list-remove-symbolic";
      this._extension.sendOSDMessage(message, icon);
    } catch (e) {
      logWarn("Failed to toggle like state:", e);
      this._extension.sendOSDMessage(
        "Access token may have expired. Reconnect in settings",
        "dialog-error-symbolic",
      );
    } finally {
      this._likeButton.reactive = true;
    }
  }

  _updateLikeButtonIcon() {
    if (!this._likeButton) return;
    const iconPath = this._isLiked
      ? "emote-love-symbolic"
      : `${this._extension.path}/icons/heart-outline-thin-symbolic.svg`;

    this._likeButton.child.gicon = Gio.Icon.new_for_string(iconPath);

    if (this._readableTextColor) {
      this._likeButton.style = `color: ${this._readableTextColor};`;
    }
  }

  _extractTrackIdFromUrl(url) {
    if (!url) return null;

    if (url.startsWith("spotify:track:")) {
      return url.split(":")[2];
    }

    const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
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
    }
  }

  async update(metadata) {
    if (!metadata?.success) return;

    this._updateText(metadata);
    this._updateProgress(metadata);
    this._updatePlayState(metadata);
    this._updateArtwork(metadata);
    this._shuffleState = metadata.shuffle;
    this._updateShuffleButton();

    if (metadata.url) {
      const trackId = this._extractTrackIdFromUrl(metadata.url);
      if (trackId && trackId !== this._currentTrackId) {
        this._currentTrackId = trackId;
        await this._checkLikeStatus();
        this._updateLikeButtonIcon();
      }
    } else {
      this._currentTrackId = null;
      this._isLiked = false;
      this._updateLikeButtonIcon();
    }

    this._infoBox.connect("button-press-event", () => {
      if (metadata.url) {
        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, metadata.url);
        this._extension.sendOSDMessage(
          "Copied Spotify URL for " + metadata.title,
          "edit-copy-symbolic",
        );
      } else {
        this._extension.sendOSDMessage(
          "URL Not Found for " + metadata.title,
          "edit-copy-symbolic",
        );
      }
    });
  }

  async _checkLikeStatus() {
    if (!this._currentTrackId) {
      return false;
    }

    if (!this._isSpotifyConnected) {
      this._isLiked = false;
      this._updateLikeButtonIcon();
      return false;
    }

    try {
      this._isLiked = await isTrackLiked(this._currentTrackId);
      this._updateLikeButtonIcon();
      return this._isLiked;
    } catch (e) {
      logWarn("Failed to check like status:", e);

      this._isSpotifyConnected = false;
      this._isLiked = false;
      this._updateLikeButtonIcon();
      return false;
    }
  }

  _updateShuffleState() {
    this._shuffleState = this._indicator._dbus.toggleShuffle();

    this._updateShuffleButton();
  }

  _updateShuffleButton() {
    if (this._shuffleState) {
      this._shuffleButton.add_style_pseudo_class("active");
    } else {
      this._shuffleButton.remove_style_pseudo_class("active");
    }
  }

  _updateText(metadata) {
    if (!metadata.title) {
      this._titleLabel.text = "Spotify";
      this._artistLabel.text = "Unknown Artist";
      return;
    }
    this._titleLabel.text =
      metadata.title.length > 40
        ? metadata.title.substring(0, 37) + "..."
        : metadata.title;
    this._artistLabel.text = metadata.artist;
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
      GLib.Source.remove(this._progressTimeout);
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
      logWarn("Failed to load artwork");
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
        logWarn("Failed to load local artwork");
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
        logWarn("Failed to load artwork from URL");
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

      if (this._settings.get_boolean("artwork-themed-ui")) {
        const colorData = this._getColorPaletteFromBytes(bytes);
        if (colorData) {
          this._currentColors = colorData;
          this._applyArtworkColor(
            colorData.main,
            colorData.accent,
            colorData.theme,
          );
        }
      }
    } catch (e) {
      logWarn("Failed to set artwork from bytes");
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
      logWarn("Failed to get color palette");
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
    this._shuffleButton.style = `color: ${readableTextColor};`;
    this._settingsButton.style = `color: ${readableTextColor};`;
    this._downloadButton.style = `color: ${readableTextColor};`;
    this._spotifyToggleButton.style = `color: ${readableTextColor};`;
    this._likeButton.style = `color: ${readableTextColor};`;

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

  _onWidthSettingsChanged() {
    this.useFixedWidth = this._settings.get_boolean("use-fixed-width");
    this.fixedWidth = this._settings.get_int("ui-width");

    if (this.useFixedWidth) {
      this.container.width = this.fixedWidth;
      this.container.x_expand = false;
    } else {
      this.container.width = -1;
      this.container.x_expand = true;
    }

    if (this.useFixedWidth) {
      const infoBoxWidth = this.fixedWidth - 64 - 32 - 40;
      this._infoBox.width = infoBoxWidth;
      this._infoBox.x_expand = false;
    } else {
      this._infoBox.width = -1;
      this._infoBox.x_expand = true;
    }

    this._updateProgressBar();
  }

  destroy() {
    this._stopProgressUpdate();

    if (this._controlsOrderChangedId) {
      this._settings.disconnect(this._controlsOrderChangedId);
      this._controlsOrderChangedId = null;
    }

    if (this._widthChangedId) {
      this._settings.disconnect(this._widthChangedId);
      this._widthChangedId = null;
    }

    if (this._useFixedWidthChangedId) {
      this._settings.disconnect(this._useFixedWidthChangedId);
      this._useFixedWidthChangedId = null;
    }
  }
}
