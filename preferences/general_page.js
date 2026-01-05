import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import GLib from "gi://GLib";

import {
  createOpenURLButton,
  createFileChooserButton,
  createOpenDirectoryButton,
} from "./prefs_utils.js";

const BUTTONS = {
  none: "Unassigned Control",
  shuffle: "Toggle Shuffle",
  spotify: "Toggle Spotify",
  spacer: "Spacer",
  download: "Download Track",
  settings: "Open Settings",
  like: "Toggle Like",
};

export function buildGeneralPage(window, settings, metadata) {
  const generalPage = new Adw.PreferencesPage({
    title: "General",
    icon_name: "preferences-system-symbolic",
  });

  // General Group
  const generalGroup = new Adw.PreferencesGroup({
    title: "General Settings",
    description: "Configure the general behavior of the extension",
  });
  generalPage.add(generalGroup);
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
    title: "Invert Scroll Direction",
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
  const labelLengthRow = new Adw.SpinRow({
    title: "Label Length",
    subtitle: "Amount of characters to show in the label before truncating",
    adjustment: new Gtk.Adjustment({
      lower: 0,
      upper: 70,
      step_increment: 1,
      value: settings.get_int("label-length"),
    }),
  });
  settings.bind(
    "label-length",
    labelLengthRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  const presistIndicatorRow = new Adw.SwitchRow({
    title: "Persist Indicator",
    subtitle:
      "Shows Spotify's icon indicator even if the spotify client is not running, opens the app when clicked",
  });
  settings.bind(
    "presist-indicator",
    presistIndicatorRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  const minimizedSpotifyRow = new Adw.SwitchRow({
    title: "Minimized Spotify",
    subtitle:
      "Launch Spotify in minimized state when opening from the indicator",
  });
  settings.bind(
    "open-spotify-minimized",
    minimizedSpotifyRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  settings.bind(
    "presist-indicator",
    minimizedSpotifyRow,
    "sensitive",
    Gio.SettingsBindFlags.DEFAULT,
  );
  generalGroup.add(panelPositionRow);
  generalGroup.add(showInfoTipRow);
  generalGroup.add(useArtworkColorsRow);
  generalGroup.add(volumeStepRow);
  generalGroup.add(invertScrollRow);
  generalGroup.add(labelLengthRow);
  generalGroup.add(useFixedWidthRow);
  generalGroup.add(widthRow);
  generalGroup.add(presistIndicatorRow);
  generalGroup.add(minimizedSpotifyRow);

  // Controls Group
  const DEFAULT_ORDER = ["shuffle", "toggle", "spacer", "download", "settings"];

  const allButtons = Object.keys(BUTTONS);

  let order = settings.get_strv("additional-controls-order");
  if (!order.length) {
    order = [...DEFAULT_ORDER];
    settings.set_strv("additional-controls-order", order);
  }

  const orderGroup = new Adw.PreferencesGroup({
    title: "Additional Controls",
    description: "Configure button order and number of buttons",
  });

  const rows = [];

  function showSwapToast(message = "Button swapped with existing position") {
    const toast = new Adw.Toast({ title: message, timeout: 3 });
    window.add_toast(toast);
  }

  function updateAllRows() {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      row._updating = true;
      const key = order[i];
      const index = allButtons.indexOf(key);
      row.selected = index >= 0 ? index : 0;
      row._updating = false;
    }
  }

  function saveOrder(newOrder) {
    order = newOrder;
    settings.set_strv("additional-controls-order", order);
    updateAllRows();
  }

  function rebuildRows() {
    for (const row of rows) {
      orderGroup.remove(row);
    }
    rows.length = 0;

    order.forEach((key, index) => {
      addRow(index, key);
    });
  }

  function addRow(index, value = "none") {
    const row = new Adw.ComboRow({
      title: `Position ${index + 1}`,
      subtitle: "Select control",
    });

    const model = new Gtk.StringList();
    for (const key of allButtons) {
      model.append(BUTTONS[key]);
    }
    row.model = model;

    row.selected = Math.max(0, allButtons.indexOf(value));

    row.connect("notify::selected", () => {
      if (row._updating) return;

      const selectedKey = allButtons[row.selected];
      const currentKey = order[index];

      if (selectedKey === currentKey) return;

      const existingIndex = order.indexOf(selectedKey);

      if (existingIndex >= 0) {
        [order[index], order[existingIndex]] = [
          order[existingIndex],
          order[index],
        ];
        saveOrder([...order]);
        showSwapToast(
          `${BUTTONS[selectedKey]} swapped with position ${existingIndex + 1}`,
        );
      } else {
        order[index] = selectedKey;
        saveOrder([...order]);
      }
    });

    const removeButton = new Gtk.Button({
      icon_name: "user-trash-symbolic",
      valign: Gtk.Align.CENTER,
      tooltip_text: "Remove position",
    });

    removeButton.connect("clicked", () => {
      order.splice(index, 1);
      saveOrder([...order]);
      rebuildRows();
    });

    row.add_suffix(removeButton);
    row.activatable_widget = removeButton;

    rows.push(row);
    orderGroup.add(row);
  }

  const addButton = new Adw.ActionRow({
    title: "Add Position",
    activatable: true,
  });

  const addIcon = new Gtk.Image({
    icon_name: "list-add-symbolic",
  });

  addButton.add_suffix(addIcon);
  addButton.connect("activated", () => {
    saveOrder([...order, "none"]);
    rebuildRows();
  });

  orderGroup.add(addButton);

  rebuildRows();

  settings.connect("changed::additional-controls-order", () => {
    order = settings.get_strv("additional-controls-order");
    updateAllRows();
  });

  generalPage.add(orderGroup);

  const downloadsGroup = new Adw.PreferencesGroup({
    title: "Downloads Settings",
    description: "Configure the behavior of downloading system",
  });
  generalPage.add(downloadsGroup);
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

        const dialog = new Adw.Toast({
          title: `Found SpotDL v${spotdlVersion}`,
        });
        window.add_toast(dialog);
      }
    } catch {
      spotDLRow.subtitle =
        "SpotDL not found - Open spotdl's site for installation";

      const dialog = new Adw.Toast({
        title: "SpotDL not found - Open spotdl's site for installation",
      });
      window.add_toast(dialog);

      spotDLRow.add_suffix(openSpotDLsiteButton);
    }
  });
  downloadsGroup.add(spotDLRow);
  downloadsGroup.add(downloadFolderRow);

  // About Group
  const aboutGroup = new Adw.PreferencesGroup();
  generalPage.add(aboutGroup);
  const aboutRow = new Adw.ActionRow({
    title: "About GSpotify",
    subtitle: "Learn more about this extension",
    activatable: true,
  });
  aboutRow.connect("activated", () => {
    const currentYear = new Date().getFullYear();
    const about = new Adw.AboutWindow({
      application_name: metadata.name,
      version: `${metadata.version}`,
      developer_name: "sxoxgxi",
      website: metadata.url,
      issue_url: `${metadata.url}/issues`,
      license_type: Gtk.License.MIT_X11,
      copyright: `© ${currentYear} Sogi`,
      comments: metadata.description,
    });
    about.present(window);
  });
  aboutGroup.add(aboutRow);

  return generalPage;
}
