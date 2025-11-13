import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { logError, logInfo } from "./utils.js";

const CONFIG_DIR = GLib.build_filenamev([
  GLib.get_user_config_dir(),
  "gspotify",
]);
export const STATS_FILE = GLib.build_filenamev([CONFIG_DIR, "stats.json"]);

const DEFAULT_SCHEMA = {
  version: 1,
  totals: {
    tracks_played: 0,
    tracks_skipped: 0,
    play_time_seconds: 0,
  },
  top: {
    artists: [],
    tracks: [],
  },
  metadata: {
    created_at: null,
    last_updated: null,
  },
};

export class StatsManager {
  constructor() {
    this._data = null;
    this._saveTimeoutId = null;
    this._saveDelay = 2000;
    this._maxTopItems = 100;

    this._ensureConfigDir();
    this._load();
  }

  _ensureConfigDir() {
    let dir = Gio.File.new_for_path(CONFIG_DIR);
    if (!dir.query_exists(null)) {
      try {
        dir.make_directory_with_parents(null);
      } catch (e) {
        logError(e, "Failed to create config directory");
      }
    }
  }

  _load() {
    let file = Gio.File.new_for_path(STATS_FILE);

    if (!file.query_exists(null)) {
      this._data = this._createDefaultData();
      this._saveImmediately();
      return;
    }

    try {
      let [success, contents] = file.load_contents(null);
      if (success) {
        let decoder = new TextDecoder("utf-8");
        let jsonStr = decoder.decode(contents);
        this._data = JSON.parse(jsonStr);

        this._migrateSchema();
      }
    } catch (e) {
      logError(e, "Failed to load stats file, creating new one");
      this._data = this._createDefaultData();
      this._saveImmediately();
    }
  }

  _createDefaultData() {
    let data = JSON.parse(JSON.stringify(DEFAULT_SCHEMA));
    data.metadata.created_at = new Date().toISOString();
    data.metadata.last_updated = new Date().toISOString();
    return data;
  }

  _migrateSchema() {
    if (!this._data.version) {
      this._data.version = 1;
    }

    // Future migrations
    // if (this._data.version === 1) {
    //     this._data.version = 2;
    // }

    if (!this._data.totals) this._data.totals = DEFAULT_SCHEMA.totals;
    if (!this._data.top) this._data.top = DEFAULT_SCHEMA.top;
    if (!this._data.metadata) this._data.metadata = DEFAULT_SCHEMA.metadata;
  }

  _scheduleSave() {
    if (this._saveTimeoutId) {
      GLib.Source.remove(this._saveTimeoutId);
    }

    this._saveTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this._saveDelay,
      () => {
        this._saveImmediately();
        this._saveTimeoutId = null;
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _saveImmediately() {
    this._data.metadata.last_updated = new Date().toISOString();

    try {
      let file = Gio.File.new_for_path(STATS_FILE);
      let jsonStr = JSON.stringify(this._data, null, 2);
      let bytes = new GLib.Bytes(jsonStr);

      file.replace_contents(
        bytes.get_data(),
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null,
      );
    } catch (e) {
      logError(e, "Failed to save stats file");
    }
  }

  increment(keyPath, amount = 1) {
    let keys = keyPath.split(".");
    let obj = this._data;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }

    let lastKey = keys[keys.length - 1];
    if (typeof obj[lastKey] !== "number") {
      obj[lastKey] = 0;
    }
    obj[lastKey] += amount;

    this._scheduleSave();
  }

  updateTopArtists(artistName) {
    if (!artistName || artistName.trim() === "") return;

    let artists = this._data.top.artists;
    let existing = artists.find((a) => a.name === artistName);

    if (existing) {
      existing.count++;
      existing.last_played = new Date().toISOString();
    } else {
      artists.push({
        name: artistName,
        count: 1,
        last_played: new Date().toISOString(),
      });
    }

    artists.sort((a, b) => b.count - a.count);
    this._data.top.artists = artists.slice(0, this._maxTopItems);

    this._scheduleSave();
  }

  updateTopTracks(trackId, title, artist) {
    if (!trackId || !title) return;

    let tracks = this._data.top.tracks;
    let existing = tracks.find((t) => t.id === trackId);

    if (existing) {
      existing.count++;
      existing.last_played = new Date().toISOString();
      existing.title = title;
      existing.artist = artist || existing.artist;
    } else {
      tracks.push({
        id: trackId,
        title: title,
        artist: artist || "Unknown Artist",
        count: 1,
        last_played: new Date().toISOString(),
      });
    }

    tracks.sort((a, b) => b.count - a.count);
    this._data.top.tracks = tracks.slice(0, this._maxTopItems);

    this._scheduleSave();
  }

  recordEvent(eventName, metadata = {}) {
    switch (eventName) {
      case "play":
        this.increment("totals.tracks_played");
        if (metadata.artist) {
          this.updateTopArtists(metadata.artist);
        }
        if (metadata.trackId && metadata.title) {
          this.updateTopTracks(
            metadata.trackId,
            metadata.title,
            metadata.artist,
          );
        }
        break;

      case "skip":
        this.increment("totals.tracks_skipped");
        break;

      case "playtime":
        if (metadata.seconds) {
          this.increment("totals.play_time_seconds", metadata.seconds);
        }
        break;

      default:
        logInfo(`Unknown event: ${eventName}`);
    }
  }

  getData() {
    return JSON.parse(JSON.stringify(this._data));
  }

  get(keyPath) {
    let keys = keyPath.split(".");
    let obj = this._data;

    for (let key of keys) {
      if (obj === null || obj === undefined) return null;
      obj = obj[key];
    }

    return obj;
  }

  reset() {
    this._data = this._createDefaultData();
    this._saveImmediately();
  }

  export() {
    return JSON.stringify(this._data, null, 2);
  }

  destroy() {
    if (this._saveTimeoutId) {
      GLib.Source.remove(this._saveTimeoutId);
      this._saveTimeoutId = null;
    }
    this._saveImmediately();
  }
}

var instance = null;

export function getStatsManager() {
  if (!instance) {
    instance = new StatsManager();
  }
  return instance;
}

export function destroyStatsManager() {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
