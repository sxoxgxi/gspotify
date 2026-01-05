import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";

// function from https://gitlab.com/AndrewZaech/azwallpaper/-/blob/main/src/prefs.js
export function createOpenDirectoryButton(parent, settings, setting) {
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
export function createFileChooserButton(parent, settings, setting) {
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

export function createOpenURLButton(url) {
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
