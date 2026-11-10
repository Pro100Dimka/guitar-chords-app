import React, { useState } from "react";
import {
  Alert,
  ImageBackground,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { SongPreferences } from "@/components/preferences";
import palette from "@/theme/palette";
import guitarBackground from "../../../assets/images/screen-background/song.jpg";
import { chordShapes, Frets } from "./chords";
import { rhythms, rhythmSymbols, rhythmReference } from "./rhythms";

export function Action({
  label,
  onPress,
  selected = false,
  disabled = false,
  glass = false,
  accessibilityLabel
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  glass?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        selected && styles.selected,
        glass && styles.glassAction,
        glass && selected && styles.glassSelected,
        (pressed || disabled) && styles.dim
      ]}
    >
      <Text style={[styles.actionText, glass && styles.glassText]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  musical = false
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  musical?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable
          style={styles.backdrop}
          accessibilityLabel={t("Close")}
          onPress={onClose}
        />
        <SafeAreaView
          edges={["bottom", "left", "right"]}
          style={[styles.sheet, musical && styles.musicSheet]}
        >
          {musical && (
            <ImageBackground
              source={guitarBackground}
              resizeMode="cover"
              blurRadius={8}
              style={StyleSheet.absoluteFillObject}
            />
          )}
          <View style={[styles.row, musical && styles.musicHeader]}>
            <Text
              accessibilityRole="header"
              style={[styles.title, musical && styles.glassText]}
            >
              {title}
            </Text>
            <Action label={t("Close")} onPress={onClose} glass={musical} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={musical && styles.musicScroll}
            contentContainerStyle={[
              styles.sheetContent,
              musical && styles.musicContent
            ]}
          >
            {children}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function Diagram({ frets }: { frets: Frets }) {
  const positive = frets.filter(
    (fret): fret is number => fret !== null && fret > 0
  );
  const start = Math.max(...positive) > 4 ? Math.min(...positive) : 1;
  const fretCount = Math.max(4, Math.max(...positive) - start + 1);
  const bottom = 30 + fretCount * 24;
  return (
    <Svg
      width={140}
      height={((bottom + 28) * 140) / 150}
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
          stroke={palette.glass.muted}
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
            stroke={palette.glass.muted}
          />
          {[null, 0].includes(fret) ? (
            <SvgText
              x={28 + i * 20}
              y={20}
              textAnchor="middle"
              fontSize={13}
              fill={palette.glass.ink}
            >
              {fret === null ? "×" : "○"}
            </SvgText>
          ) : (
            <Circle
              cx={28 + i * 20}
              cy={42 + ((fret ?? 0) - start) * 24}
              r={7}
              fill={palette.glass.ink}
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
  chord,
  value,
  onChange,
  onClose
}: {
  chord: string;
  value?: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const shapes = chordShapes(chord);
  const [expanded, setExpanded] = useState(false);
  const options = shapes
    .map((frets, index) => ({ frets, index }))
    .sort(
      (a, b) =>
        Math.max(...a.frets.map((fret) => fret ?? 0)) -
        Math.max(...b.frets.map((fret) => fret ?? 0))
    );
  const selectedIndex = value ?? options[0]?.index;
  const visible = expanded
    ? options
    : options.filter(
        (option, index) => index < 3 || option.index === selectedIndex
      );
  return (
    <Sheet title={chord} onClose={onClose} musical>
      <Text style={styles.description}>{t("FingeringHint")}</Text>
      {shapes.length === 0 && (
        <Text style={styles.description}>{t("NoFingering")}</Text>
      )}
      <View style={styles.shapes}>
        {visible.map(({ frets, index }) => (
          <Pressable
            key={String(frets)}
            accessibilityRole="button"
            accessibilityLabel={`${t("Fingering")} ${index + 1}: ${frets.map((fret) => fret ?? "×").join(", ")}`}
            accessibilityState={{ selected: selectedIndex === index }}
            onPress={() => onChange(index)}
            style={[
              styles.shape,
              selectedIndex === index && styles.glassSelected
            ]}
          >
            <Text style={styles.positionLabel}>
              {frets.includes(0)
                ? t("OpenPosition")
                : t("PositionFret", {
                    fret: Math.min(
                      ...frets.filter(
                        (fret): fret is number => fret !== null && fret > 0
                      )
                    )
                  })}
            </Text>
            <Diagram frets={frets} />
            <Text style={[styles.actionText, styles.glassText]}>
              {t("Fingering")}{" "}
              {options.findIndex((item) => item.index === index) + 1}
              {selectedIndex === index ? " ✓" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {options.length > 3 && (
        <Action
          glass
          label={t(expanded ? "FewerShapes" : "AllShapes", {
            count: options.length
          })}
          onPress={() => setExpanded(!expanded)}
        />
      )}
      <Text style={styles.description}>{t("DiagramHint")}</Text>
    </Sheet>
  );
}

export function SongTools({
  value,
  onChange,
  onClose,
  initialTab = "reading"
}: {
  initialTab?: "reading" | "rhythm";
  value: SongPreferences;
  onChange: (patch: Partial<SongPreferences>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(initialTab);
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
    <Sheet title={t("SongTools")} onClose={onClose} musical>
      <View style={styles.row}>
        {(["reading", "rhythm"] as const).map((key) => (
          <Action
            glass
            key={key}
            label={t(key === "reading" ? "Reading" : "Rhythm")}
            selected={tab === key}
            onPress={() => setTab(key)}
          />
        ))}
      </View>
      {tab === "reading" ? (
        <>
          {controls.map(({ key, label, min, max, step }) => (
            <View key={key} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Action
                glass
                label="−"
                disabled={value[key] <= min}
                onPress={() =>
                  onChange({ [key]: Math.max(min, value[key] - step) })
                }
              />
              <Text style={styles.value}>{value[key]}</Text>
              <Action
                glass
                label="+"
                disabled={value[key] >= max}
                onPress={() =>
                  onChange({ [key]: Math.min(max, value[key] + step) })
                }
              />
            </View>
          ))}
          <Text style={styles.description}>{t("CapoHint")}</Text>
        </>
      ) : (
        <RhythmEditor value={value} onChange={onChange} />
      )}
    </Sheet>
  );
}

export function RhythmGrid({
  pattern,
  meter
}: {
  pattern: string;
  meter: number;
}) {
  return (
    <View style={styles.rhythmRows}>
      {Array.from(
        { length: Math.ceil(pattern.length / (meter * 2)) },
        (_, bar) => (
          <View key={bar} style={styles.beats}>
            {Array.from({ length: meter * 2 }, (_, step) => {
              const symbol = pattern[bar * meter * 2 + step] ?? "-";
              return (
                <View
                  key={step}
                  style={[styles.beat, symbol !== "-" && styles.beatPlayed]}
                >
                  <Text style={styles.beatCount}>
                    {step % 2 === 0 ? step / 2 + 1 : "&"}
                  </Text>
                  <Text style={styles.beatSymbol}>{rhythmSymbols[symbol]}</Text>
                </View>
              );
            })}
          </View>
        )
      )}
    </View>
  );
}

function RhythmPlayer({
  pattern,
  meter,
  tempo
}: {
  pattern: string;
  meter: number;
  tempo: number;
}) {
  const { t } = useTranslation();
  const slots = Math.ceil(pattern.length / (meter * 2)) * meter * 2;
  const padded = pattern.padEnd(slots, "-");
  const preview = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{background:transparent}body{margin:0;background:transparent;font-family:system-ui;color:${palette.glass.ink}}button{width:100%;height:48px;border:1px solid ${palette.glass.edge};border-radius:14px;background:${palette.glass.play};color:${palette.colors.white};font:600 16px system-ui}#count{height:28px;line-height:28px;text-align:center;font-size:13px}</style></head><body><button id="play"></button><div id="count"></div><script>
    let context,timer,playing=false,step=0,next=0,start=0; const pattern=${JSON.stringify(padded)},tempo=${tempo},meter=${meter};
    const labels=${JSON.stringify({ play: t("ListenRhythm"), stop: t("Pause"), error: t("RhythmAudioError") })};
    const button=document.getElementById('play'), count=document.getElementById('count');button.textContent=labels.play;
    function stop(){playing=false;clearTimeout(timer);if(context)context.close();context=null;button.textContent=labels.play;count.textContent='';}
    function tick(){if(!playing)return;const now=context.currentTime;while(next<now+.1){const index=step++%pattern.length,hit=pattern[index];if(hit!=='-'){const osc=context.createOscillator(),gain=context.createGain();const muted=hit==='X';osc.type=muted?'square':'triangle';osc.frequency.value=muted?110:hit==='D'?180:280;gain.gain.setValueAtTime(muted ? .07 : .18,next);gain.gain.exponentialRampToValueAtTime(.001,next+(muted ? .025 : .09));osc.connect(gain);gain.connect(context.destination);osc.start(next);osc.stop(next+.12);}next+=30/tempo;}const current=Math.max(0,Math.floor((now-start)*tempo/30))%pattern.length;count.textContent=current%2===0?String(Math.floor(current/2)%meter+1):'&';timer=setTimeout(tick,25);}
    button.onclick=async()=>{if(playing){stop();return;}try{context=new (window.AudioContext||window.webkitAudioContext)();await context.resume();step=0;start=context.currentTime+.05;next=start;playing=true;button.textContent=labels.stop;tick();}catch(e){stop();button.textContent=labels.error;}};document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  </script></body></html>`;
  return (
    <View>
      <WebView
        key={`${pattern}-${meter}-${tempo}`}
        originWhitelist={["about:blank"]}
        source={{ html: preview }}
        style={styles.preview}
        scrollEnabled={false}
        javaScriptEnabled
        mediaPlaybackRequiresUserAction
        onShouldStartLoadWithRequest={({ url }) => url === "about:blank"}
      />
      <Text style={styles.description}>{t("RhythmPreview")}</Text>
    </View>
  );
}

function RhythmEditor({
  value,
  onChange
}: {
  value: SongPreferences;
  onChange: (patch: Partial<SongPreferences>) => void;
}) {
  const { t } = useTranslation();
  const [browsing, setBrowsing] = useState(!value.strum);
  const [editing, setEditing] = useState(false);
  const [audition, setAudition] = useState(value.strumPreset || rhythms[0].id);
  const preset = rhythms.find(
    (item) =>
      item.id === value.strumPreset &&
      item.pattern === value.strum &&
      item.meter === value.strumMeter
  );
  if (browsing)
    return (
      <>
        <Text style={[styles.title, styles.glassText]}>
          {t("RhythmCatalog")}
        </Text>
        <Text style={styles.description}>{t("RhythmCatalogHint")}</Text>
        {rhythms.map((item) => (
          <View
            key={item.id}
            style={[
              styles.rhythmCard,
              audition === item.id && styles.rhythmCardSelected
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: audition === item.id }}
              onPress={() => setAudition(item.id)}
              style={styles.rhythmHeading}
            >
              <Text style={styles.label}>{t(item.title)}</Text>
              <Text style={styles.positionLabel}>{item.meter}/4</Text>
            </Pressable>
            <RhythmGrid pattern={item.pattern} meter={item.meter} />
            {audition === item.id && (
              <>
                <RhythmPlayer
                  pattern={item.pattern}
                  meter={item.meter}
                  tempo={value.tempo}
                />
                <Action
                  glass
                  label={t("UseRhythm")}
                  onPress={() => {
                    onChange({
                      strum: item.pattern,
                      strumMeter: item.meter,
                      strumPreset: item.id
                    });
                    setBrowsing(false);
                  }}
                />
              </>
            )}
          </View>
        ))}
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
            Linking.openURL(rhythmReference).catch(() =>
              Alert.alert(t("LinkOpenError"))
            );
          }}
        />
      </>
    );
  return (
    <>
      <View style={styles.row}>
        <Text style={[styles.title, styles.glassText]}>
          {t(preset?.title ?? "MyStrum")}
        </Text>
        <Action
          glass
          label={t("ChooseRhythm")}
          onPress={() => setBrowsing(true)}
        />
      </View>
      <Text style={styles.description}>{t("RhythmPersonalHint")}</Text>
      {value.strum ? (
        <RhythmGrid pattern={value.strum} meter={value.strumMeter} />
      ) : (
        <Text style={styles.description}>{t("NoStrum")}</Text>
      )}
      {/[DUX]/.test(value.strum) && (
        <RhythmPlayer
          pattern={value.strum}
          meter={value.strumMeter}
          tempo={value.tempo}
        />
      )}
      <View style={styles.row}>
        <Text style={styles.label}>{t("Tempo")}</Text>
        <Action
          glass
          label="−"
          disabled={value.tempo <= 40}
          onPress={() => onChange({ tempo: Math.max(40, value.tempo - 5) })}
        />
        <Text style={styles.value}>{value.tempo}</Text>
        <Action
          glass
          label="+"
          disabled={value.tempo >= 200}
          onPress={() => onChange({ tempo: Math.min(200, value.tempo + 5) })}
        />
      </View>
      <Text style={styles.description}>{t("PracticeTempo")}</Text>
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
            {([3, 4] as const).map((meter) => (
              <Action
                glass
                key={meter}
                label={`${meter}/4`}
                selected={value.strumMeter === meter}
                onPress={() => onChange({ strumMeter: meter, strumPreset: "" })}
              />
            ))}
          </View>
          <View style={styles.divider} />
          <Text style={styles.label}>{t("EditRhythm")}</Text>
          <Text style={styles.description}>{t("StrumHint")}</Text>
          <View style={styles.row}>
            {Object.entries(rhythmSymbols).map(([symbol, label]) => (
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
          <Text style={styles.description}>{t("RhythmPaddingHint")}</Text>
        </>
      )}
    </>
  );
}

export const styles = StyleSheet.create({
  glassText: { color: palette.glass.ink },
  musicSheet: {
    borderRadius: 24,
    overflow: "hidden",
    margin: 12,
    padding: 0,
    gap: 12,
    backgroundColor: palette.colors.transparent
  },
  musicHeader: {
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.glass.surface,
    backgroundColor: palette.glass.header
  },
  musicScroll: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge,
    backgroundColor: palette.glass.surface
  },
  musicContent: { padding: 14, paddingBottom: 24, gap: 20 },
  glassAction: {
    backgroundColor: palette.glass.control,
    borderColor: palette.glass.surface,
    borderRadius: 14
  },
  glassSelected: {
    backgroundColor: palette.glass.selected,
    borderColor: palette.glass.accent
  },
  positionLabel: { color: palette.glass.muted, fontSize: 12 },
  rhythmRows: { gap: 8 },
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
  beatPlayed: { backgroundColor: palette.glass.cell },
  beatCount: { fontSize: 11, color: palette.glass.muted },
  beatSymbol: { fontSize: 22, color: palette.glass.ink },
  rhythmCard: {
    backgroundColor: palette.glass.card,
    borderWidth: 1,
    borderColor: palette.glass.cell,
    borderRadius: 20,
    padding: 14,
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
    borderColor: palette.paper.line,
    backgroundColor: palette.paper.background,
    borderRadius: 12
  },
  actionText: {
    color: palette.chromatic.ink,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center"
  },
  selected: {
    backgroundColor: palette.chromatic.selected,
    borderColor: palette.chromatic.brass
  },
  dim: { opacity: 0.5 },
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: palette.colors.blackOpacity
  },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: palette.paper.background,
    padding: 20,
    gap: 16
  },
  sheetContent: { gap: 16, paddingBottom: 20 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  title: {
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 21,
    fontWeight: "600",
    color: palette.chromatic.ink
  },
  label: { flex: 1, fontSize: 16, color: palette.glass.ink },
  value: {
    minWidth: 30,
    textAlign: "center",
    color: palette.glass.ink,
    fontSize: 17,
    fontVariant: ["tabular-nums"]
  },
  description: { color: palette.glass.muted, fontSize: 14, lineHeight: 21 },
  divider: { height: 1, backgroundColor: palette.glass.edge },
  preview: { height: 78, backgroundColor: palette.colors.transparent },
  shapes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center"
  },
  shape: {
    backgroundColor: palette.glass.diagram,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.glass.surface,
    padding: 8,
    alignItems: "center"
  }
});
