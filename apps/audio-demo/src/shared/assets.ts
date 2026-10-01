/** Base URL of the sound bank served by the faf-audio-assets plugin (`audio/` next to the page). */
export function audioBaseUrl(): string {
  return new URL('audio/', document.baseURI).href;
}
