import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { emptyTablature, normalizeTablature } from "../../components/tablature";
import type { Tablature } from "../../components/tablature";
import type { TablatureDraft } from "../../components/tablature-draft";
import { getTablatureSong } from "../../components/tablature-library";
import { usePreferences } from "../../components/preferences";
import {
  defaultTabPractice,
  normalizeTabPractice,
  TabPracticeSettings
} from "../../components/tablature-practice";
import type { TabSongLink } from "./tablature-library";
import type { useTablature } from "./use-tablature";
import { useTablatureDraft } from "./use-tablature-draft";

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
  const practiceOwner = useRef<number | null>(null);
  const [dialog, setDialog] = useState<"open" | "save" | null>(null);
  const [savedTab, setSavedTab] = useState(transport.tab);
  const baseline = useMemo(() => JSON.stringify(savedTab), [savedTab]);
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
  const load = (
    link: TabSongLink | null,
    tab: Tablature,
    practice?: TabPracticeSettings
  ) => {
    const normalized = normalizeTablature(tab);
    if (!normalized) return;
    // The transport may notify before React publishes the new song link.
    // Never save the newly loaded settings to the previous song in that render.
    practiceOwner.current = link?.id ?? null;
    transport.replaceTab(normalized);
    transport.setRange(null);
    transport.setLoop(false);
    transport.setSpeed(1);
    transport.setPractice(practice ?? defaultTabPractice());
    setSong(link && { id: link.id, title: link.title });
    setSavedTab(normalized);
    setExpanded(true);
    setDialog(null);
  };
  const draft = useMemo<TablatureDraft>(
    () => ({
      version: 1,
      tab: transport.tab,
      savedTab,
      song,
      practice: transport.practice
    }),
    [transport.tab, savedTab, song, transport.practice]
  );
  const workingCopy = useTablatureDraft(draft, active, (stored) => {
    practiceOwner.current = stored.song?.id ?? null;
    transport.replaceTab(stored.tab);
    transport.setPractice(stored.practice ?? defaultTabPractice());
    setSong(stored.song);
    setSavedTab(stored.savedTab);
    if (stored.tab.notes.length || stored.tab.rests?.length || stored.song)
      setExpanded(true);
  });
  useEffect(() => {
    if (!workingCopy.ready || !song || song.id !== practiceOwner.current)
      return;
    const preferences = usePreferences.getState();
    const saved = preferences.songs[song.id];
    // A deleted song must not reappear as an orphan preference entry.
    if (!saved?.tablature) return;
    if (
      JSON.stringify(normalizeTabPractice(saved.tabPractice)) !==
      JSON.stringify(transport.practice)
    )
      preferences.updateSong(song.id, { tabPractice: transport.practice });
  }, [song, transport.practice, workingCopy.ready]);
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
    if (!active || !requestedId || !workingCopy.ready) return;
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
          current.current.load(found, found.tablature!, found.practice);
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
  }, [active, navigation, requestedAt, requestedId, workingCopy.ready]);

  const toggle = useCallback(() => setExpanded((value) => !value), []);
  return {
    expanded,
    toggle,
    song,
    dirty,
    dialog,
    draftReady: workingCopy.ready,
    draftStatus: workingCopy.status,
    retryDraft: workingCopy.retry,
    resetDraft: () =>
      Alert.alert(t("TabDraftResetTitle"), t("TabDraftResetMessage"), [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("TabDraftStartNew"),
          style: "destructive",
          onPress: () => void workingCopy.startNew()
        }
      ]),
    close: () => setDialog(null),
    load,
    saved: (link: TabSongLink, tab: Tablature) => {
      const normalized = normalizeTablature(tab);
      if (!normalized) return;
      practiceOwner.current = link.id;
      setSong({ id: link.id, title: link.title });
      setSavedTab(normalized);
      setDialog(null);
    },
    create: () =>
      workingCopy.ready &&
      confirmDiscard(() => load(null, emptyTablature(tempo, beats))),
    open: () => {
      if (!workingCopy.ready) return;
      stop();
      setExpanded(true);
      setDialog("open");
    },
    choose: (
      link: TabSongLink,
      tab: Tablature,
      practice?: TabPracticeSettings
    ) => workingCopy.ready && confirmDiscard(() => load(link, tab, practice)),
    save: () => {
      if (!workingCopy.ready) return;
      stop();
      setDialog("save");
    },
    record: () => {
      if (!workingCopy.ready) return;
      const start = () => {
        stop();
        transport.startRecording();
        setExpanded(true);
      };
      if (
        transport.tab.notes.length ||
        transport.tab.rests?.length ||
        (transport.tab.barCount ?? 1) > 1
      )
        Alert.alert(t("TabTitle"), t("TabRecordingReplace"), [
          { text: t("Cancel"), style: "cancel" },
          { text: t("TabRecord"), onPress: start }
        ]);
      else start();
    }
  };
}
