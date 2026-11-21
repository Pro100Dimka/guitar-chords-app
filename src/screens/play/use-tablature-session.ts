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
  const appliedPractice = useRef<string | null>(
    JSON.stringify(transport.practice)
  );
  const sessionRevision = useRef(0);
  const confirmationEpoch = useRef(0);
  const mounted = useRef(false);
  const foreground = useRef(active);
  foreground.current = active;
  const [dialog, setDialog] = useState<"open" | "save" | null>(null);
  const [savedTab, setSavedTab] = useState(transport.tab);
  const baseline = useMemo(() => JSON.stringify(savedTab), [savedTab]);
  const serialized = useMemo(
    () => JSON.stringify(transport.tab),
    [transport.tab]
  );
  const dirty = serialized !== baseline;

  useEffect(() => {
    confirmationEpoch.current++;
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) confirmationEpoch.current++;
  }, [active]);

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
    sessionRevision.current++;
    // The transport may notify before React publishes the new song link.
    // Never save the newly loaded settings to the previous song in that render.
    practiceOwner.current = link?.id ?? null;
    const settings = normalizeTabPractice(practice);
    appliedPractice.current = JSON.stringify(settings);
    transport.replaceTab(normalized);
    transport.setRange(null);
    transport.setLoop(false);
    transport.setSpeed(1);
    transport.setPractice(settings);
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
    sessionRevision.current++;
    practiceOwner.current = stored.song?.id ?? null;
    const settings = normalizeTabPractice(stored.practice);
    appliedPractice.current = JSON.stringify(settings);
    transport.replaceTab(stored.tab);
    transport.setPractice(settings);
    setSong(stored.song);
    setSavedTab(stored.savedTab);
    if (stored.tab.notes.length || stored.tab.rests?.length || stored.song)
      setExpanded(true);
  });
  useEffect(() => {
    const practice = JSON.stringify(transport.practice);
    // Restoring a working copy is not an edit to the saved library. A backup
    // restore or another screen may have changed the library in the meantime.
    if (!workingCopy.ready || practice === appliedPractice.current) return;
    if (!song || song.id !== practiceOwner.current) return;
    appliedPractice.current = practice;
    const preferences = usePreferences.getState();
    const saved = preferences.songs[song.id];
    // A deleted song must not reappear as an orphan preference entry.
    if (!saved?.tablature) return;
    if (JSON.stringify(normalizeTabPractice(saved.tabPractice)) !== practice)
      preferences.updateSong(song.id, { tabPractice: transport.practice });
  }, [song, transport.practice, workingCopy.ready]);
  const scopedConfirmation = (action: () => void) => {
    const revision = sessionRevision.current;
    const epoch = confirmationEpoch.current;
    const original = serialized;
    return () => {
      if (
        !mounted.current ||
        !foreground.current ||
        revision !== sessionRevision.current ||
        epoch !== confirmationEpoch.current ||
        original !== current.current.serialized
      )
        return;
      action();
    };
  };
  const confirmDiscard = (action: () => void) => {
    if (!mounted.current || !foreground.current) return;
    const apply = scopedConfirmation(action);
    if (!dirty) {
      apply();
      return;
    }
    Alert.alert(t("TabUnsavedTitle"), t("TabDiscardMessage"), [
      { text: t("Cancel"), style: "cancel" },
      { text: t("TabDiscard"), style: "destructive", onPress: apply }
    ]);
  };
  const current = useRef({ stop, load, dirty, serialized, t });
  current.current = { stop, load, dirty, serialized, t };
  const requestedId = route.params?.tablatureSongId;
  const requestedAt = route.params?.tablatureRequest;
  useEffect(() => {
    if (!active || !requestedId || !workingCopy.ready) return;
    let alive = true;
    const revision = sessionRevision.current;
    const consume = () =>
      navigation.setParams({
        tablatureSongId: undefined,
        tablatureRequest: undefined
      });
    const confirm = (action: () => void) => {
      const original = current.current.serialized;
      const epoch = confirmationEpoch.current;
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
              if (!alive) return;
              if (
                revision !== sessionRevision.current ||
                epoch !== confirmationEpoch.current ||
                original !== current.current.serialized
              ) {
                consume();
                return;
              }
              action();
            }
          }
        ]
      );
    };
    const open = async () => {
      if (!alive) return;
      if (sessionRevision.current !== revision) {
        consume();
        return;
      }
      current.current.stop();
      const original = current.current.serialized;
      try {
        const found = await getTablatureSong(requestedId);
        if (!alive) return;
        // A later New/Open/Save/Record action supersedes this navigation even
        // when the two scores happen to contain exactly the same notes.
        if (sessionRevision.current !== revision) {
          consume();
          return;
        }
        if (!found?.tablature) throw new Error("TabLoadFailed");
        const apply = () => {
          if (sessionRevision.current !== revision) {
            consume();
            return;
          }
          current.current.stop();
          current.current.load(found, found.tablature!, found.practice);
          consume();
        };
        if (current.current.serialized !== original) confirm(apply);
        else apply();
      } catch {
        if (alive) {
          if (sessionRevision.current === revision)
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
  const callbackRevision = sessionRevision.current;
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
    close: () => {
      sessionRevision.current++;
      setDialog(null);
    },
    load,
    saved: (link: TabSongLink, tab: Tablature) => {
      if (!mounted.current || callbackRevision !== sessionRevision.current)
        return;
      const normalized = normalizeTablature(tab);
      if (!normalized) return;
      sessionRevision.current++;
      practiceOwner.current = link.id;
      // Saving explicitly adopts this working copy, including any practice
      // changes made while the database operation was pending.
      appliedPractice.current = null;
      setSong({ id: link.id, title: link.title });
      setSavedTab(normalized);
      setDialog(null);
    },
    create: () =>
      workingCopy.ready &&
      confirmDiscard(() => load(null, emptyTablature(tempo, beats))),
    open: () => {
      if (!workingCopy.ready || !mounted.current || !foreground.current) return;
      sessionRevision.current++;
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
      if (!workingCopy.ready || !mounted.current || !foreground.current) return;
      sessionRevision.current++;
      stop();
      setDialog("save");
    },
    record: () => {
      if (!workingCopy.ready || !mounted.current || !foreground.current) return;
      sessionRevision.current++;
      const start = scopedConfirmation(() => {
        stop();
        transport.startRecording();
        setExpanded(true);
      });
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
