import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class GSpotifyPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings("org.gnome.shell.extensions.gspotify");

    const page = new Adw.PreferencesPage();
    window.add(page);

    const group = new Adw.PreferencesGroup({
      title: "GSpotify Settings",
      description: "Configure the GSpotify extension",
    });
    page.add(group);

    const panelPositionRow = new Adw.ComboRow({
      title: "Panel Position",
      subtitle: "Where to show the indicator in the panel",
    });

    const stringList = new Gtk.StringList();
    stringList.append("Left");
    stringList.append("Center");
    stringList.append("Right");
    stringList.append("Far Left");
    stringList.append("Far Right");
    panelPositionRow.model = stringList;

    settings.bind(
      "panel-position",
      panelPositionRow,
      "selected",
      Gio.SettingsBindFlags.DEFAULT,
    );

    group.add(panelPositionRow);

    const showInfoTipRow = new Adw.SwitchRow({
      title: "Show Info Tip",
      subtitle:
        "Show a tip explaining play/pause behavior when the extension is enabled",
    });
    settings.bind(
      "show-info-tip",
      showInfoTipRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );

    group.add(showInfoTipRow);

    const aboutGroup = new Adw.PreferencesGroup();
    page.add(aboutGroup);

    const aboutRow = new Adw.ActionRow({
      title: "About GSpotify",
      subtitle: "Learn more about this extension",
      activatable: true,
    });

    aboutRow.connect("activated", () => {
      const currentYear = new Date().getFullYear();
      const about = new Adw.AboutWindow({
        application_name: "GSpotify",
        version: "1",
        developer_name: "sxoxgxi",
        website: "https://github.com/sxoxgxi/gspotify",
        issue_url: "https://github.com/sxoxgxi/gspotify/issues",
        license_type: Gtk.License.MIT_X11,
        copyright: `© ${currentYear} Sogi`,
        comments:
          "A GNOME Shell extension for showing and controlling Spotify.",
      });

      about.present(window);
    });

    aboutGroup.add(aboutRow);
  }
}
