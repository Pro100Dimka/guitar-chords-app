import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import LinearGradient from "react-native-linear-gradient";
import {
  Alert,
  AppState,
  ImageBackground,
  Linking,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle
} from "react-native";
import Text from "../../components/styled-text";
import {
  SafeAreaView,
  useSafeAreaInsets
} from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { useTranslation } from "react-i18next";
import {
  SongPreferences,
  SongRhythm,
  normalizeRhythm
} from "@/components/preferences";
import palette from "@/theme/palette";
import {
  acousticEngine,
  selectedChordShape
} from "../../components/acoustic-player";
import {
  AcousticInstrument,
  prepareAcousticInstrument,
  transferAcousticInstrument
} from "../../components/acoustic-instrument";
import { performanceAudio } from "../../components/performance-audio";
import guitarBackground from "../../../assets/images/gold-background.webp";
import {
  chordShapeOptions,
  easierPositions,
  Frets,
  songChords,
  songChordSequence,
  songSections,
  guitarMidi,
  transposeChord
} from "./chords";
import {
  rhythms,
  pickingPatterns,
  allRhythms,
  rhythmSymbols,
  rhythmReference,
  pickingReference,
  rhythmMeterLabel
} from "./rhythms";

export function Action({
  label,
  onPress,
  selected = false,
  disabled = false,
  glass = false,
  accessibilityLabel,
  icon,
  primary = false,
  compact = false,
  showLabel = false,
  notation = false,
  accessibilityRole = "button",
  testID,
  style
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  glass?: boolean;
  accessibilityLabel?: string;
  icon?: string | React.ReactElement;
  primary?: boolean;
  compact?: boolean;
  showLabel?: boolean;
  notation?: boolean;
  accessibilityRole?: "button" | "tab";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const finish =
    selected || primary ? (notation ? palette.notation : palette.finish) : null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        compact && styles.compactAction,
        selected && styles.selected,
        glass && styles.glassAction,
        (selected || primary) && styles.goldAction,
        primary && styles.primaryAction,
        !!icon && styles.iconAction,
        !!icon && compact && styles.compactIconAction,
        !!icon && showLabel && styles.labeledAction,
        !!icon && showLabel && compact && styles.compactLabeledAction,
        notation && styles.notationAction,
        notation && !!icon && showLabel && styles.notationLabeledAction,
        notation && !!icon && !showLabel && styles.notationIconAction,
        notation && (selected || primary) && styles.notationSelected,
        style,
        pressed && styles.pressed,
        disabled && styles.dim
      ]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={
          finish?.goldColors ?? [
            "rgba(255,255,255,0.06)",
            "rgba(255,255,255,0)"
          ]
        }
        style={[
          styles.actionGradient,
          !!icon && styles.iconGradient,
          !!icon && showLabel && styles.labeledGradient,
          notation && styles.notationGradient
        ]}
        locations={finish?.locations ?? [0, 1]}
      />
      {typeof icon === "string" ? (
        <MaterialCommunityIcons
          name={icon}
          size={notation ? 17 : 21}
          style={notation ? styles.notationIcon : undefined}
          color={selected || primary ? palette.gold.ink : palette.glass.ink}
        />
      ) : (
        (icon ?? (
          <Text
            numberOfLines={notation ? 1 : undefined}
            adjustsFontSizeToFit={notation}
            style={[
              styles.actionText,
              compact && styles.compactActionText,
              notation && styles.notationText,
              glass && styles.glassText,
              (selected || primary) && styles.goldText
            ]}
          >
            {label}
          </Text>
        ))
      )}
      {!!icon && showLabel && (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={[
            styles.actionCaption,
            notation && styles.notationCaption,
            (selected || primary) && styles.goldText
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function TempoControl({
  value,
  onChange,
  label,
  accessibilityLabel = label,
  disabled = false
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  return (
    <View style={styles.tempoControl}>
      <Action
        glass
        compact
        icon="chevron-left"
        label="−"
        accessibilityLabel={`${accessibilityLabel}: −`}
        disabled={disabled || value <= 40}
        onPress={() => {
          if (!disabled && value > 40) onChange(Math.max(40, value - 5));
        }}
      />
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${accessibilityLabel}: ${value} BPM`}
        style={styles.tempoReadout}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={styles.tempoLabel}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={styles.tempoValue}
        >
          {value}
          <Text style={styles.tempoUnit}> BPM</Text>
        </Text>
      </View>
      <Action
        glass
        compact
        icon="chevron-right"
        label="+"
        accessibilityLabel={`${accessibilityLabel}: +`}
        disabled={disabled || value >= 200}
        onPress={() => {
          if (!disabled && value < 200) onChange(Math.min(200, value + 5));
        }}
      />
    </View>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  musical = false,
  compact = false,
  visible = true,
  landscapeOnly = false,
  maxWidth = 760,
  scrollable = true,
  subtitle,
  toolbar,
  footer,
  dense = false,
  scrollKey,
  headerAccessory
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  musical?: boolean;
  compact?: boolean;
  visible?: boolean;
  landscapeOnly?: boolean;
  maxWidth?: number;
  scrollable?: boolean;
  subtitle?: string;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  dense?: boolean;
  scrollKey?: string;
  headerAccessory?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={
        landscapeOnly ? ["landscape-right"] : ["portrait", "landscape"]
      }
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[
          styles.scrim,
          { paddingTop: insets.top + 8 },
          dense && styles.notationScrim
        ]}
      >
        <Pressable
          style={styles.backdrop}
          accessibilityLabel={t("Close")}
          onPress={onClose}
        />
        <SafeAreaView
          edges={["bottom", "left", "right"]}
          style={[
            styles.sheet,
            !compact && styles.fullSheet,
            { width: Math.min(width - 16, maxWidth) }
          ]}
        >
          {musical && (
            <ImageBackground
              source={guitarBackground}
              resizeMode="stretch"
              blurRadius={0}
              style={StyleSheet.absoluteFillObject}
            />
          )}
          <LinearGradient
            pointerEvents="none"
            colors={[
              "rgba(5,9,12,0.04)",
              "rgba(5,9,12,0.18)",
              "rgba(5,9,12,0.55)"
            ]}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[styles.sheetHeader, dense && styles.denseSheetHeader]}>
            <Text
              accessibilityRole="header"
              style={[styles.sheetTitle, dense && styles.notationTitle]}
            >
              {title}
            </Text>
            {!!subtitle && (
              <Text
                numberOfLines={1}
                style={[styles.sheetSubtitle, dense && styles.notationSubtitle]}
              >
                {subtitle}
              </Text>
            )}
            {headerAccessory}
            <Action
              compact
              notation={dense}
              style={dense ? styles.notationClose : undefined}
              icon="close"
              testID="sheet-close"
              label={t("Close")}
              onPress={onClose}
            />
          </View>
          {toolbar}
          {scrollable ? (
            <ScrollView
              key={scrollKey}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              style={compact ? styles.compactScroll : styles.musicScroll}
              contentContainerStyle={[
                styles.sheetContent,
                dense && styles.denseSheetContent
              ]}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={compact ? styles.compactScroll : styles.musicScroll}>
              {children}
            </View>
          )}
          {footer}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Diagram({
  frets,
  width = 104,
  selected = false
}: {
  frets: Frets;
  width?: number;
  selected?: boolean;
}) {
  const ink = selected ? palette.glass.accent : palette.glass.ink;
  const positive = frets.filter(
    (fret): fret is number => fret !== null && fret > 0
  );
  const start = Math.max(...positive) > 4 ? Math.min(...positive) : 1;
  const fretCount = Math.max(4, Math.max(...positive) - start + 1);
  const bottom = 30 + fretCount * 24;
  return (
    <Svg
      width={width}
      height={((bottom + 28) * width) / 150}
      viewBox={`0 0 150 ${bottom + 28}`}
      accessible={false}
    >
      {Array.from({ length: fretCount + 1 }, (_, i) => (
        <Line
          key={`f${i}`}
          x1={28}
          x2={128}
          y1={30 + i * 24}
          y2={30 + i * 24}
          stroke={selected ? palette.glass.accent : palette.glass.muted}
          strokeWidth={i === 0 && start === 1 ? 3 : 1}
        />
      ))}
      {frets.map((fret, i) => (
        <React.Fragment key={i}>
          <Line
            x1={28 + i * 20}
            x2={28 + i * 20}
            y1={30}
            y2={bottom}
            stroke={selected ? palette.glass.accent : palette.glass.muted}
          />
          {[null, 0].includes(fret) ? (
            <SvgText
              x={28 + i * 20}
              y={20}
              textAnchor="middle"
              fontSize={13}
              fill={ink}
            >
              {fret === null ? "×" : "○"}
            </SvgText>
          ) : (
            <Circle
              cx={28 + i * 20}
              cy={42 + ((fret ?? 0) - start) * 24}
              r={7}
              fill={ink}
            />
          )}
          <SvgText
            x={28 + i * 20}
            y={bottom + 22}
            textAnchor="middle"
            fontSize={10}
            fill={palette.glass.muted}
          >
            {["E", "A", "D", "G", "B", "e"][i]}
          </SvgText>
        </React.Fragment>
      ))}
      {start > 1 && (
        <SvgText x={5} y={47} fontSize={12} fill={palette.glass.ink}>
          {start}
        </SvgText>
      )}
    </Svg>
  );
}

export function ChordSheet({
  capo = 0,
  chord,
  value,
  onChange,
  onClose,
  visible: opened = true
}: {
  chord: string;
  capo?: number;
  value?: number;
  onChange: (index: number) => void;
  onClose: () => void;
  visible?: boolean;
}) {
  const { t } = useTranslation();

  const selectedIndex = useMemo(
    () => selectedChordShape(chord, value)?.index,
    [chord, value]
  );
  const options = useMemo(
    () => chordShapeOptions(chord, selectedIndex),
    [chord, selectedIndex]
  );
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const diagramWidth = Math.min(
    132,
    (Math.min(width, 704) - 64) / (landscape ? 4 : 2) - 28
  );
  const selectedPage = Math.max(
    0,
    Math.floor(
      options.findIndex((option) => option.index === selectedIndex) / 4
    )
  );
  const [page, setPage] = useState(selectedPage);
  const pageCount = Math.max(1, Math.ceil(options.length / 4));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => options.slice(currentPage * 4, currentPage * 4 + 4),
    [options, currentPage]
  );
  const nativePreview = performanceAudio.preparedFingeringSupported;
  const previewKeys = visible.map(
    ({ frets }) => `fingering:${JSON.stringify([capo, ...frets])}`
  );
  const previewKeysKey = JSON.stringify(previewKeys);
  const preparedPreviews = useRef(new Map<string, string>());
  const pendingPreview = useRef<string | null>(null);
  const previewOwner = useRef(true);
  const previewVisible = useRef(opened);
  previewVisible.current = opened;
  useEffect(() => {
    previewOwner.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        pendingPreview.current = null;
        performanceAudio.stopPlayback();
      }
    });
    return () => {
      subscription.remove();
      previewOwner.current = false;
      pendingPreview.current = null;
      performanceAudio.stopPlayback();
    };
  }, []);
  const playWhenReady = useCallback((key: string, prepared: boolean) => {
    if (!prepared || !previewOwner.current || !previewVisible.current) return;
    if (!preparedPreviews.current.has(key))
      preparedPreviews.current.set(key, "");
    if (pendingPreview.current === key) {
      pendingPreview.current = null;
      performanceAudio.playPreparedGuitar(key);
    }
  }, []);
  useEffect(() => {
    preparedPreviews.current.clear();
    pendingPreview.current = null;
    if (!opened || !nativePreview) return;
    let canceled = false;
    const keys: string[] = JSON.parse(previewKeysKey);
    keys.forEach((key) => {
      void performanceAudio
        .prepareFingering(key, "")
        .then((prepared) => {
          if (!canceled) playWhenReady(key, prepared);
        })
        .catch(() => {
          if (!canceled) preparedPreviews.current.delete(key);
        });
    });
    return () => {
      canceled = true;
    };
  }, [previewKeysKey, nativePreview, opened, playWhenReady]);
  useEffect(() => {
    if (!opened) {
      pendingPreview.current = null;
      if (nativePreview) performanceAudio.stopPlayback();
    }
  }, [opened, nativePreview]);
  const [audition, setAudition] = useState({
    index: selectedIndex,
    request: 0
  });
  const previousChord = useRef(chord);
  useEffect(() => {
    if (previousChord.current !== chord) {
      previousChord.current = chord;
      setPage(selectedPage);
      setAudition({ index: 0, request: 0 });
    } else if (!opened) {
      setAudition((previous) => ({ ...previous, request: 0 }));
    }
  }, [chord, opened, selectedPage]);
  return (
    <>
      {opened && (
        <RhythmPlayer
          autoplay
          autoStart={
            !nativePreview &&
            opened &&
            previousChord.current === chord &&
            audition.request > 0 &&
            visible.some((option) => option.index === audition.index)
          }
          stroke={audition.request}
          chords={[chord]}
          capo={capo}
          fingerings={visible.map((option) => option.frets)}
          previewKeys={nativePreview ? previewKeys : undefined}
          onPreviewReady={(key, wave) => {
            if (!previewVisible.current || !previewKeys.includes(key)) return;
            preparedPreviews.current.set(key, wave);
            void performanceAudio
              .prepareFingering(key, wave)
              .then((prepared) => playWhenReady(key, prepared))
              .catch(() => preparedPreviews.current.delete(key));
          }}
          activeFingering={Math.max(
            0,
            visible.findIndex((option) => option.index === audition.index)
          )}
          pattern="D-------"
          meter={4}
          tempo={68}
        />
      )}
      <Sheet
        title={chord}
        onClose={() => {
          pendingPreview.current = null;
          if (nativePreview) performanceAudio.stopPlayback();
          onClose();
        }}
        musical
        visible={opened}
      >
        {options.length === 0 && (
          <Text style={styles.description}>{t("NoFingering")}</Text>
        )}
        <View style={styles.shapes}>
          {visible.map(({ frets, index, position, label }, visibleIndex) => (
            <Pressable
              key={String(frets)}
              accessibilityRole="button"
              accessibilityLabel={`${t("Fingering")} ${index + 1}: ${frets.map((fret) => fret ?? "×").join(", ")}`}
              accessibilityState={{ selected: selectedIndex === index }}
              onPressIn={() => {
                if (nativePreview) {
                  const key = previewKeys[visibleIndex];
                  pendingPreview.current = key;
                  void performanceAudio
                    .prepareFingering(key, "")
                    .then(async (prepared) => {
                      if (!prepared) {
                        const wave = preparedPreviews.current.get(key);
                        if (
                          wave &&
                          previewOwner.current &&
                          previewVisible.current &&
                          pendingPreview.current === key
                        )
                          prepared = await performanceAudio.prepareFingering(
                            key,
                            wave
                          );
                      }
                      playWhenReady(key, prepared);
                    })
                    .catch(() => preparedPreviews.current.delete(key));
                }
                setAudition((previous) => ({
                  index,
                  request: previous.request + 1
                }));
              }}
              onPress={() => onChange(index)}
              style={[
                styles.shape,
                landscape && styles.landscapeShape,
                selectedIndex === index && styles.chordSelected
              ]}
            >
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.035)", "rgba(255,255,255,0)"]}
                style={styles.shapeGradient}
              />
              <Text style={styles.positionLabel}>
                {position === 0
                  ? t("OpenPosition")
                  : t("PositionFret", {
                      fret: position
                    })}
              </Text>
              <Diagram
                frets={frets}
                width={diagramWidth}
                selected={selectedIndex === index}
              />
              <Text style={[styles.actionText, styles.glassText]}>
                {label}
                {selectedIndex === index ? " ✓" : ""}
              </Text>
            </Pressable>
          ))}
        </View>
        {pageCount > 1 && (
          <View style={styles.pages}>
            <Action
              glass
              icon="chevron-left"
              label={t("PreviousShapes")}
              disabled={currentPage === 0}
              onPress={() => setPage(currentPage - 1)}
            />
            <View
              style={styles.pageDots}
              accessibilityLabel={`${currentPage + 1} / ${pageCount}`}
            >
              {Array.from({ length: Math.min(5, pageCount) }, (_, i) => {
                const index =
                  Math.min(
                    Math.max(0, currentPage - 2),
                    Math.max(0, pageCount - 5)
                  ) + i;
                return (
                  <View
                    key={index}
                    style={[
                      styles.pageDot,
                      index === currentPage && styles.pageDotActive
                    ]}
                  />
                );
              })}
            </View>
            <Action
              glass
              icon="chevron-right"
              label={t("NextShapes")}
              disabled={currentPage + 1 === pageCount}
              onPress={() => setPage(currentPage + 1)}
            />
          </View>
        )}
      </Sheet>
    </>
  );
}

export function SongTools({
  content = "",
  value,
  onChange,
  onClose,
  initialTab = "reading"
}: {
  content?: string;
  initialTab?: "reading" | "rhythm";
  value: SongPreferences;
  onChange: (patch: Partial<SongPreferences>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"reading" | "rhythm" | "practice">(initialTab);
  const [easier, setEasier] = useState(false);
  const controls: {
    key: "fontSize" | "transpose" | "capo" | "speed" | "tempo";
    label: string;
    min: number;
    max: number;
    step: number;
  }[] = [
    { key: "fontSize", label: t("TextSize"), min: 16, max: 32, step: 2 },
    { key: "transpose", label: t("Transpose"), min: -11, max: 11, step: 1 },
    { key: "capo", label: t("Capo"), min: 0, max: 12, step: 1 },
    { key: "speed", label: t("ScrollSpeed"), min: 4, max: 60, step: 2 }
  ];
  return (
    <Sheet
      title={t(easier && tab === "reading" ? "PlayEasier" : "SongTools")}
      onClose={onClose}
      musical
    >
      <View style={styles.segments}>
        {(["reading", "rhythm", "practice"] as const).map((key) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            style={[styles.segment, tab === key && styles.segmentSelected]}
            onPress={() => setTab(key)}
          >
            {tab === key && (
              <LinearGradient
                pointerEvents="none"
                colors={palette.finish.goldColors}
                locations={palette.finish.locations}
                style={styles.actionGradient}
              />
            )}
            <Text style={[styles.segmentText, tab === key && styles.goldText]}>
              {t(
                { reading: "Reading", rhythm: "Rhythm", practice: "Practice" }[
                  key
                ]
              )}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === "reading" ? (
        <>
          {!easier && (
            <View style={styles.controlList}>
              {controls.map(({ key, label, min, max, step }) => (
                <View key={key} style={styles.controlRow}>
                  <Text style={styles.label}>{label}</Text>
                  <View style={styles.stepper}>
                    <Action
                      glass
                      icon="minus"
                      label="−"
                      accessibilityLabel={`${label}: −`}
                      disabled={value[key] <= min}
                      onPress={() =>
                        onChange({ [key]: Math.max(min, value[key] - step) })
                      }
                    />
                    <Text style={styles.value}>{value[key]}</Text>
                    <Action
                      glass
                      icon="plus"
                      label="+"
                      accessibilityLabel={`${label}: +`}
                      disabled={value[key] >= max}
                      onPress={() =>
                        onChange({ [key]: Math.min(max, value[key] + step) })
                      }
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
          <Action
            glass
            label={t(easier ? "BackToReading" : "PlayEasier")}
            selected={easier}
            onPress={() => setEasier(!easier)}
          />
          {easier && (
            <EasierChords content={content} value={value} onChange={onChange} />
          )}
        </>
      ) : tab === "rhythm" ? (
        <RhythmEditor value={value} onChange={onChange} content={content} />
      ) : (
        <TransitionPractice
          content={content}
          value={value}
          onChange={onChange}
          onChooseRhythm={() => setTab("rhythm")}
        />
      )}
    </Sheet>
  );
}

function EasierChords({
  content,
  value,
  onChange
}: {
  content: string;
  value: SongPreferences;
  onChange: (patch: Partial<SongPreferences>) => void;
}) {
  const { t } = useTranslation();
  const [previous, setPrevious] = useState<Pick<
    SongPreferences,
    "capo" | "shapes"
  > | null>(null);
  const chords = useMemo(() => songChords(content), [content]);
  const options = useMemo(
    () => easierPositions(chords, value.transpose, value.capo),
    [chords, value.transpose, value.capo]
  );
  return (
    <>
      <Text style={styles.label}>{t("CurrentCapo", { capo: value.capo })}</Text>
      {!options.length && (
        <Text style={styles.description}>
          {t(chords.length ? "NoEasierPosition" : "NoSongChords")}
        </Text>
      )}
      {options.map((option) => (
        <View key={option.capo} style={styles.rhythmCard}>
          <Text style={styles.label}>
            {t(option.capo ? "CapoPosition" : "WithoutCapo", {
              capo: option.capo
            })}
          </Text>
          <Text style={styles.description}>{option.chords.join(" · ")}</Text>
          <Action
            glass
            primary
            label={t("ApplyPosition")}
            onPress={() => {
              setPrevious({ capo: value.capo, shapes: value.shapes });
              onChange({
                capo: option.capo,
                shapes: { ...value.shapes, ...option.shapes }
              });
            }}
          />
        </View>
      ))}
      {previous && (
        <Action
          glass
          label={t("UndoPosition")}
          onPress={() => {
            onChange(previous);
            setPrevious(null);
          }}
        />
      )}
    </>
  );
}

function TransitionPractice({
  content,
  value,
  onChange,
  onChooseRhythm
}: {
  content: string;
  value: SongPreferences;
  onChange: (patch: Partial<SongPreferences>) => void;
  onChooseRhythm: () => void;
}) {
  const { t } = useTranslation();
  const source = useMemo(
    () =>
      songSections(content).flatMap((section) =>
        songChordSequence(section.content).map((chord) => ({
          chord,
          section: section.id
        }))
      ),
    [content]
  );
  const entries = useMemo(
    () =>
      source.map((entry) => ({
        ...entry,
        chord: transposeChord(entry.chord, value.transpose - value.capo)
      })),
    [source, value.transpose, value.capo]
  );
  const sequence = useMemo(
    () => entries.map((entry) => entry.chord),
    [entries]
  );
  const chords = useMemo(() => [...new Set(sequence)], [sequence]);
  const [start, setStart] = useState(0);
  const ordered = useMemo(
    () => [...sequence.slice(start), ...sequence.slice(0, start)],
    [sequence, start]
  );
  const orderedEntries = useMemo(
    () => [...entries.slice(start), ...entries.slice(0, start)],
    [entries, start]
  );
  const baseRhythm = useMemo(
    () =>
      normalizeRhythm({
        strum: value.strum,
        strumMeter: value.strumMeter,
        strumDivision: value.strumDivision,
        strumPreset: value.strumPreset
      }),
    [value.strum, value.strumMeter, value.strumDivision, value.strumPreset]
  );
  const arrangements = useMemo(
    () =>
      Object.keys(value.rhythmSections ?? {}).length
        ? orderedEntries.map(
            (entry) => value.rhythmSections[entry.section] ?? baseRhythm
          )
        : undefined,
    [orderedEntries, value.rhythmSections, baseRhythm]
  );
  if (!sequence.length)
    return <Text style={styles.description}>{t("NoSongChords")}</Text>;
  return (
    <>
      {value.strum ||
      entries.some((entry) => value.rhythmSections[entry.section]?.strum) ? (
        <RhythmPlayer
          pattern={value.strum}
          meter={value.strumMeter}
          division={value.strumDivision}
          tempo={value.tempo}
          practice={ordered}
          arrangements={arrangements}
          chords={ordered}
          capo={value.capo}
          shapes={value.shapes}
        />
      ) : (
        <Action label={t("ChooseSongRhythm")} onPress={onChooseRhythm} />
      )}
      <TempoControl
        label={t("Tempo")}
        value={value.tempo}
        onChange={(tempo) => onChange({ tempo })}
      />
      <Text style={styles.description}>{t("PracticeStartChord")}</Text>
      <View style={styles.row}>
        {chords.map((chord) => (
          <Action
            glass
            key={chord}
            label={chord}
            selected={ordered[0] === chord}
            onPress={() => setStart(sequence.indexOf(chord))}
          />
        ))}
      </View>
      <Text style={styles.description}>{sequence.join(" → ")}</Text>
    </>
  );
}

const rhythmCounts: Record<number, string[]> = {
  2: ["", "&"],
  3: ["", "&", "a"],
  4: ["", "e", "&", "a"]
};

export function RhythmGrid({
  pattern,
  meter,
  division = 2
}: {
  pattern: string;
  meter: number;
  division?: number;
}) {
  const beatsPerRow = division > 2 ? (meter % 2 === 0 ? 2 : 1) : meter;
  const columns = beatsPerRow * division;
  const slots =
    Math.ceil(pattern.length / (meter * division)) * meter * division;
  return (
    <View style={styles.rhythmRows}>
      {Array.from({ length: Math.ceil(slots / columns) }, (_, bar) => (
        <View key={bar} style={styles.beats}>
          {Array.from({ length: columns }, (_, step) => {
            const position = bar * columns + step;
            const beat = position % (meter * division);
            const symbol = pattern[position] ?? "-";
            return (
              <View
                key={step}
                style={[styles.beat, symbol !== "-" && styles.beatPlayed]}
              >
                <Text style={styles.beatCount}>
                  {beat % division === 0
                    ? beat / division + 1
                    : rhythmCounts[division][beat % division]}
                </Text>
                <Text style={styles.beatSymbol}>{rhythmSymbols[symbol]}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function RhythmPlayer({
  pattern,
  meter,
  division = 2,
  tempo,
  compact = false,
  autoplay = false,
  autoStart = autoplay,
  onStopped,
  onStarted,
  practice,
  chords = ["Am", "C", "G", "Em"],
  capo = 0,
  shapes = {},
  fingerings,
  previewKeys,
  onPreviewReady,
  activeFingering = 0,
  stroke,
  arrangements
}: {
  arrangements?: SongRhythm[];
  autoplay?: boolean;
  stroke?: number;
  fingerings?: Frets[];
  previewKeys?: string[];
  onPreviewReady?: (key: string, wave: string) => void;
  activeFingering?: number;
  autoStart?: boolean;
  onStopped?: () => void;
  onStarted?: () => void;
  practice?: string[];
  compact?: boolean;
  chords?: string[];
  capo?: number;
  shapes?: Record<string, number>;
  pattern: string;
  meter: number;
  division?: number;
  tempo: number;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState(AppState.currentState === "active");
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [preparationError, setPreparationError] = useState(false);
  const [instrument, setInstrument] = useState<{
    spec: AcousticInstrument;
    chunks: string[];
  } | null>(null);
  const transferToken = useRef(0);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setActive(state === "active")
    );
    return () => listener.remove();
  }, []);
  const slots =
    Math.ceil(pattern.length / (meter * division)) * meter * division;
  const padded = pattern.padEnd(slots, "-");
  const progressionKey = (chords.length ? chords : ["C"]).join(" ");
  const progression = useMemo(
    () => progressionKey.split(" "),
    [progressionKey]
  );
  const distinctChords = useMemo(
    () => [...new Set(progression)],
    [progression]
  );
  const shapesKey = JSON.stringify(
    fingerings
      ? {}
      : Object.fromEntries(
          distinctChords.map((chord) => [chord, shapes[chord]])
        )
  );
  const fingeringsKey = JSON.stringify(fingerings ?? null);
  const previewKeysKey = JSON.stringify(previewKeys ?? []);
  const frequencies = useMemo(() => {
    const selected: Record<string, number> = JSON.parse(shapesKey);
    const notesFor = (frets: Frets | undefined) =>
      frets?.flatMap((fret, string) =>
        fret === null
          ? []
          : [
              {
                frequency:
                  440 * 2 ** ((guitarMidi[string] + fret + capo - 69) / 12),
                string
              }
            ]
      ) ?? [];
    const positions: Frets[] | null = JSON.parse(fingeringsKey);
    if (positions) return positions.map(notesFor);
    const byChord = new Map(
      distinctChords.map((chord) => [
        chord,
        notesFor(selectedChordShape(chord, selected[chord])?.frets)
      ])
    );
    return progression.map((chord) => byChord.get(chord)!);
  }, [progression, distinctChords, shapesKey, fingeringsKey, capo]);
  const fingeringPreview = stroke !== undefined;
  const nativePreview = !!previewKeys?.length;
  const instrumentSpec = useMemo<AcousticInstrument>(
    () => ({
      chords: progression,
      frequencies,
      previewKeys: JSON.parse(previewKeysKey),
      preview: fingeringPreview
    }),
    [frequencies, progression, previewKeysKey, fingeringPreview]
  );
  useEffect(() => {
    setInstrument(null);
    setPreparationError(false);
    web.current?.injectJavaScript("window.invalidateInstrument?.();true;");
    if (!active || !frequencies.every((notes) => notes.length)) return;
    const controller = new AbortController();
    void prepareAcousticInstrument(instrumentSpec, controller.signal)
      .then((chunks) => {
        if (chunks && !controller.signal.aborted)
          setInstrument({ spec: instrumentSpec, chunks });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn("Rhythm instrument preparation failed", error);
          setPreparationError(true);
        }
      });
    return () => controller.abort();
  }, [active, frequencies, instrumentSpec]);
  const labels = JSON.stringify({
    play: t(practice ? "StartPractice" : "ListenRhythm"),
    stop: t("Pause"),
    error: t("RhythmAudioError"),
    done: t("PracticeDone"),
    seconds: t("SecondsShort")
  });
  const playConfig = JSON.stringify({
    pattern: padded,
    meter,
    division,
    tempo,
    practice: !!practice,
    stroke: stroke ?? null,
    activeFingering,
    arrangements,
    requested: autoplay ? autoStart : null
  });
  const preview = useMemo(
    () => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{background:transparent}body{margin:0;background:transparent;font-family:system-ui;color:${palette.glass.ink}}button{width:100%;height:48px;border:1px solid ${palette.glass.edge};border-radius:14px;background:${palette.glass.play};color:${palette.gold.ink};box-shadow:0 0 12px #ffb00077,inset 0 1px 1px #fff9c9;border-color:#ffe59b;background:linear-gradient(#fff2a6,#ffd65a 16%,#ffbc08 48%,#ffaa00 52%,#ffd34a);font:600 19px system-ui}#count{height:28px;line-height:28px;text-align:center;font-size:13px}${compact ? "button{width:44px;height:44px;border-radius:50%;margin:2px;box-shadow:0 0 2px #ffb00077,inset 0 1px 1px #fff9c9}#count{display:none}" : ""}</style></head><body><button id="play"></button><div id="count"></div><script>
    let context,engine,timer,playing=false,step=0,next=0,start=0,preparing=Promise.resolve(),playToken=0,lastChord=-1,singleStroke=false,activeFingering=0,loading=true,wantsPlay=false,instrumentToken=0;
    let pattern='D-D-D-D-',tempo=80,meter=4,division=2,practice=false,arrangements=[],bar=0,slot=0,patternStep=0,planKey='',scheduled=[];
    let chords=[],frequencies=[],incomingToken=0,incomingChunks=[];
    const beatCounts=${JSON.stringify(rhythmCounts)};
    const labels=${labels};
    const button=document.getElementById('play'), count=document.getElementById('count');button.textContent=${compact ? JSON.stringify("▶") : "labels.play"};button.setAttribute('aria-label',labels.play);
    function stop(){playToken++;playing=false;wantsPlay=false;clearTimeout(timer);engine?.stop();button.textContent=${compact ? JSON.stringify("▶") : "labels.play"};button.setAttribute('aria-label',labels.play);count.textContent='';}
    const createAcousticPlayer=${acousticEngine};
    function tick(){
      if(!playing)return;const now=context.currentTime;
      if(practice&&now-start>=60){stop();count.textContent=labels.done;return;}
      if(next<now){const delay=now+.025-next;start+=delay;next+=delay;}
      while(next<now+.5){
        if(practice&&next>=start+60)break;
        const chordIndex=singleStroke?activeFingering:bar%chords.length;
        const plan=arrangements[chordIndex]||{strum:pattern,strumMeter:meter,strumDivision:division};
        const beats=plan.strumMeter||meter,parts=plan.strumDivision||division;
        const raw=plan.strum||'-'.repeat(beats*parts),activePattern=raw.padEnd(Math.ceil(raw.length/(beats*parts))*beats*parts,'-');
        const key=activePattern+':'+beats+':'+parts;
        if(key!==planKey){patternStep=0;planKey=key;}
        const index=patternStep++%activePattern.length,hit=activePattern[index];
        scheduled.push({when:next,chordIndex,beat:slot%parts===0?String(Math.floor(slot/parts)+1):beatCounts[parts][slot%parts]});
        step++;
        if(hit!=='-'){
          const end=engine.stroke(frequencies[chordIndex],hit,next,index,lastChord!==-1&&chords[lastChord]!==chords[chordIndex],activePattern);
          lastChord=chordIndex;
          if(singleStroke){timer=setTimeout(()=>{stop();},Math.max(0,(end||next+1)-context.currentTime)*1000);return;}
        }
        next+=60/tempo/parts;
        if(++slot>=beats*parts){slot=0;bar++;}
      }
      while(scheduled.length>1&&scheduled[1].when<=now)scheduled.shift();
      const current=scheduled[0],elapsed=Math.max(0,now-start);
      if(current&&current.when<=now)count.textContent=chords[current.chordIndex]+' · '+current.beat+(practice?' · '+Math.max(0,60-Math.floor(elapsed))+' '+labels.seconds:'');
      timer=setTimeout(tick,20);
    }
    function prepareAudio(){if(!context){context=${nativePreview ? "new OfflineAudioContext(2,1,44100)" : "new(window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'})"};engine=createAcousticPlayer(context);}return preparing;}
    function audioError(error){stop();button.textContent=labels.error;button.setAttribute('aria-label',labels.error);window.ReactNativeWebView?.postMessage(JSON.stringify({type:'audioError',message:String(error)}));}
    async function prepareFingerings(data,token){
      const remaining=new Set(data.previewKeys.map((_,index)=>index));
      while(remaining.size&&token===instrumentToken){
        const index=remaining.has(activeFingering)?activeFingering:remaining.values().next().value;
        remaining.delete(index);
        const wave=await engine.renderPreview(data.frequencies[index]);
        if(token!==instrumentToken)return;
        window.ReactNativeWebView?.postMessage(JSON.stringify({type:'fingering',key:data.previewKeys[index],wave}));
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    async function play(){
      const token=++playToken;wantsPlay=true;button.disabled=true;
      try{
        if(window.navigator?.audioSession)window.navigator.audioSession.type='playback';
        const prepared=prepareAudio();await context.resume();await prepared;
        if(token!==playToken||document.hidden)return;
        step=0;bar=0;slot=0;patternStep=0;planKey='';scheduled=[];lastChord=-1;start=context.currentTime+.015;next=start;playing=true;
        button.textContent=${compact ? JSON.stringify("❚❚") : "labels.stop"};button.setAttribute('aria-label',labels.stop);tick();window.ReactNativeWebView?.postMessage('started');
      }catch(e){audioError(e);}
      finally{if(token===playToken||!playing)button.disabled=false;}
    }
    window.invalidateInstrument=()=>{
      const resume=playing||wantsPlay;stop();wantsPlay=resume;loading=true;
      instrumentToken++;incomingToken=0;incomingChunks=[];
    };
    window.beginInstrument=token=>{window.invalidateInstrument();incomingToken=token;};
    window.appendInstrument=(token,chunk)=>{if(token===incomingToken)incomingChunks.push(chunk);};
    window.cancelInstrument=token=>{if(token===incomingToken)window.invalidateInstrument();};
    window.finishInstrument=token=>{
      if(token!==incomingToken)return;
      const encoded=incomingChunks.join('');incomingChunks=[];
      try{window.loadInstrument(JSON.parse(encoded));}
      catch(error){loading=true;audioError(error);}
    };
    window.loadInstrument=data=>{
      const resume=playing||wantsPlay,token=++instrumentToken;
      stop();wantsPlay=resume;loading=true;chords=data.chords;frequencies=data.frequencies;
      prepareAudio();preparing=engine.loadBank(data.bank);
      preparing.then(()=>{
        if(token!==instrumentToken)return;loading=false;
        if(data.previewKeys.length)prepareFingerings(data,token).catch(audioError);
        if(wantsPlay)play();
      }).catch(error=>{if(token!==instrumentToken)return;loading=false;audioError(error);});
    };
    window.configurePlayer=config=>{
      const resume=config.requested===null?(playing||wantsPlay):config.requested;
      stop();arrangements=config.arrangements||[];pattern=config.pattern;tempo=config.tempo;meter=config.meter;division=config.division||2;practice=config.practice;singleStroke=config.stroke!==null;activeFingering=config.activeFingering;
      wantsPlay=resume;if(resume&&!loading)play();
    };
    button.onclick=()=>{
      if(playing||wantsPlay){stop();return;}
      if(!loading){play();return;}
      wantsPlay=true;
      prepareAudio();
      const token=playToken;
      context.resume().catch(()=>{
        if(token!==playToken)return;
        stop();button.textContent=labels.error;button.setAttribute('aria-label',labels.error);
        window.ReactNativeWebView?.postMessage('stopped');
      });
    };
    prepareAudio();window.ReactNativeWebView?.postMessage('ready');
    document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();window.ReactNativeWebView?.postMessage('stopped');}});
    window.addEventListener('pagehide',()=>{stop();context?.close().catch(()=>{});});
  </script></body></html>`,
    [labels, compact, nativePreview]
  );
  useEffect(() => {
    setReady(false);
  }, [preview, active]);
  useEffect(() => {
    if (!active || !ready || instrument?.spec !== instrumentSpec) return;
    const player = web.current;
    if (!player) return;
    const controller = new AbortController();
    const token = ++transferToken.current;
    void transferAcousticInstrument(
      instrument.chunks,
      token,
      (script) => player.injectJavaScript(script),
      controller.signal
    ).catch((error) => {
      if (!controller.signal.aborted) {
        console.warn("Rhythm instrument transfer failed", error);
        setPreparationError(true);
      }
    });
    return () => {
      controller.abort();
      player.injectJavaScript(`window.cancelInstrument?.(${token});true;`);
    };
  }, [active, ready, instrument, instrumentSpec]);
  useEffect(() => {
    if (ready)
      web.current?.injectJavaScript(
        `window.configurePlayer(${playConfig});true;`
      );
  }, [ready, playConfig]);
  const source = useMemo(() => ({ html: preview }), [preview]);
  const unavailable = progression.filter(
    (_, index) => !frequencies[index]?.length
  );
  if (preparationError)
    return <Text style={styles.description}>{t("RhythmAudioError")}</Text>;
  if (unavailable.length)
    return autoplay ? null : (
      <Text style={styles.description}>
        {t("NoFingering")}: {unavailable.join(", ")}
      </Text>
    );
  return (
    <View style={autoplay ? styles.hiddenPreview : undefined}>
      {active && (
        <WebView
          ref={web}
          onLoadStart={() => setReady(false)}
          originWhitelist={["about:blank"]}
          source={source}
          style={
            autoplay
              ? styles.hiddenPreview
              : compact
                ? styles.compactPreview
                : styles.preview
          }
          scrollEnabled={false}
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          ignoreSilentHardwareSwitch={!nativePreview}
          onMessage={({ nativeEvent }) => {
            if (nativeEvent.data.startsWith("{")) {
              try {
                const message = JSON.parse(nativeEvent.data);
                if (message.type === "audioError") {
                  console.warn("Rhythm audio failed", message.message);
                  setPreparationError(true);
                  onStopped?.();
                }
                if (
                  message.type === "fingering" &&
                  typeof message.key === "string" &&
                  typeof message.wave === "string" &&
                  message.wave.length <= 8000000
                )
                  onPreviewReady?.(message.key, message.wave);
              } catch {}
              return;
            }
            if (nativeEvent.data === "ready") setReady(true);
            if (nativeEvent.data === "started") onStarted?.();
            if (nativeEvent.data === "stopped") onStopped?.();
          }}
          onShouldStartLoadWithRequest={({ url }) => url === "about:blank"}
        />
      )}
    </View>
  );
}

function RhythmEditor({
  content,
  value,
  onChange
}: {
  content: string;
  value: SongPreferences;
  onChange: (patch: Partial<SongPreferences>) => void;
}) {
  const { t } = useTranslation();
  const [scope, setScope] = useState("");
  const blocks = useMemo(
    () =>
      songSections(content).map((section) => ({
        ...section,
        chords: songChordSequence(section.content)
      })),
    [content]
  );
  const sections = useMemo(
    () =>
      [
        ...new Map(
          blocks
            .filter((section) => section.id)
            .map((section) => [section.id, section])
        ).values()
      ].slice(0, 128),
    [blocks]
  );
  const selected = sections.find((section) => section.id === scope);
  const override = selected ? value.rhythmSections?.[selected.id] : undefined;
  const current = { ...value, ...override };
  const baseRhythm = useMemo(
    () =>
      normalizeRhythm({
        strum: value.strum,
        strumMeter: value.strumMeter,
        strumDivision: value.strumDivision,
        strumPreset: value.strumPreset
      }),
    [value.strum, value.strumMeter, value.strumDivision, value.strumPreset]
  );
  const arrangements = useMemo(
    () =>
      Object.keys(value.rhythmSections ?? {}).length
        ? blocks.flatMap((section) =>
            section.chords.map(
              () => value.rhythmSections[section.id] ?? baseRhythm
            )
          )
        : undefined,
    [blocks, value.rhythmSections, baseRhythm]
  );
  const selectedContent = useMemo(
    () =>
      selected
        ? blocks
            .filter((block) => block.id === selected.id)
            .map((block) => block.content)
            .join("\n")
        : content,
    [selected, blocks, content]
  );
  const change = (patch: Partial<SongPreferences>) => {
    if (patch.tempo !== undefined) {
      onChange({ tempo: patch.tempo });
      return;
    }
    if (selected)
      onChange({
        rhythmSections: {
          ...value.rhythmSections,
          [selected.id]: normalizeRhythm({ ...current, ...patch })
        }
      });
    else onChange(patch);
  };
  return (
    <>
      <Text style={styles.label}>{t("PatternForSection")}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, styles.sectionChoices]}
      >
        <Action
          glass
          label={t("WholeSong")}
          selected={!selected}
          onPress={() => setScope("")}
        />
        {sections.map((section) => (
          <Action
            glass
            key={section.id}
            label={section.title}
            selected={selected?.id === section.id}
            onPress={() => setScope(section.id)}
          />
        ))}
      </ScrollView>
      {!sections.length && (
        <Text style={styles.description}>{t("AddSongSectionsHint")}</Text>
      )}
      {selected && (
        <Text style={styles.description}>
          {t(override ? "SectionPatternOwn" : "SectionPatternInherited")}
        </Text>
      )}
      {selected && override && (
        <Action
          glass
          label={t("UseWholeSongPattern")}
          onPress={() => {
            const next = { ...value.rhythmSections };
            delete next[selected.id];
            onChange({ rhythmSections: next });
          }}
        />
      )}
      <PatternEditor
        key={selected?.id ?? ""}
        content={selectedContent}
        value={current}
        onChange={change}
        arrangements={selected ? undefined : arrangements}
      />
    </>
  );
}

function PatternEditor({
  content,
  value,
  onChange,
  arrangements
}: {
  arrangements?: SongRhythm[];
  content: string;
  value: SongPreferences;
  onChange: (patch: Partial<SongPreferences>) => void;
}) {
  const { t } = useTranslation();
  const sequence = useMemo(() => songChordSequence(content), [content]);
  const chords = useMemo(
    () =>
      sequence.map((chord) =>
        transposeChord(chord, value.transpose - value.capo)
      ),
    [sequence, value.transpose, value.capo]
  );
  const [kind, setKind] = useState<"strum" | "picking">(
    /[1-6]/.test(value.strum) ? "picking" : "strum"
  );
  const catalog = kind === "picking" ? pickingPatterns : rhythms;
  const [browsing, setBrowsing] = useState(
    !value.strum && !arrangements?.some((setting) => setting.strum)
  );
  const [editing, setEditing] = useState(false);
  const [audition, setAudition] = useState("");
  const [playingAudition, setPlayingAudition] = useState("");
  const modes = (
    <View style={styles.row}>
      {(["strum", "picking"] as const).map((mode) => (
        <Action
          glass
          key={mode}
          label={t(mode === "strum" ? "Strumming" : "Fingerpicking")}
          selected={kind === mode}
          onPress={() => {
            setKind(mode);
            setBrowsing(true);
            setAudition("");
            setEditing(false);
          }}
        />
      ))}
    </View>
  );
  const unavailable = useMemo(() => {
    const missing = new Set(
      [...new Set(chords)].filter(
        (chord) => !selectedChordShape(chord, value.shapes[chord])
      )
    );
    return chords.filter((chord) => missing.has(chord));
  }, [chords, value.shapes]);
  const previewRhythm = allRhythms.find((item) => item.id === audition);
  const preset = allRhythms.find(
    (item) =>
      item.id === value.strumPreset &&
      item.pattern === value.strum &&
      item.meter === value.strumMeter
  );
  if (browsing)
    return (
      <>
        {modes}
        {kind === "picking" && (
          <Text style={styles.description}>{t("PickingNotationHint")}</Text>
        )}
        <Text style={[styles.title, styles.glassText]}>
          {t("RhythmCatalog")}
        </Text>
        {unavailable.length > 0 && (
          <Text style={styles.description}>
            {t("NoFingering")}: {unavailable.join(", ")}
          </Text>
        )}
        {catalog.map((item) => (
          <View
            key={item.id}
            style={[
              styles.rhythmCard,
              preset?.id === item.id && styles.rhythmCardSelected
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(item.title)}
              accessibilityState={{ selected: preset?.id === item.id }}
              onPress={() => {
                onChange({
                  strum: item.pattern,
                  strumMeter: item.meter,
                  strumDivision: item.division,
                  strumPreset: item.id
                });
              }}
              style={[styles.rhythmRows, styles.rhythmChoice]}
            >
              <View style={[styles.rhythmHeading, styles.rhythmCardTitle]}>
                <Text style={styles.label}>{t(item.title)}</Text>
                <Text style={styles.positionLabel}>
                  {rhythmMeterLabel(item.meter, item.division)}
                </Text>
              </View>
              <RhythmGrid
                pattern={item.pattern}
                meter={item.meter}
                division={item.division}
              />
            </Pressable>
            <View style={styles.rhythmControls}>
              <Action
                primary
                disabled={unavailable.length > 0}
                icon={playingAudition === item.id ? "pause" : "play"}
                label={`${t(playingAudition === item.id ? "Pause" : "ListenRhythm")}: ${t(item.title)}`}
                onPress={() => {
                  setPlayingAudition("");
                  setAudition(audition === item.id ? "" : item.id);
                }}
              />
              <Action
                icon={preset?.id === item.id ? "check-circle" : "check"}
                selected={preset?.id === item.id}
                label={`${t("ChooseRhythm")}: ${t(item.title)}`}
                onPress={() =>
                  onChange({
                    strum: item.pattern,
                    strumMeter: item.meter,
                    strumDivision: item.division,
                    strumPreset: item.id
                  })
                }
              />
            </View>
          </View>
        ))}
        <RhythmPlayer
          autoplay
          autoStart={!!previewRhythm}
          pattern={previewRhythm?.pattern ?? rhythms[0].pattern}
          meter={previewRhythm?.meter ?? rhythms[0].meter}
          division={previewRhythm?.division ?? rhythms[0].division}
          tempo={value.tempo}
          chords={chords}
          capo={value.capo}
          shapes={value.shapes}
          onStarted={() => setPlayingAudition(audition)}
          onStopped={() => {
            setPlayingAudition("");
            setAudition("");
          }}
        />

        <Action
          glass
          label={t("CustomRhythm")}
          onPress={() => {
            setEditing(true);
            setBrowsing(false);
          }}
        />
        <Action
          glass
          label={t("RhythmReference")}
          onPress={() => {
            Linking.openURL(
              kind === "picking" ? pickingReference : rhythmReference
            ).catch(() => Alert.alert(t("LinkOpenError")));
          }}
        />
      </>
    );
  return (
    <>
      {modes}
      <View style={styles.row}>
        <Text style={[styles.title, styles.glassText]}>
          {t(
            preset?.title ??
              (arrangements && !value.strum ? "SectionArrangement" : "MyStrum")
          )}
        </Text>
        <Action
          glass
          label={t("ChooseRhythm")}
          onPress={() => setBrowsing(true)}
        />
      </View>

      {value.strum ? (
        <RhythmGrid
          pattern={value.strum}
          meter={value.strumMeter}
          division={value.strumDivision}
        />
      ) : (
        <Text style={styles.description}>
          {t(arrangements ? "SectionArrangement" : "NoStrum")}
        </Text>
      )}
      {(/[DUXBA1-6]/.test(value.strum) ||
        arrangements?.some((setting) => /[DUXBA1-6]/.test(setting.strum))) && (
        <RhythmPlayer
          pattern={value.strum}
          meter={value.strumMeter}
          division={value.strumDivision}
          tempo={value.tempo}
          chords={chords}
          capo={value.capo}
          shapes={value.shapes}
          arrangements={arrangements}
        />
      )}
      <TempoControl
        label={t("Tempo")}
        value={value.tempo}
        onChange={(tempo) => onChange({ tempo })}
      />

      <Action
        glass
        label={t("EditRhythm")}
        selected={editing}
        onPress={() => setEditing(!editing)}
      />
      {editing && (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>{t("Meter")}</Text>
            {([2, 3, 4] as const).map((meter) => (
              <Action
                glass
                key={meter}
                label={rhythmMeterLabel(meter, value.strumDivision)}
                selected={value.strumMeter === meter}
                onPress={() => onChange({ strumMeter: meter, strumPreset: "" })}
              />
            ))}
          </View>
          <View style={styles.divider} />
          <Text style={styles.label}>{t("EditRhythm")}</Text>

          <View style={styles.row}>
            {Object.entries(rhythmSymbols)
              .filter(([symbol]) =>
                (kind === "picking"
                  ? ["B", "A", "1", "2", "3", "4", "5", "6", "-"]
                  : ["D", "U", "X", "B", "-"]
                ).includes(symbol)
              )
              .map(([symbol, label]) => (
                <Action
                  glass
                  key={symbol}
                  label={label}
                  disabled={value.strum.length >= 16}
                  onPress={() =>
                    onChange({ strum: value.strum + symbol, strumPreset: "" })
                  }
                />
              ))}
            <Action
              glass
              label={t("Undo")}
              disabled={!value.strum}
              onPress={() =>
                onChange({ strum: value.strum.slice(0, -1), strumPreset: "" })
              }
            />
          </View>
        </>
      )}
    </>
  );
}

export const styles = StyleSheet.create({
  tempoControl: {
    width: 148,
    minHeight: 44,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  tempoReadout: { flex: 1, minWidth: 0, alignItems: "center" },
  tempoLabel: {
    color: palette.glass.muted,
    fontSize: 10,
    lineHeight: 12,
    textAlign: "center"
  },
  tempoValue: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    textAlign: "center"
  },
  tempoUnit: { color: palette.glass.muted, fontSize: 9 },
  sectionChoices: { flexWrap: "nowrap", paddingBottom: 8 },
  iconAction: {
    width: 48,
    height: 48,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 24
  },
  iconGradient: { borderRadius: 24 },
  compactIconAction: { width: 44, height: 44 },
  labeledAction: {
    flex: 1,
    minWidth: 48,
    width: undefined,
    height: undefined,
    minHeight: 56,
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 6,
    gap: 3
  },
  labeledGradient: { borderRadius: 12 },
  compactLabeledAction: { minHeight: 44, paddingVertical: 2 },
  actionCaption: {
    color: palette.glass.ink,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center"
  },
  segments: {
    flexDirection: "row",
    padding: 4,
    gap: 4,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge,
    backgroundColor: palette.glass.surface
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: 14
  },
  segmentSelected: { backgroundColor: palette.gold.center },
  segmentText: {
    fontSize: 14,
    fontWeight: "600",
    color: palette.glass.muted,
    textAlign: "center"
  },
  controlList: { gap: 18 },
  controlRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 28,
    backgroundColor: palette.glass.card
  },
  goldText: { color: palette.gold.ink },
  compactAction: { paddingHorizontal: 9 },
  compactActionText: { fontSize: 14 },
  goldAction: {
    borderColor: palette.gold.top,
    borderTopColor: palette.gold.rimLight,
    borderBottomColor: palette.gold.rimShade
  },
  primaryAction: {
    minHeight: 48,
    shadowColor: palette.gold.glow,
    shadowOpacity: 0.48,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2
  },
  actionGradient: { ...StyleSheet.absoluteFillObject, borderRadius: 14 },
  chordSelected: {
    borderColor: palette.glass.accent,
    backgroundColor: palette.glass.activeCard,
    shadowColor: palette.gold.glow,
    shadowOpacity: 0.26,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 }
  },
  pages: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 22
  },
  pageDots: { flexDirection: "row", gap: 9, alignItems: "center" },
  pageDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.finish.dot
  },
  pageDotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.gold.top
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: palette.glass.control,
    borderBottomWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  denseSheetHeader: { paddingVertical: 4, paddingHorizontal: 12, gap: 8 },
  denseSheetContent: { padding: 0, paddingBottom: 0 },
  notationScrim: { paddingTop: 2 },
  notationClose: {
    width: 40,
    minWidth: 40,
    height: 40,
    minHeight: 40,
    borderRadius: 20
  },
  notationTitle: { flex: 1, fontSize: 18, lineHeight: 22 },
  notationSubtitle: {
    flex: 1,
    fontSize: 10,
    marginHorizontal: 4,
    borderLeftWidth: 1,
    borderLeftColor: palette.notation.divider,
    paddingLeft: 10
  },
  notationGradient: { borderRadius: 6 },
  notationSelected: {
    borderColor: palette.notation.gold,
    borderTopColor: palette.notation.gold,
    borderBottomColor: palette.notation.gold
  },
  notationAction: {
    flex: 0,
    width: 48,
    height: 40,
    minWidth: 48,
    minHeight: 40,
    paddingHorizontal: 4,
    paddingVertical: 0,
    borderRadius: 7,
    backgroundColor: palette.notation.control,
    borderColor: palette.notation.edge,
    gap: 1
  },
  notationLabeledAction: {
    height: 40,
    minHeight: 40,
    paddingVertical: 2,
    gap: 0
  },
  notationIconAction: { width: 48 },
  notationIcon: { lineHeight: 18 },
  notationText: { fontSize: 10, lineHeight: 13 },
  notationCaption: { fontSize: 9, lineHeight: 10 },
  sheetSubtitle: {
    flex: 2,
    fontSize: 12,
    color: palette.glass.muted,
    marginHorizontal: 16
  },
  sheetTitle: {
    flex: 1,
    color: palette.glass.ink,
    fontSize: 21,
    fontWeight: "600"
  },
  shapeGradient: { ...StyleSheet.absoluteFillObject, borderRadius: 14 },
  glassText: { color: palette.glass.ink },
  fullSheet: { height: "100%" },
  compactScroll: { flexGrow: 0, flexShrink: 1 },
  musicScroll: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: palette.colors.transparent
  },
  glassAction: {
    backgroundColor: palette.glass.control,
    borderColor: palette.glass.edge,
    borderRadius: 14
  },
  positionLabel: { color: palette.glass.muted, fontSize: 12, marginBottom: 4 },
  rhythmRows: { gap: 8 },
  rhythmChoice: { minWidth: 0 },
  rhythmCardTitle: { paddingRight: 108 },
  rhythmControls: {
    position: "absolute",
    top: 16,
    right: 16,
    flexDirection: "row",
    gap: 8
  },
  beats: { flexDirection: "row", gap: 3 },
  beat: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    paddingVertical: 6,
    gap: 4,
    borderRadius: 8,
    backgroundColor: palette.colors.transparent
  },
  beatPlayed: { backgroundColor: palette.colors.transparent },
  beatCount: { fontSize: 11, color: palette.glass.muted },
  beatSymbol: {
    fontSize: 32,
    color: palette.finish.highlight,
    textShadowColor: palette.finish.glow,
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 }
  },
  rhythmCard: {
    backgroundColor: palette.glass.card,
    borderWidth: 1,
    borderColor: palette.glass.cell,
    borderRadius: 16,
    padding: 16,
    gap: 12
  },
  rhythmCardSelected: {
    borderColor: palette.glass.accent,
    backgroundColor: palette.glass.activeCard
  },
  rhythmHeading: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.paper.background,
    borderRadius: 14
  },
  actionText: {
    color: palette.chromatic.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center"
  },
  selected: {
    backgroundColor: palette.chromatic.selected,
    borderColor: palette.chromatic.brass
  },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.78 },
  scrim: {
    flex: 1,
    paddingBottom: 8,
    justifyContent: "flex-end",
    backgroundColor: palette.finish.scrim
  },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    alignSelf: "center",
    maxHeight: "100%",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge,
    overflow: "hidden",
    backgroundColor: palette.paper.background,
    padding: 0
  },
  sheetContent: { gap: 12, padding: 16, paddingBottom: 24 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  title: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 21,
    fontWeight: "600",
    color: palette.chromatic.ink
  },
  label: { flex: 1, fontSize: 16, lineHeight: 23, color: palette.glass.ink },
  value: {
    minWidth: 30,
    textAlign: "center",
    color: palette.glass.ink,
    fontSize: 19,
    fontVariant: ["tabular-nums"]
  },
  description: { color: palette.glass.muted, fontSize: 15, lineHeight: 23 },
  divider: { height: 1, backgroundColor: palette.glass.edge },
  preview: { height: 78, backgroundColor: palette.colors.transparent },
  hiddenPreview: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: "none"
  },
  compactPreview: {
    width: 48,
    height: 48,
    backgroundColor: palette.colors.transparent
  },
  shapes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center"
  },
  landscapeShape: { width: "23%" },
  shape: {
    width: "47%",
    maxWidth: 210,
    backgroundColor: palette.glass.diagram,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge,
    padding: 10,
    alignItems: "center"
  }
});
