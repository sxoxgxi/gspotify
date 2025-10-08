import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class GSpotifyPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage();
    window.add(page);

    const group = new Adw.PreferencesGroup({
      title: `${this.metadata.name} settings`,
      description: `Configure the ${this.metadata.name} extension`,
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
        "Show a tip explaining different control behavior when the extension is enabled",
    });
    settings.bind(
      "show-info-tip",
      showInfoTipRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );

    group.add(showInfoTipRow);

    const useArtworkColorsRow = new Adw.SwitchRow({
      title: "Use Artwork Colors",
      subtitle:
        "If enabled, the extension dynamically changes UI colors based on the dominant colors of the current track's album artwork",
    });
    settings.bind(
      "artwork-themed-ui",
      useArtworkColorsRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );

    group.add(useArtworkColorsRow);

    const aboutGroup = new Adw.PreferencesGroup();
    page.add(aboutGroup);

    const aboutRow = new Adw.ActionRow({
      title: `About ${this.metadata.name}`,
      subtitle: "Learn more about this extension",
      activatable: true,
    });

    aboutRow.connect("activated", () => {
      const currentYear = new Date().getFullYear();
      const about = new Adw.AboutWindow({
        application_name: this.metadata.name,
        version: `${this.metadata.version}`,
        developer_name: "sxoxgxi",
        website: this.metadata.url,
        issue_url: `${this.metadata.url}/issues`,
        license_type: Gtk.License.MIT_X11,
        copyright: `© ${currentYear} Sogi`,
        comments: this.metadata.description,
      });

      about.present(window);
    });

    aboutGroup.add(aboutRow);
  }
}
