const EXTENSION_TAG = "[GSpotify]";

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
            logInfo("Spotify window minimized");
          } else {
            logInfo("Spotify window already minimized");
          }
          break;

        case "maximize":
          if (isMinimized) {
            win.unminimize();
            win.activate(global.get_current_time());
            logInfo("Spotify window restored");
          } else {
            logInfo("Spotify window already visible");
          }
          break;

        case "toggle":
        default:
          if (isMinimized) {
            win.unminimize();
            win.activate(global.get_current_time());
            logInfo("Spotify window restored");
          } else {
            win.minimize();
            logInfo("Spotify window minimized");
          }
          break;
      }

      return true;
    }
  }

  logWarn("Spotify window not found");
  return false;
}

export function logInfo(...args) {
  console.log(`${EXTENSION_TAG}`, ...args);
}

export function logWarn(...args) {
  console.warn(`${EXTENSION_TAG}`, ...args);
}

export function logError(...args) {
  console.error(`${EXTENSION_TAG}`, ...args);
}
