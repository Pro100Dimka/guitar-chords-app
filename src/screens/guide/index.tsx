import React, { useState } from "react";
import {
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import LinearGradient from "react-native-linear-gradient";
import Text from "../../components/styled-text";
import { Action, Sheet } from "../song/tools";
import palette from "../../theme/palette";
import type { NavigationProp, RootStackParamList } from "../../router";

const sections = [
  { id: "tuner", icon: "guitar-acoustic" },
  { id: "library", icon: "music-box-multiple-outline" },
  { id: "playing", icon: "music-note-eighth" },
  { id: "recording", icon: "microphone-outline" },
  { id: "data", icon: "cloud-upload-outline" },
  { id: "help", icon: "lifebuoy" }
] as const;
const pictures = {
  guitar: require("../../../assets/images/guide/guitar.webp"),
  chromatic: require("../../../assets/images/guide/chromatic.webp"),
  rhythm: require("../../../assets/images/guide/rhythm.webp"),
  add: require("../../../assets/images/guide/add.jpg"),
  recognize: require("../../../assets/images/guide/recognize.jpg"),
  editor: require("../../../assets/images/guide/editor.jpg"),
  record: require("../../../assets/images/guide/record.jpg")
};
const articles: {
  id: string;
  section: (typeof sections)[number]["id"];
  icon: string;
  picture?: keyof typeof pictures;
}[] = [
  { id: "virtualGuitar", section: "playing", icon: "guitar-acoustic" },
  {
    id: "start",
    section: "library",
    icon: "rocket-launch-outline",
    picture: "add"
  },
  {
    id: "guitar",
    section: "tuner",
    icon: "guitar-acoustic",
    picture: "guitar"
  },
  {
    id: "chromatic",
    section: "tuner",
    icon: "tune-vertical",
    picture: "chromatic"
  },
  { id: "calibration", section: "tuner", icon: "tuning-fork" },
  { id: "tunings", section: "tuner", icon: "tune" },
  {
    id: "add",
    section: "library",
    icon: "plus-circle-outline",
    picture: "add"
  },
  {
    id: "recognize",
    section: "library",
    icon: "microphone",
    picture: "recognize"
  },
  {
    id: "import",
    section: "library",
    icon: "file-document-outline",
    picture: "editor"
  },
  { id: "audioFile", section: "library", icon: "file-music-outline" },
  {
    id: "editing",
    section: "library",
    icon: "text-box-edit-outline",
    picture: "editor"
  },
  { id: "library", section: "library", icon: "star-outline" },
  { id: "reading", section: "playing", icon: "chevron-double-down" },
  { id: "chords", section: "playing", icon: "guitar-pick-outline" },
  {
    id: "rhythm",
    section: "playing",
    icon: "music-note-eighth",
    picture: "rhythm"
  },
  { id: "practice", section: "playing", icon: "target" },
  { id: "easier", section: "playing", icon: "guitar-pick-outline" },
  {
    id: "record",
    section: "recording",
    icon: "record-circle-outline",
    picture: "record"
  },
  {
    id: "takes",
    section: "recording",
    icon: "folder-music-outline"
  },
  { id: "backup", section: "data", icon: "cloud-upload-outline" },
  { id: "restore", section: "data", icon: "backup-restore" },
  { id: "privacy", section: "data", icon: "shield-check-outline" },
  { id: "language", section: "data", icon: "translate" },
  { id: "noLyrics", section: "help", icon: "text-search" },
  { id: "noMic", section: "help", icon: "microphone-off" },
  { id: "noSound", section: "help", icon: "volume-off" }
];
const normalize = (value: string) =>
  value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export default function Guide() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const filtered = articles.filter((article) => {
    if (section !== "all" && article.section !== section) return false;
    if (!words.length) return true;
    const steps = t(`GuideArticles.${article.id}.steps`, {
      returnObjects: true
    });
    const text = normalize(
      ["title", "summary", "tip", "keywords"]
        .map((field) => t(`GuideArticles.${article.id}.${field}`))
        .concat(Array.isArray(steps) ? steps : [])
        .join(" ")
    );
    return words.every((word) => text.includes(word));
  });
  const open = (id: string) => {
    Keyboard.dismiss();
    navigation.navigate("GuideArticle", { id });
  };
  const row = (article: (typeof articles)[number]) => (
    <Pressable
      key={article.id}
      accessibilityRole="button"
      onPress={() => open(article.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <MaterialCommunityIcons
          name={article.icon}
          size={23}
          color={palette.glass.accent}
        />
      </View>
      <View style={styles.words}>
        <Text style={styles.rowTitle}>
          {t(`GuideArticles.${article.id}.title`)}
        </Text>
        <Text style={styles.description} numberOfLines={2}>
          {t(`GuideArticles.${article.id}.summary`)}
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={21}
        color={palette.glass.muted}
      />
    </Pressable>
  );
  const browsing = !words.length && section === "all";
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: Math.max(24, insets.bottom + 16) }
      ]}
    >
      <Text accessibilityRole="header" style={styles.title}>
        {t("GuideWelcome")}
      </Text>
      <Text style={styles.intro}>{t("GuideIntro")}</Text>
      <View style={styles.search}>
        <MaterialCommunityIcons
          name="magnify"
          size={24}
          color={palette.glass.accent}
        />
        <TextInput
          accessibilityLabel={t("GuideSearch")}
          placeholder={t("GuideSearch")}
          placeholderTextColor={palette.glass.muted}
          underlineColorAndroid="transparent"
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
          autoCorrect={false}
        />
        {!!query && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("ClearSearch")}
            onPress={() => setQuery("")}
            hitSlop={8}
            style={styles.clear}
          >
            <MaterialCommunityIcons
              name="close"
              size={20}
              color={palette.glass.muted}
            />
          </Pressable>
        )}
      </View>
      {!browsing && (
        <ScrollView
          horizontal
          style={styles.chipScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {[{ id: "all", icon: "view-grid-outline" }, ...sections].map(
            (item) => (
              <Action
                key={item.id}
                compact
                glass
                selected={section === item.id}
                label={t(`GuideSections.${item.id}`)}
                onPress={() => setSection(item.id)}
              />
            )
          )}
        </ScrollView>
      )}
      {browsing ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => open("start")}
            style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={[palette.glass.cell, palette.glass.surface]}
              style={StyleSheet.absoluteFillObject}
            />
            <MaterialCommunityIcons
              name="play-circle-outline"
              size={37}
              color={palette.glass.accent}
            />
            <View style={styles.words}>
              <Text style={styles.rowTitle}>{t("GuideQuickStart")}</Text>
              <Text style={styles.description}>{t("GuideQuickHint")}</Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={22}
              color={palette.glass.accent}
            />
          </Pressable>
          <Text accessibilityRole="header" style={styles.sectionHeading}>
            {t("GuideExplore")}
          </Text>
          <View style={styles.grid}>
            {sections.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => setSection(item.id)}
                style={({ pressed }) => [
                  styles.tile,
                  { width: width < 350 ? "100%" : "48%" },
                  pressed && styles.pressed
                ]}
              >
                <MaterialCommunityIcons
                  name={item.icon}
                  size={30}
                  color={palette.glass.accent}
                />
                <Text style={styles.rowTitle}>
                  {t(`GuideSections.${item.id}`)}
                </Text>
                <Text style={styles.description}>
                  {t(`GuideSectionHints.${item.id}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text accessibilityRole="header" style={styles.sectionHeading}>
            {t("GuidePopular")}
          </Text>
          {articles
            .filter((article) =>
              ["recognize", "chords", "takes", "noLyrics"].includes(article.id)
            )
            .map(row)}
        </>
      ) : (
        <>
          <View style={styles.resultsHeader}>
            <Text accessibilityRole="header" style={styles.sectionHeading}>
              {t(words.length ? "GuideResults" : `GuideSections.${section}`, {
                count: filtered.length
              })}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setQuery("");
                setSection("all");
              }}
            >
              <Text style={styles.link}>{t("GuideReset")}</Text>
            </Pressable>
          </View>
          {filtered.length ? (
            filtered.map(row)
          ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name="text-search"
                size={42}
                color={palette.glass.accent}
              />
              <Text style={styles.rowTitle}>{t("GuideNoResults")}</Text>
              <Text style={styles.intro}>{t("GuideNoResultsHint")}</Text>
            </View>
          )}
        </>
      )}
      <Text style={styles.offline}>
        <MaterialCommunityIcons name="check-circle-outline" size={15} />{" "}
        {t("GuideOffline")}
      </Text>
    </ScrollView>
  );
}

export function GuideArticle() {
  const { params } = useRoute<RouteProp<RootStackParamList, "GuideArticle">>();
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [zoom, setZoom] = useState(false);
  const article = articles.find((item) => item.id === params?.id);
  if (!article)
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t("GuideNoResults")}</Text>
        <Action
          label={t("Back")}
          onPress={() => navigation.popTo("Tabs", { screen: "guide" })}
        />
      </View>
    );
  const key = `GuideArticles.${article.id}`;
  const steps = t(`${key}.steps`, { returnObjects: true });
  const picture = article.picture ? pictures[article.picture] : undefined;
  const imageSize = picture ? Image.resolveAssetSource(picture) : undefined;
  const imageWidth = Math.min(width - 72, 340);
  const imageHeight = imageSize
    ? (imageWidth * imageSize.height) / imageSize.width
    : 440;
  const openSection = () => {
    const target = {
      tuner: "tuner",
      library: "library",
      playing: "library",
      recording: "library",
      data: "settings",
      help: "settings"
    }[article.section];
    navigation.popTo("Tabs", {
      screen: article.id === "virtualGuitar" ? "play" : target
    });
  };
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: Math.max(24, insets.bottom + 16) }
      ]}
    >
      <Text style={styles.eyebrow}>
        {t(`GuideSections.${article.section}`)}
      </Text>
      <Text accessibilityRole="header" style={styles.title}>
        {t(`${key}.title`)}
      </Text>
      <Text style={styles.intro}>{t(`${key}.summary`)}</Text>
      {article.id === "recognize" && Platform.OS !== "android" && (
        <Text style={styles.tip}>{t("GuideAndroidOnly")}</Text>
      )}
      <View style={styles.steps}>
        {(Array.isArray(steps) ? steps : []).map((text, step) => (
          <View key={step} style={styles.step}>
            <View style={styles.number}>
              <Text style={styles.numberText}>{step + 1}</Text>
            </View>
            <Text style={styles.stepText}>{text}</Text>
          </View>
        ))}
      </View>
      <View style={styles.tipCard}>
        <MaterialCommunityIcons
          name="lightbulb-outline"
          size={23}
          color={palette.glass.accent}
        />
        <Text style={styles.tip}>{t(`${key}.tip`)}</Text>
      </View>
      {picture && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("GuideEnlarge")}
          onPress={() => setZoom(true)}
          style={styles.figure}
        >
          <Image
            source={picture}
            style={styles.screenshot}
            resizeMode="contain"
            accessibilityLabel={t(`${key}.title`)}
          />
          <View style={styles.caption}>
            <Text style={styles.description}>{t("GuideScreenshot")}</Text>
            <MaterialCommunityIcons
              name="arrow-expand"
              size={19}
              color={palette.glass.accent}
            />
          </View>
        </Pressable>
      )}
      <Action
        primary
        label={t(`GuideOpen.${article.section}`)}
        onPress={openSection}
      />
      <Action
        glass
        label={t("GuideTitle")}
        onPress={() => {
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.popTo("Tabs", { screen: "guide" });
        }}
      />
      <Text accessibilityRole="header" style={styles.sectionHeading}>
        {t("GuideRelated")}
      </Text>
      {articles
        .filter(
          (item) => item.section === article.section && item.id !== article.id
        )
        .slice(0, 3)
        .map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            style={styles.related}
            onPress={() => navigation.replace("GuideArticle", { id: item.id })}
          >
            <Text style={styles.relatedText}>
              {t(`GuideArticles.${item.id}.title`)}
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={palette.glass.accent}
            />
          </Pressable>
        ))}
      {zoom && picture && (
        <Sheet title={t("GuideScreenshot")} onClose={() => setZoom(false)}>
          <Image
            source={picture}
            resizeMode="contain"
            style={[
              styles.zoomImage,
              {
                width: imageWidth,
                height: imageHeight
              }
            ]}
          />
          <Text style={styles.offline}>{t("GuideScreenshotHint")}</Text>
        </Sheet>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    gap: 16
  },
  eyebrow: {
    color: palette.glass.accent,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "600"
  },
  title: {
    color: palette.glass.ink,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "600"
  },
  intro: { color: palette.glass.muted, fontSize: 15, lineHeight: 24 },
  sectionHeading: {
    color: palette.glass.ink,
    fontSize: 19,
    fontWeight: "600",
    marginTop: 8
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 14,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    borderRadius: 18,
    backgroundColor: palette.glass.surface
  },
  input: {
    backgroundColor: palette.colors.transparent,
    borderWidth: 0,
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    paddingVertical: 12,
    color: palette.glass.ink,
    fontFamily: palette.typography.body,
    fontSize: 15
  },
  clear: {
    width: 44,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center"
  },
  words: { flex: 1, gap: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: palette.glass.surface,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  icon: {
    width: 40,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  rowTitle: {
    color: palette.glass.ink,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "600"
  },
  description: { color: palette.glass.muted, fontSize: 13, lineHeight: 20 },
  quick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    overflow: "hidden"
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12
  },
  tile: {
    backgroundColor: palette.glass.surface,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge,
    borderRadius: 20,
    padding: 18,
    gap: 12
  },
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: 8, paddingVertical: 4 },
  resultsHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  link: { color: palette.glass.accent, fontSize: 13, paddingVertical: 12 },
  empty: { alignItems: "center", gap: 16, paddingVertical: 32 },
  offline: {
    color: palette.glass.muted,
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 8
  },
  steps: { gap: 20, marginVertical: 8 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  number: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.gold.rimShade,
    backgroundColor: palette.glass.cell
  },
  numberText: { color: palette.glass.accent, fontSize: 14, fontWeight: "600" },
  stepText: { flex: 1, color: palette.glass.ink, fontSize: 16, lineHeight: 26 },
  tipCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: palette.glass.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  tip: { flex: 1, color: palette.glass.muted, fontSize: 14, lineHeight: 23 },
  figure: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: palette.glass.surface,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  zoomImage: { alignSelf: "center" },
  screenshot: { width: "100%", height: 300 },
  caption: {
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  related: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  relatedText: {
    flex: 1,
    color: palette.glass.ink,
    fontSize: 15,
    lineHeight: 23
  },
  pressed: { opacity: 0.72 }
});
