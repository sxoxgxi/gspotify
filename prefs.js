import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// function from https://gitlab.com/AndrewZaech/azwallpaper/-/blob/main/src/prefs.js
function createOpenDirectoryButton(parent, settings, setting) {
  const button = new Gtk.Button({
    icon_name: "folder-open-symbolic",
    tooltip_text: "Open directory...",
    valign: Gtk.Align.CENTER,
  });

  button.connect("clicked", () => {
    const directory = settings.get_string(setting);
    const file = Gio.file_new_for_path(directory);
    const fileUri = file.get_uri();
    Gtk.show_uri(parent.get_root(), fileUri, Gdk.CURRENT_TIME);
  });

  return button;
}

// function from https://gitlab.com/AndrewZaech/azwallpaper/-/blob/main/src/prefs.js
function createFileChooserButton(parent, settings, setting) {
  const fileChooserButton = new Gtk.Button({
    icon_name: "folder-new-symbolic",
    tooltip_text: "Choose new directory...",
    valign: Gtk.Align.CENTER,
  });

  fileChooserButton.connect("clicked", () => {
    const dialog = new Gtk.FileChooserDialog({
      title: "Select a directory",
      transient_for: parent.get_root(),
      action: Gtk.FileChooserAction.SELECT_FOLDER,
    });
    dialog.add_button("Cancel", Gtk.ResponseType.CANCEL);
    dialog.add_button("Select", Gtk.ResponseType.ACCEPT);

    dialog.connect("response", (self, response) => {
      if (response === Gtk.ResponseType.ACCEPT) {
        const filePath = dialog.get_file().get_path();
        settings.set_string(setting, filePath);
        dialog.destroy();
      } else if (response === Gtk.ResponseType.CANCEL) {
        dialog.destroy();
      }
    });
    dialog.show();
  });

  return fileChooserButton;
}

function createOpenURLButton(url) {
  const button = new Gtk.Button({
    icon_name: "adw-external-link-symbolic",
    tooltip_text: `Open ${url}`,
    valign: Gtk.Align.CENTER,
  });

  button.connect("clicked", () => {
    Gio.AppInfo.launch_default_for_uri(url, null);
  });

  return button;
}

export default class GSpotifyPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage();
    window.add(page);

    // General Group
    const generalGroup = new Adw.PreferencesGroup({
      title: "General Settings",
      description: "Configure the general behavior of the extension",
    });

    page.add(generalGroup);

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

    const volumeStepAdj = new Gtk.Adjustment({
      lower: 1,
      upper: 50,
      step_increment: 1,
      value: Math.round(settings.get_double("volume-step") * 100),
    });

    const volumeStepRow = new Adw.SpinRow({
      title: "Volume Step",
      subtitle: "Percentage change when scrolling the top panel label",
      adjustment: volumeStepAdj,
      numeric: true,
      digits: 0,
    });

    const adj = volumeStepRow.adjustment;

    adj.connect("notify::value", () => {
      let value = adj.value;
      if (value < adj.lower) value = adj.lower;
      if (value > adj.upper) value = adj.upper;

      if (!isNaN(value)) {
        settings.set_double("volume-step", Math.round(value) / 100);
      }
    });

    const invertScrollRow = new Adw.SwitchRow({
      title: "Invert scroll direction",
      subtitle:
        "Touchpad-style gestures, where swiping up increases the volume and swiping down decreases it",
    });
    settings.bind(
      "invert-scroll",
      invertScrollRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const useFixedWidthRow = new Adw.SwitchRow({
      title: "Use Fixed Width",
      subtitle: "Enable fixed width for the UI panel",
    });
    settings.bind(
      "use-fixed-width",
      useFixedWidthRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const widthRow = new Adw.SpinRow({
      title: "UI Width",
      subtitle: "Fixed width in pixels (250-600)",
      adjustment: new Gtk.Adjustment({
        lower: 250,
        upper: 600,
        step_increment: 10,
        page_increment: 50,
        value: settings.get_int("ui-width"),
      }),
    });
    settings.bind("ui-width", widthRow, "value", Gio.SettingsBindFlags.DEFAULT);

    settings.bind(
      "use-fixed-width",
      widthRow,
      "sensitive",
      Gio.SettingsBindFlags.DEFAULT,
    );

    generalGroup.add(panelPositionRow);
    generalGroup.add(showInfoTipRow);
    generalGroup.add(useArtworkColorsRow);
    generalGroup.add(volumeStepRow);
    generalGroup.add(invertScrollRow);
    generalGroup.add(useFixedWidthRow);
    generalGroup.add(widthRow);

    // Downloads Group
    const downloadsGroup = new Adw.PreferencesGroup({
      title: "Downloads Settings",
      description: "Configure the behavior of downloading system",
    });
    page.add(downloadsGroup);

    const downloadFolderRow = new Adw.ActionRow({
      title: "Download Folder",
      subtitle: settings.get_string("download-folder"),
    });

    settings.bind(
      "download-folder",
      downloadFolderRow,
      "subtitle",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const fileChooserButton = createFileChooserButton(
      window,
      settings,
      "download-folder",
    );
    const openDirectoryButton = createOpenDirectoryButton(
      window,
      settings,
      "download-folder",
    );

    downloadFolderRow.add_suffix(fileChooserButton);
    downloadFolderRow.add_prefix(openDirectoryButton);
    downloadFolderRow.activatable_widget = fileChooserButton;

    const spotDLRow = new Adw.ActionRow({
      title: "SpotDL",
      subtitle: "Check if SpotDL is installed",
      activatable: true,
    });

    const openSpotDLsiteButton = createOpenURLButton(
      "https://github.com/spotDL/spotify-downloader",
    );

    spotDLRow.connect("activated", () => {
      try {
        const [success, stdout, stderr, status] =
          GLib.spawn_command_line_sync("spotdl --version");
        if (success && status === 0 && stdout.length > 0) {
          const spotdlVersion = new TextDecoder().decode(stdout).trim();
          spotDLRow.subtitle = `Found SpotDL v${spotdlVersion}`;
        }
      } catch {
        spotDLRow.subtitle =
          "SpotDL not found - Open spotdl's site for installation";
        spotDLRow.add_suffix(openSpotDLsiteButton);
      }
    });
    downloadsGroup.add(spotDLRow);
    downloadsGroup.add(downloadFolderRow);

    // About Group
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
