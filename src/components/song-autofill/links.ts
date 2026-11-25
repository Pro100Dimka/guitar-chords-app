import { AppState, Linking, NativeModules, Platform } from "react-native";

// App Intents can open the iOS host before React subscribes to Linking. Consume
// that pending launch on startup/resume; a UUID prevents warm events repeating it.
export function createRecognitionLinking() {
  const delivered = new Set<string>();
  const remember = (url: string | null) => {
    if (
      !url ||
      !/^freetune:\/\/recognize\//.test(url) ||
      !/[?&]requestId=/.test(url)
    )
      return true;
    if (delivered.has(url)) return false;
    if (delivered.size >= 20)
      delivered.delete(delivered.values().next().value!);
    delivered.add(url);
    return true;
  };
  const pendingLaunch = async (): Promise<string | null> => {
    if (Platform.OS !== "ios") return null;
    try {
      return (
        (await NativeModules.SongRecognition?.consumeLaunchURL?.()) ?? null
      );
    } catch {
      return null;
    }
  };
  return {
    enabled: "auto" as const,
    prefixes: ["freetune://"],
    async getInitialURL() {
      const pending = await pendingLaunch();
      const url = pending ?? (await Linking.getInitialURL());
      remember(url);
      return url;
    },
    subscribe(listener: (url: string) => void) {
      let active = true;
      const deliver = (url: string | null) => {
        if (active && url && remember(url)) listener(url);
      };
      const consume = () => {
        void pendingLaunch().then(deliver);
      };
      const links = Linking.addEventListener("url", ({ url }) => {
        deliver(url);
        consume();
      });
      const state = AppState.addEventListener("change", (value) => {
        if (value === "active") consume();
      });
      consume();
      return () => {
        active = false;
        links.remove();
        state.remove();
      };
    }
  };
}
