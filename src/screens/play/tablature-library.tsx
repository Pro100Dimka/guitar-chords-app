import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View
} from "react-native";
import { useTranslation } from "react-i18next";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { songFieldLimits } from "../../@interfaces";
import Text from "../../components/styled-text";
import type { Tablature } from "../../components/tablature";
import type { TabPracticeSettings } from "../../components/tablature-practice";
import {
  getTablatureSong,
  listTablatureSongs,
  saveTablature,
  TAB_LIBRARY_PAGE_SIZE
} from "../../components/tablature-library";
import palette from "../../theme/palette";
import { Action, Sheet } from "../song/tools";

export interface TabSongLink {
  id: number;
  title: string;
}

export function TablatureLibrary({
  mode,
  tab,
  practice,
  song,
  onLoad,
  onSaved,
  onNew,
  onClose
}: {
  mode: "open" | "save";
  tab: Tablature;
  practice?: TabPracticeSettings;
  song: TabSongLink | null;
  onLoad: (
    song: TabSongLink,
    tab: Tablature,
    practice?: TabPracticeSettings
  ) => void;
  onSaved: (song: TabSongLink, tab: Tablature) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(song?.title ?? "");
  const [target, setTarget] = useState<number | undefined>(song?.id);
  const [choosing, setChoosing] = useState(mode === "open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [items, setItems] = useState<TabSongLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(mode === "save" && !!song);
  const [refreshError, setRefreshError] = useState("");
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const editedTitle = useRef(false);
  const linkedId = song?.id;
  const blocked = busy || refreshing;
  const refreshFailed = !!refreshError;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== "save" || linkedId === undefined) {
      setRefreshing(false);
      setRefreshError("");
      return;
    }
    let current = true;
    setRefreshing(true);
    setRefreshError("");
    setError("");
    void getTablatureSong(linkedId)
      .then((found) => {
        if (!current) return;
        if (!found) throw new Error("SongMissing");
        if (!editedTitle.current) setTitle(found.title);
        setTarget(found.id);
      })
      .catch((failure) => {
        if (!current) return;
        const message =
          failure instanceof Error && failure.message === "SongMissing"
            ? "SongMissing"
            : "TabLoadFailed";
        setRefreshError(message);
        setError(message);
      })
      .finally(() => {
        if (current) setRefreshing(false);
      });
    return () => {
      current = false;
    };
  }, [linkedId, mode, refreshRevision]);

  useEffect(() => {
    if (!choosing) return;
    let current = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void listTablatureSongs(
        search,
        mode === "open",
        page * TAB_LIBRARY_PAGE_SIZE
      )
        .then((rows) => {
          if (current) setItems(rows);
        })
        .catch(() => {
          if (current) setError("TabLoadFailed");
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [choosing, mode, page, reload, search]);

  const select = async (id: number) => {
    if (inFlight.current || refreshing) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const found = await getTablatureSong(id);
      if (!mounted.current) return;
      if (!found) throw new Error("SongMissing");
      if (mode === "open") {
        if (!found.tablature) throw new Error("TabLoadFailed");
        onLoad(found, found.tablature, found.practice);
      } else {
        const attach = () => {
          if (!mounted.current) return;
          editedTitle.current = false;
          setTitle(found.title);
          setTarget(found.id);
          setRefreshError("");
          setChoosing(false);
        };
        if (found.tablature && found.id !== song?.id)
          Alert.alert(t("TabTitle"), t("TabReplaceAttached"), [
            { text: t("Cancel"), style: "cancel" },
            { text: t("TabAttachSong"), onPress: attach }
          ]);
        else attach();
      }
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error && failure.message === "SongMissing"
            ? "SongMissing"
            : "TabLoadFailed"
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const save = async () => {
    if (
      inFlight.current ||
      refreshing ||
      (refreshFailed && target !== undefined) ||
      !title.trim() ||
      (!tab.notes.length && !tab.rests?.length)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const id = await saveTablature({
        id: target,
        title,
        tablature: tab,
        ...(practice === undefined ? {} : { practice })
      });
      if (mounted.current) onSaved({ id, title: title.trim() }, tab);
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error && failure.message === "SongMissing"
            ? "SongMissing"
            : "TabSaveFailed"
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Sheet
      landscapeOnly
      compact
      title={t(mode === "open" ? "TabOpen" : "TabSave")}
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
    >
      {choosing ? (
        <>
          {mode === "open" ? (
            <Action
              glass
              primary
              label={t("TabNew")}
              onPress={onNew}
              disabled={busy}
            />
          ) : (
            <Action
              glass
              label={t("Back")}
              onPress={() => {
                setChoosing(false);
                if (refreshError) setError(refreshError);
              }}
              disabled={busy}
            />
          )}
          <TextInput
            style={styles.input}
            accessibilityLabel={t("Search")}
            placeholder={t("Search")}
            placeholderTextColor={palette.glass.muted}
            value={search}
            maxLength={songFieldLimits.title}
            returnKeyType="search"
            keyboardAppearance="dark"
            onSubmitEditing={Keyboard.dismiss}
            autoCorrect={false}
            editable={!blocked}
            onChangeText={(value) => {
              setSearch(value);
              setPage(0);
            }}
          />
          {(loading || busy) && (
            <ActivityIndicator
              accessibilityLabel={t("TabLoading")}
              color={palette.glass.accent}
            />
          )}
          {!loading && !error && items.length === 0 && (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name="music-box-multiple-outline"
                size={32}
                color={palette.glass.accent}
              />
              <Text style={styles.emptyText}>
                {t(mode === "open" ? "TabNoSaved" : "TabNoSongs")}
              </Text>
            </View>
          )}
          {!loading &&
            !error &&
            items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                disabled={busy}
                onPress={() => void select(item.id)}
                style={styles.item}
              >
                <View style={styles.itemIcon}>
                  <MaterialCommunityIcons
                    name="music-note-eighth"
                    size={22}
                    color={palette.glass.accent}
                  />
                </View>
                <Text numberOfLines={2} style={styles.itemTitle}>
                  {item.title}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={palette.glass.muted}
                />
              </Pressable>
            ))}
          {(page > 0 || items.length === TAB_LIBRARY_PAGE_SIZE) && (
            <View style={styles.actions}>
              <Action
                glass
                label={t("TabLibraryPrevious")}
                icon="chevron-left"
                disabled={page === 0 || busy || loading}
                onPress={() => setPage(page - 1)}
              />
              <Text style={styles.hint}>{page + 1}</Text>
              <Action
                glass
                label={t("TabLibraryNext")}
                icon="chevron-right"
                disabled={
                  items.length < TAB_LIBRARY_PAGE_SIZE || busy || loading
                }
                onPress={() => setPage(page + 1)}
              />
            </View>
          )}
        </>
      ) : (
        <>
          <Text style={styles.hint}>{t("TabSongTitle")}</Text>
          <TextInput
            testID="tab-library-title"
            accessibilityLabel={t("TabSongTitle")}
            placeholder={t("TabNewTitle")}
            placeholderTextColor={palette.glass.muted}
            style={styles.input}
            value={title}
            maxLength={songFieldLimits.title}
            onChangeText={(value) => {
              editedTitle.current = true;
              setTitle(value);
            }}
            editable={!blocked}
            keyboardAppearance="dark"
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />
          <View style={styles.destinations}>
            {[
              {
                label: "TabSaveAsNew",
                icon: "plus-circle-outline",
                selected: target === undefined,
                onPress: () => {
                  setTarget(undefined);
                  setRefreshError("");
                  setError("");
                }
              },
              {
                label: "TabAttachSong",
                icon: "music-box-outline",
                selected: target !== undefined,
                onPress: () => {
                  setPage(0);
                  setSearch("");
                  setChoosing(true);
                }
              }
            ].map((destination) => (
              <Pressable
                key={destination.label}
                accessibilityRole="button"
                accessibilityLabel={t(destination.label)}
                accessibilityState={{
                  selected: destination.selected,
                  disabled: blocked
                }}
                disabled={blocked}
                onPress={destination.onPress}
                style={[
                  styles.destination,
                  destination.selected && styles.destinationSelected
                ]}
              >
                <MaterialCommunityIcons
                  name={destination.icon}
                  size={23}
                  color={palette.glass.accent}
                />
                <Text style={styles.destinationLabel}>
                  {t(destination.label)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Action
            glass
            primary
            label={t(
              refreshing ? "TabLoading" : busy ? "TabSaving" : "TabSave"
            )}
            disabled={
              blocked ||
              (refreshFailed && target !== undefined) ||
              !title.trim() ||
              (!tab.notes.length && !tab.rests?.length)
            }
            onPress={() => void save()}
          />
        </>
      )}
      {!!error && (
        <View style={styles.error}>
          <Text accessibilityRole="alert" style={styles.hint}>
            {t(error)}
          </Text>
          {(choosing || refreshFailed) && (
            <Action
              glass
              label={t("Retry")}
              disabled={blocked || loading}
              onPress={() => {
                if (choosing) setReload(reload + 1);
                else setRefreshRevision((value) => value + 1);
              }}
            />
          )}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  destinations: { flexDirection: "row", gap: 10 },
  destination: {
    flex: 1,
    minHeight: 60,
    padding: 10,
    flexDirection: "row",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.control,
    alignItems: "center",
    justifyContent: "center"
  },
  destinationSelected: {
    borderColor: palette.glass.accent,
    backgroundColor: palette.glass.cell
  },
  destinationLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: palette.glass.ink,
    textAlign: "left"
  },
  input: {
    fontFamily: palette.typography.body,
    fontSize: 16,
    color: palette.glass.ink,
    backgroundColor: palette.glass.surface,
    borderColor: palette.glass.edge,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 48
  },
  hint: { color: palette.glass.muted, fontSize: 14 },
  empty: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 12,
    gap: 12
  },
  emptyText: {
    color: palette.glass.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center"
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  item: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: palette.glass.control,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    padding: 12
  },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: palette.glass.cell,
    alignItems: "center",
    justifyContent: "center"
  },
  itemTitle: {
    flex: 1,
    color: palette.glass.ink,
    fontSize: 16,
    lineHeight: 22
  },
  error: { gap: 8 }
});
