export function getStatusSymbol(outputText) {
  if (!outputText || typeof outputText !== "string") return "⌛";

  const lower = outputText.toLowerCase();

  if (lower.includes("error") || lower.includes("failed")) {
    return "✕";
  }

  if (lower.includes("downloading")) {
    return "⤓";
  }

  if (lower.includes("embedding metadata")) {
    return "🪶";
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
