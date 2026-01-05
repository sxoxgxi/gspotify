import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { buildGeneralPage } from "./preferences/general_page.js";
import { buildStatsPage } from "./preferences/stats_page.js";
import { buildDonatePage } from "./preferences/donation_page.js";
import { buildSpotifyPage } from "./preferences/spotify_page.js";
import { initializeAuth } from "./spotify-auth.js";

export default class GSpotifyPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    initializeAuth(settings);
    const generalPage = buildGeneralPage(window, settings, this.metadata);
    window.add(generalPage);
    const statsPage = buildStatsPage(window, settings);
    window.add(statsPage);
    const spotifyPage = buildSpotifyPage(window, settings);
    window.add(spotifyPage);
    const donatePage = buildDonatePage(window, this.path);
    window.add(donatePage);
  }
}
