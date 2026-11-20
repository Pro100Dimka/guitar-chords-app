import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { emptyTablature } from "../../components/tablature";
import type { Tablature } from "../../components/tablature";
import { getTablatureSong } from "../../components/tablature-library";
import type { TabSongLink } from "./tablature-library";
import type { useTablature } from "./use-tablature";

export interface PlayTabParams {
  tablatureSongId?: number;
  tablatureRequest?: number;
}

export function useTablatureSession(
  transport: ReturnType<typeof useTablature>,
  active: boolean,
  tempo: number,
  beats: number,
  stopBacking: () => void
) {
  const { t } = useTranslation();
  const navigation =
    useNavigation<BottomTabNavigationProp<{ play: PlayTabParams }>>();
  const route = useRoute<RouteProp<{ play: PlayTabParams }, "play">>();
  const [expanded, setExpanded] = useState(false);
  const [song, setSong] = useState<TabSongLink | null>(null);
  const [dialog, setDialog] = useState<"open" | "save" | null>(null);
  const [baseline, setBaseline] = useState(() => JSON.stringify(transport.tab));
  const serialized = useMemo(
    () => JSON.stringify(transport.tab),
    [transport.tab]
  );
  const dirty = serialized !== baseline;

  const stop = () => {
    transport.stopRecording();
    transport.pause();
    stopBacking();
  };
  const load = (link: TabSongLink | null, tab: Tablature) => {
    transport.setTab(tab);
    transport.setRange(null);
    transport.setLoop(false);
    transport.setSpeed(1);
    setSong(link);
    setBaseline(JSON.stringify(tab));
    setExpanded(true);
    setDialog(null);
  };
  const confirmDiscard = (action: () => void) => {
    if (!dirty) {
      action();
      return;
    }
    Alert.alert(t("TabUnsavedTitle"), t("TabDiscardMessage"), [
      { text: t("Cancel"), style: "cancel" },
      { text: t("TabDiscard"), style: "destructive", onPress: action }
    ]);
  };
  const current = useRef({ stop, load, dirty, serialized, t });
  current.current = { stop, load, dirty, serialized, t };
  const requestedId = route.params?.tablatureSongId;
  const requestedAt = route.params?.tablatureRequest;
  useEffect(() => {
    if (!active || !requestedId) return;
    let alive = true;
    const consume = () =>
      navigation.setParams({
        tablatureSongId: undefined,
        tablatureRequest: undefined
      });
    const confirm = (action: () => void) =>
      Alert.alert(
        current.current.t("TabUnsavedTitle"),
        current.current.t("TabDiscardMessage"),
        [
          {
            text: current.current.t("Cancel"),
            style: "cancel",
            onPress: () => {
              if (alive) consume();
            }
          },
          {
            text: current.current.t("TabDiscard"),
            style: "destructive",
            onPress: () => {
              if (alive) action();
            }
          }
        ]
      );
    const open = async () => {
      if (!alive) return;
      current.current.stop();
      const original = current.current.serialized;
      try {
        const found = await getTablatureSong(requestedId);
        if (!alive) return;
        if (!found?.tablature) throw new Error("TabLoadFailed");
        const apply = () => {
          current.current.stop();
          current.current.load(found, found.tablature!);
          consume();
        };
        if (current.current.serialized !== original) confirm(apply);
        else apply();
      } catch {
        if (alive) {
          Alert.alert(current.current.t("TabLoadFailed"));
          consume();
        }
      }
    };
    if (current.current.dirty) confirm(() => void open());
    else void open();
    return () => {
      alive = false;
    };
  }, [active, navigation, requestedAt, requestedId]);

  const toggle = useCallback(() => setExpanded((value) => !value), []);
  return {
    expanded,
    toggle,
    song,
    dirty,
    dialog,
    close: () => setDialog(null),
    load,
    saved: (link: TabSongLink, tab: Tablature) => {
      setSong(link);
      setBaseline(JSON.stringify(tab));
      setDialog(null);
    },
    create: () =>
      confirmDiscard(() => load(null, emptyTablature(tempo, beats))),
    open: () => {
      stop();
      setExpanded(true);
      setDialog("open");
    },
    choose: (link: TabSongLink, tab: Tablature) =>
      confirmDiscard(() => load(link, tab)),
    save: () => {
      stop();
      setDialog("save");
    },
    record: () => {
      const start = () => {
        stop();
        transport.setTab(emptyTablature(tempo, beats));
        transport.startRecording();
        setExpanded(true);
      };
      if (transport.tab.notes.length)
        Alert.alert(t("TabTitle"), t("TabRecordingReplace"), [
          { text: t("Cancel"), style: "cancel" },
          { text: t("TabRecord"), onPress: start }
        ]);
      else start();
    }
  };
}
