import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { buildGeneralPage } from "./preferences/general_page.js";
import { buildStatsPage } from "./preferences/stats_page.js";
import { buildDonatePage } from "./preferences/donation_page.js";

export default class GSpotifyPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const generalPage = buildGeneralPage(window, settings, this.metadata);
    window.add(generalPage);
    const statsPage = buildStatsPage(window, settings);
    window.add(statsPage);
    const donatePage = buildDonatePage(window, this.path);
    window.add(donatePage);
  }
}
