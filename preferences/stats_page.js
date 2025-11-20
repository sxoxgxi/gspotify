import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";

import { StatsManager } from "../stats.js";

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

export function buildStatsPage(window, settings) {
  const statsManager = new StatsManager();
  const statsPage = new Adw.PreferencesPage({
    title: "Stats",
    icon_name: "view-list-symbolic",
  });
  const stats = statsManager.getData();
  const total_played = stats.totals.tracks_played;

  const monthString = new Date().toLocaleString("default", {
    month: "long",
  });

  if (total_played === 0) {
    const noStatsGroup = new Adw.PreferencesGroup({
      title: "No Stats Available",
      description:
        "You have not played any tracks yet this month - play some and come back!",
    });
    statsPage.add(noStatsGroup);
  }

  if (total_played > 0) {
    // Overview Group
    const overviewGroup = new Adw.PreferencesGroup({
      title: "Overview",
      description: `Your listening statistics for ${monthString}`,
    });
    statsPage.add(overviewGroup);
    const tracksPlayedRow = new Adw.ActionRow({
      title: "Tracks Played",
      subtitle: stats.totals.tracks_played.toString(),
    });
    overviewGroup.add(tracksPlayedRow);
    const tracksSkippedRow = new Adw.ActionRow({
      title: "Tracks Skipped",
      subtitle: `${stats.totals.tracks_skipped.toString()} tracks or ${Math.round((stats.totals.tracks_skipped / stats.totals.tracks_played) * 100)}% of plays were skipped`,
    });
    overviewGroup.add(tracksSkippedRow);
    const playTimeRow = new Adw.ActionRow({
      title: "Total Play Time",
      subtitle: formatDuration(stats.totals.play_time_seconds),
    });
    overviewGroup.add(playTimeRow);

    // Top Artists Group
    if (stats.top.artists.length > 0) {
      const topArtistsGroup = new Adw.PreferencesGroup({
        title: "Top Artists",
        description: "Your most played artists this month",
      });
      statsPage.add(topArtistsGroup);
      stats.top.artists.slice(0, 10).forEach((artist, index) => {
        const artistRow = new Adw.ActionRow({
          title: `${index + 1}. ${artist.name}`,
          subtitle: `${artist.count} plays`,
        });
        topArtistsGroup.add(artistRow);
      });
    }

    // Top Tracks Group
    if (stats.top.tracks.length > 0) {
      const topTracksGroup = new Adw.PreferencesGroup({
        title: "Top Tracks",
        description: "Your most played tracks this month",
      });
      statsPage.add(topTracksGroup);
      stats.top.tracks.slice(0, 10).forEach((track, index) => {
        const trackRow = new Adw.ActionRow({
          title: `${index + 1}. ${track.title}`,
          subtitle: `${track.artist} • ${track.count} plays`,
        });
        topTracksGroup.add(trackRow);
      });
    }
  }

  // Metadata Group
  const metadataGroup = new Adw.PreferencesGroup({
    title: "Metadata",
  });
  statsPage.add(metadataGroup);
  if (stats.metadata.created_at) {
    const createdRow = new Adw.ActionRow({
      title: "Stats Started",
      subtitle: new Date(stats.metadata.created_at).toLocaleDateString(),
    });
    metadataGroup.add(createdRow);
  }
  if (stats.metadata.last_updated) {
    const updatedRow = new Adw.ActionRow({
      title: "Last Updated",
      subtitle: new Date(stats.metadata.last_updated).toLocaleString(),
    });
    metadataGroup.add(updatedRow);
  }

  // Reset Stats Button
  const resetStatsRow = new Adw.ActionRow({
    title: "Reset Statistics",
    subtitle: "Clear all collected statistics",
    activatable: true,
  });
  const resetButton = new Gtk.Button({
    icon_name: "user-trash-symbolic",
    valign: Gtk.Align.CENTER,
    css_classes: ["destructive-action"],
  });
  resetButton.connect("clicked", () => {
    const dialog = new Adw.MessageDialog({
      transient_for: window,
      heading: "Reset Statistics?",
      body: "This will permanently delete all your listening statistics. This action cannot be undone.",
    });
    dialog.add_response("cancel", "Cancel");
    dialog.add_response("reset", "Reset");
    dialog.set_response_appearance("reset", Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.connect("response", (self, response) => {
      if (response === "reset") {
        try {
          statsManager.reset();
          const successDialog = new Adw.MessageDialog({
            transient_for: window,
            heading: "Statistics Reset",
            body: "Your listening statistics have been cleared. Please close and reopen preferences to see changes.",
          });
          successDialog.add_response("ok", "OK");
          successDialog.present();
        } catch (e) {
          const errorDialog = new Adw.MessageDialog({
            transient_for: window,
            heading: "Error",
            body: `Failed to reset statistics: ${e.message}`,
          });
          errorDialog.add_response("ok", "OK");
          errorDialog.present();
        }
      }
    });
    dialog.present();
  });
  resetStatsRow.add_suffix(resetButton);
  resetStatsRow.activatable_widget = resetButton;
  metadataGroup.add(resetStatsRow);

  const collectStatsRow = new Adw.SwitchRow({
    title: "Collect Statistics",
    subtitle:
      "Tracks songs/artists played and time spent listening. Everything is local, no data is sent.",
  });
  settings.bind(
    "collect-stats",
    collectStatsRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  metadataGroup.add(collectStatsRow);

  return statsPage;
}
