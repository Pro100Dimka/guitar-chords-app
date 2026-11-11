import React, { useEffect, useState } from "react";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import LinearGradient from "react-native-linear-gradient";
import {
  Alert,
  AppState,
  ImageBackground,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View
} from "react-native";
import Text from "../../components/styled-text";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { SongPreferences } from "@/components/preferences";
import palette from "@/theme/palette";
import { playGuitar, guitarSamples } from "../../components/guitar-audio";
import recordedChords from "../../../assets/guitar-chords.json";
import { performanceAudio } from "../../components/performance-audio";
import guitarBackground from "../../../assets/images/gold-background.png";
import {
  chordShapes,
  chordShapeOptions,
  easierPositions,
  easiestShape,
  Frets,
  songChords,
  songChordSequence,
  guitarMidi,
  transposeChord
} from "./chords";
import { rhythms, rhythmSymbols, rhythmReference } from "./rhythms";

export function Action({
  label,
  onPress,
  selected = false,
  disabled = false,
  glass = false,
  accessibilityLabel,
  icon,
  primary = false,
  compact = false
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  glass?: boolean;
  accessibilityLabel?: string;
  icon?: string;
  primary?: boolean;
  compact?: boolean;
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
        compact && styles.compactAction,
        selected && styles.selected,
        glass && styles.glassAction,
        (selected || primary) && styles.goldAction,
        primary && styles.primaryAction,
        !!icon && styles.iconAction,
        pressed && styles.pressed,
        disabled && styles.dim
      ]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={
          selected || primary
            ? palette.finish.goldColors
            : palette.finish.surfaceColors
        }
        style={[styles.actionGradient, !!icon && styles.iconGradient]}
        locations={palette.finish.locations}
      />
      {icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={21}
          color={selected || primary ? palette.gold.ink : palette.glass.ink}
        />
      ) : (
        <Text
          style={[
            styles.actionText,
            compact && styles.compactActionText,
            glass && styles.glassText,
            (selected || primary) && styles.goldText
          ]}
        >
          {label}
        </Text>
      )}
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
  const { width } = useWindowDimensions();
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
          style={[
            styles.sheet,
            musical && styles.musicSheet,
            musical && { width: Math.min(width - 24, 680) }
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
          <LinearGradient
            colors={palette.finish.surfaceColors}
            locations={palette.finish.locations}
            style={styles.sheetHeader}
          >
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {title}
            </Text>
          </LinearGradient>
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

function Diagram({
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
  onClose
}: {
  chord: string;
  capo?: number;
  value?: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => () => performanceAudio.stopPlayback(), []);
  const options = chordShapeOptions(chord, value);
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const diagramWidth = Math.min(
    132,
    (Math.min(width, 704) - 64) / (landscape ? 4 : 2) - 28
  );
  const [page, setPage] = useState(() =>
    Math.max(
      0,
      Math.floor(options.findIndex((option) => option.index === value) / 4)
    )
  );
  const pageCount = Math.max(1, Math.ceil(options.length / 4));
  const currentPage = Math.min(page, pageCount - 1);
  const selectedIndex = value ?? options[0]?.index;
  const visible = options.slice(currentPage * 4, currentPage * 4 + 4);
  return (
    <Sheet title={chord} onClose={onClose} musical>
      {options.length === 0 && (
        <Text style={styles.description}>{t("NoFingering")}</Text>
      )}
      <View style={styles.shapes}>
        {visible.map(({ frets, index, position, label }) => (
          <Pressable
            key={String(frets)}
            accessibilityRole="button"
            accessibilityLabel={`${t("Fingering")} ${index + 1}: ${frets.map((fret) => fret ?? "×").join(", ")}`}
            accessibilityState={{ selected: selectedIndex === index }}
            onPress={() => {
              onChange(index);
              playGuitar(
                frets.flatMap((fret, string) =>
                  fret === null ? [] : [guitarMidi[string] + fret + capo]
                )
              );
            }}
            style={[
              styles.shape,
              landscape && styles.landscapeShape,
              selectedIndex === index && styles.chordSelected
            ]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={palette.finish.surfaceColors}
              locations={palette.finish.locations}
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
      <Text style={styles.description}>{t("FingeringHint")}</Text>
    </Sheet>
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
          {!easier && <Text style={styles.description}>{t("CapoHint")}</Text>}
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
  const chords = songChords(content);
  const options = easierPositions(chords, value.transpose, value.capo);
  return (
    <>
      <Text style={styles.description}>{t("EasierHint")}</Text>
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
  onChange
}: {
  content: string;
  value: SongPreferences;
  onChange: (patch: Partial<SongPreferences>) => void;
}) {
  const { t } = useTranslation();
  const sequence = songChordSequence(content).map((chord) =>
    transposeChord(chord, value.transpose - value.capo)
  );
  const chords = [...new Set(sequence)];
  const [start, setStart] = useState(0);
  if (!sequence.length)
    return <Text style={styles.description}>{t("NoSongChords")}</Text>;
  const ordered = [...sequence.slice(start), ...sequence.slice(0, start)];
  return (
    <>
      <Text style={styles.description}>
        {t("FullPracticeHint", { count: sequence.length })}
      </Text>
      <RhythmPlayer
        pattern={value.strum || "D-D-D-D-"}
        meter={value.strum ? value.strumMeter : 4}
        tempo={value.tempo}
        practice={ordered}
        chords={ordered}
        capo={value.capo}
        shapes={value.shapes}
      />
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
      <Text style={styles.description}>{t("PracticePrivateHint")}</Text>
    </>
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
  tempo,
  compact = false,
  practice,
  chords = ["Am", "C", "G", "Em"],
  capo = 0,
  shapes = {}
}: {
  practice?: string[];
  compact?: boolean;
  chords?: string[];
  capo?: number;
  shapes?: Record<string, number>;
  pattern: string;
  meter: number;
  tempo: number;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setActive(state === "active")
    );
    return () => listener.remove();
  }, []);
  const slots = Math.ceil(pattern.length / (meter * 2)) * meter * 2;
  const padded = pattern.padEnd(slots, "-");
  const progression = chords.length ? chords : ["C"];
  const chordAudio: Record<string, { down: string; up: string }> =
    recordedChords;
  const recordings = progression.map((chord) => {
    if (shapes[chord] !== undefined) return null;
    const sounding = transposeChord(chord, capo);
    const aliases: Record<string, string> = {
      Db: "C#",
      Eb: "D#",
      Gb: "F#",
      Ab: "G#",
      Bb: "A#",
      Cb: "B",
      Fb: "E"
    };
    return (
      chordAudio[sounding.replace(/^[A-G]b/, (root) => aliases[root])] ?? null
    );
  });
  const frequencies = progression.map((chord) => {
    const frets =
      chordShapes(chord)[shapes[chord]] ?? easiestShape(chord)?.frets;
    return (
      frets?.flatMap((fret, i) =>
        fret === null
          ? []
          : [
              {
                frequency: 440 * 2 ** ((guitarMidi[i] + fret + capo - 69) / 12),
                string: i
              }
            ]
      ) ?? []
    );
  });
  const preview = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{background:transparent}body{margin:0;background:transparent;font-family:system-ui;color:${palette.glass.ink}}button{width:100%;height:48px;border:1px solid ${palette.glass.edge};border-radius:14px;background:${palette.glass.play};color:${palette.gold.ink};box-shadow:0 0 12px #ffb00077,inset 0 1px 1px #fff9c9;border-color:#ffe59b;background:linear-gradient(#fff2a6,#ffd65a 16%,#ffbc08 48%,#ffaa00 52%,#ffd34a);font:600 19px system-ui}#count{height:28px;line-height:28px;text-align:center;font-size:13px}</style></head><body><button id="play"></button><div id="count"></div><script>
    let context,timer,playing=false,step=0,next=0,start=0,bus,voices=[],chordVoice;
    const pattern=${JSON.stringify(padded)},tempo=${tempo},meter=${meter},practice=${JSON.stringify(practice ?? [])},chords=${JSON.stringify(progression)},frequencies=${JSON.stringify(frequencies)};
    const labels=${JSON.stringify({ play: t(practice ? "StartPractice" : "ListenRhythm"), stop: t("Pause"), error: t("RhythmAudioError"), done: t("PracticeDone"), seconds: t("SecondsShort") })};
    const button=document.getElementById('play'), count=document.getElementById('count');button.textContent=labels.play;
    function stop(){playing=false;clearTimeout(timer);if(context)context.close().catch(()=>{});context=null;button.textContent=labels.play;count.textContent='';}
    const samples=${JSON.stringify(guitarSamples)};
    const recordings=${JSON.stringify(recordings)};
    let buffers=[],chordBuffers=[];
    async function prepare(){
      voices=[];chordVoice=null;
      bus=context.createBiquadFilter();bus.type='highpass';bus.frequency.value=65;bus.Q.value=.7;
      const tone=context.createBiquadFilter();tone.type='peaking';tone.frequency.value=2800;tone.Q.value=.8;tone.gain.value=-2;
      const compressor=context.createDynamicsCompressor();compressor.threshold.value=-14;compressor.knee.value=18;compressor.ratio.value=2;compressor.attack.value=.012;compressor.release.value=.18;
      const master=context.createGain();master.gain.value=.85;
      bus.connect(tone);tone.connect(compressor);compressor.connect(master);master.connect(context.destination);
      if(!chordBuffers.length)chordBuffers=await Promise.all(recordings.map(async(recording)=>{
        if(!recording)return null;
        const decoded=await Promise.all(['down','up'].map(async(direction)=>{
          const bytes=Uint8Array.from(atob(recording[direction]),c=>c.charCodeAt(0));
          return context.decodeAudioData(bytes.buffer);
        }));
        return {down:decoded[0],up:decoded[1]};
      }));
    }
    function damp(voice,when){
      if(!voice)return;
      voice.gain.gain.cancelScheduledValues(when);
      voice.gain.gain.setTargetAtTime(0,when,.008);voice.source.stop(when+.04);
    }
    function strum(index,hit,when,volume){
      const buffer=chordBuffers[index]?.[hit==='U'?'up':'down'];
      if(!buffer)return false;
      voices.forEach(voice=>damp(voice,when));voices=[];damp(chordVoice,when);
      const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;
      gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(volume,when+.003);
      if(hit==='X')gain.gain.setTargetAtTime(0,when+.025,.015);
      source.connect(gain);gain.connect(bus);source.start(when);
      if(hit==='X')source.stop(when+.12);
      chordVoice={source,gain};source.onended=()=>{source.disconnect();gain.disconnect();if(chordVoice?.source===source)chordVoice=null;};
      return true;
    }
    function pluck(frequency,when,muted,volume,string){
      if(!buffers.length) buffers=samples.map(sample=>{
        const raw=atob(sample.pcm),buffer=context.createBuffer(1,raw.length/2,22050),data=buffer.getChannelData(0);
        for(let i=0;i<data.length;i++){let value=raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8);if(value>=32768)value-=65536;data[i]=value/32768;}
        return {frequency:sample.frequency,buffer};
      });
      const sample=buffers.reduce((best,item)=>Math.abs(Math.log2(item.frequency/frequency))<Math.abs(Math.log2(best.frequency/frequency))?item:best);
      damp(voices[string],when);
      const source=context.createBufferSource(),gain=context.createGain();source.buffer=sample.buffer;source.playbackRate.value=frequency/sample.frequency;
      gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(volume*1.8,when+.004);
      if(muted)gain.gain.exponentialRampToValueAtTime(.001,when+.07);
      source.connect(gain);gain.connect(bus);source.start(when);if(muted)source.stop(when+.09);
      voices[string]={source,gain};source.onended=()=>{source.disconnect();gain.disconnect();if(voices[string]?.source===source)voices[string]=null;};
    }
    function tick(){
      if(!playing)return;const now=context.currentTime;
      if(practice.length&&now-start>=60){stop();count.textContent=labels.done;return;}
      while(next<now+.08){
        const position=step++,index=position%pattern.length,hit=pattern[index],chordIndex=Math.floor(position/(meter*2))%chords.length;
        if(hit!=='-'){
          const dynamics=(hit==='U'?.72:1)*(index%(meter*2)===0?1:.91)*[1,.97,1.02,.95][position%4];
          if(!strum(chordIndex,hit,next,.62*dynamics)){
            damp(chordVoice,next);chordVoice=null;
            const notes=frequencies[chordIndex],ordered=hit==='U'?[...notes].reverse().slice(0,4):notes;
            ordered.forEach(({frequency,string},i)=>pluck(frequency,next+i*(hit==='U'?.009:.014),hit==='X',.22*dynamics/Math.sqrt(Math.max(1,ordered.length)),string));
          }
        }
        next+=30/tempo;
      }
      const elapsed=Math.max(0,now-start),position=Math.floor(elapsed*tempo/30),chordIndex=Math.floor(position/(meter*2))%chords.length;
      const beat=position%2===0?String(Math.floor(position/2)%meter+1):'&';
      count.textContent=chords[chordIndex]+' · '+beat+(practice.length?' · '+Math.max(0,60-Math.floor(elapsed))+' '+labels.seconds:'');
      timer=setTimeout(tick,25);
    }
    button.onclick=async()=>{if(playing){stop();return;}button.disabled=true;try{context=new(window.AudioContext||window.webkitAudioContext)();await context.resume();await prepare();if(document.hidden){stop();return;}step=0;start=context.currentTime+.08;next=start;playing=true;button.textContent=labels.stop;tick();}catch(e){stop();button.textContent=labels.error;}finally{button.disabled=false;}};
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  </script></body></html>`;
  return (
    <View>
      {active && (
        <WebView
          key={`${pattern}-${meter}-${tempo}-${capo}-${progression.join("-")}`}
          originWhitelist={["about:blank"]}
          source={{ html: preview }}
          style={styles.preview}
          scrollEnabled={false}
          javaScriptEnabled
          mediaPlaybackRequiresUserAction
          onShouldStartLoadWithRequest={({ url }) => url === "about:blank"}
        />
      )}
      {!practice && !compact && (
        <Text style={styles.description}>{t("RhythmPreview")}</Text>
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
  const chords = songChordSequence(content).map((chord) =>
    transposeChord(chord, value.transpose - value.capo)
  );
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
                  compact
                  pattern={item.pattern}
                  meter={item.meter}
                  tempo={value.tempo}
                  chords={chords}
                  capo={value.capo}
                  shapes={value.shapes}
                />
                <Action
                  glass
                  primary
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
        <Text style={styles.description}>{t("RhythmCatalogHint")}</Text>
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
          chords={chords}
          capo={value.capo}
          shapes={value.shapes}
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
  iconAction: {
    width: 48,
    height: 48,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 24
  },
  iconGradient: { borderRadius: 24 },
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
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  sheetTitle: { color: palette.glass.ink, fontSize: 21, fontWeight: "600" },
  shapeGradient: { ...StyleSheet.absoluteFillObject, borderRadius: 14 },
  glassText: { color: palette.glass.ink },
  musicSheet: {
    alignSelf: "center",
    height: "94%",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    overflow: "hidden",
    margin: 12,
    padding: 0,
    gap: 0,
    backgroundColor: palette.colors.transparent
  },
  musicScroll: {
    borderWidth: 0,
    backgroundColor: palette.colors.transparent
  },
  musicContent: { padding: 20, paddingBottom: 48, gap: 20 },
  glassAction: {
    backgroundColor: palette.glass.control,
    borderColor: palette.glass.edge,
    borderRadius: 14
  },
  positionLabel: { color: palette.glass.muted, fontSize: 12, marginBottom: 4 },
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
    justifyContent: "flex-end",
    backgroundColor: palette.finish.scrim
  },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    maxHeight: "94%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: palette.paper.background,
    padding: 20,
    gap: 16
  },
  sheetContent: { gap: 16, paddingBottom: 20 },
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
