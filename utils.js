export function getStatusSymbol(outputText) {
  if (!outputText || typeof outputText !== "string") return "⁉";

  const lower = outputText.toLowerCase();

  if (lower.includes("error") || lower.includes("failed")) {
    return "✕";
  }

  if (lower.includes("downloading")) {
    return "⤓";
  }

  if (lower.includes("embedding metadata")) {
    return "✦";
  }

  if (
    lower.includes("done") ||
    lower.includes("complete") ||
    lower.includes("downloaded")
  ) {
    return "✓";
  }

  return "⦿";
}

export function toggleSpotifyWindow(action = "toggle") {
  const windowActors = global.get_window_actors();

  for (const actor of windowActors) {
    const win = actor.get_meta_window();
    const wmClass = win.get_wm_class()?.toLowerCase();

    if (wmClass && wmClass.includes("spotify")) {
      const isMinimized = win.minimized;

      switch (action) {
        case "minimize":
          if (!isMinimized) {
            win.minimize();
            console.log("Spotify window minimized");
          } else {
            console.log("Spotify window already minimized");
          }
          break;

        case "maximize":
          if (isMinimized) {
            win.unminimize();
            win.activate(global.get_current_time());
            console.log("Spotify window restored");
          } else {
            console.log("Spotify window already visible");
          }
          break;

        case "toggle":
        default:
          if (isMinimized) {
            win.unminimize();
            win.activate(global.get_current_time());
            console.log("Spotify window restored");
          } else {
            win.minimize();
            console.log("Spotify window minimized");
          }
          break;
      }

      return true;
    }
  }

  console.warn("Spotify window not found");
  return false;
}
