export default function extractYoutubeId(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1); // /VIDEO_ID
    }
    if (parsed.searchParams.has("v")) {
      return parsed.searchParams.get("v") || "";
    }
    // для embed-ссылок
    if (parsed.pathname.startsWith("/embed/")) {
      return parsed.pathname.split("/embed/")[1];
    }
    return "";
  } catch {
    return "";
  }
}
