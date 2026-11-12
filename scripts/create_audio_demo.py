#!/usr/bin/env python3
"""Build a standalone viewer of a REAL analysis result, with its licensed audio.

This is a result viewer, not an Android screen recording or replacement app.
The caller must supply attribution and redistribution rights for the recording.
"""
import argparse
import base64
import hashlib
import html
import json
from pathlib import Path


TEMPLATE = r'''<!doctype html>
<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FreeTune — реальный разбор аудио</title>
<style>
:root{color-scheme:dark;--gold:#e8c67c;--dim:#aaa9af;--line:#ffffff1b;--bg:#111218}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#f7f5ef;font:16px/1.55 system-ui,sans-serif}
main{max-width:1000px;margin:auto;padding:36px 24px 60px}h1{font-size:clamp(29px,5vw,44px);line-height:1.15;letter-spacing:-1px;margin:12px 0}
h2{font-size:20px;margin:0 0 16px}.eyebrow{color:var(--gold);font-size:12px;letter-spacing:2px;text-transform:uppercase}
p{max-width:800px}a{color:var(--gold)}.muted,small{color:var(--dim)}.panel{background:#1b1c24;border:1px solid var(--line);border-radius:18px;padding:22px;margin:20px 0}
.facts{display:flex;gap:12px;flex-wrap:wrap}.fact{border:1px solid var(--line);border-radius:12px;padding:10px 16px}.fact b{display:block;color:var(--gold);font-size:23px}
audio{width:100%;height:44px;margin:10px 0}.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}button{cursor:pointer;background:#292a35;color:#f7f5ef;border:1px solid #ffffff28;border-radius:9px;padding:9px 12px;font:inherit}button:hover,button:focus-visible{border-color:var(--gold)}button.primary{color:#171719;background:var(--gold);font-weight:650}
.readout{display:flex;gap:30px;align-items:center;justify-content:space-between;margin:10px 0}.chord{color:var(--gold);font-size:36px;font-weight:650}.time{font-variant-numeric:tabular-nums}.rail{height:38px;position:relative;background:#111218;border-radius:6px;overflow:hidden;margin:18px 0}.interval{position:absolute;top:0;height:38px;min-width:1px;background:#e8c67c29;border-left:1px solid #e8c67c66;cursor:pointer;padding:0;border-radius:0}.interval.active{background:var(--gold)}.head{position:absolute;top:0;bottom:0;width:2px;background:#fff;pointer-events:none;z-index:1}
.lyrics{max-height:440px;overflow:auto;scroll-behavior:smooth}.lyric{border-top:1px solid var(--line);padding:16px 12px;color:#acaab5;border-radius:8px}.lyric.active{background:#2e2b25;color:white}.stamp{display:block;font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}.words{font-size:22px;line-height:1.8;cursor:pointer}.word{border-radius:4px;padding:2px}.word.active{background:var(--gold);color:#111218}.uncertain{text-decoration:underline dotted;text-underline-offset:5px}.warnings{font-size:14px;color:#ddc99d}details{margin-top:16px}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}footer{font-size:13px;margin-top:30px;color:var(--dim)}
@media(max-width:550px){main{padding:24px 14px}.panel{padding:16px}.words{font-size:19px}.facts{gap:6px}.fact{padding:8px 10px}.fact b{font-size:20px}}
</style>
<main><div class="eyebrow">FreeTune · аудио → текст + аккорды</div>
<h1>@@TITLE@@</h1>
<p class="muted">Результат реального анализа исходной записи. Слова и аккорды ниже получены моделями,
без подстановки эталонного текста. Ошибки оставлены видимыми.</p>
<div class="facts"><div class="fact"><b id="duration">—</b>исходная запись</div><div class="fact"><b id="elapsed">—</b>обработка · Linux CPU</div><div class="fact"><b id="memory">—</b>пик памяти процесса</div><div class="fact"><b id="chordsCount">—</b>интервалов аккордов</div></div>
<section class="panel"><h2>Слушайте и проверяйте по записи</h2>
<audio id="audio" controls preload="metadata" src="data:audio/mpeg;base64,@@AUDIO@@"></audio>
<div class="readout"><div><span class="muted">Аккорд записи</span><div id="currentChord" class="chord">—</div></div><div><div class="muted">Позиция оригинала</div><div id="clock" class="time">0:00.000</div></div></div>
<div id="rail" class="rail" aria-label="Интервалы распознанных аккордов"><div id="head" class="head"></div></div>
<div class="controls"><button id="first" class="primary">К первому распознанному слову</button><button id="setA">Поставить A</button><button id="setB">Поставить B</button><button id="clearLoop">Снять повтор</button><span id="loop" class="muted"></span></div>
<p class="muted"><small>Нажмите строку, слово или участок шкалы аккордов, чтобы перемотать.
Подсветка следует за фактическим audio.currentTime. Вступления и промежутки не сжимаются.</small></p>
</section>
<section class="panel"><h2>Распознанный текст</h2><div id="warnings" class="warnings"></div><div id="lyrics" class="lyrics"></div></section>
<details class="panel"><summary>Модели, контрольная сумма и данные разбора</summary><pre id="metadata"></pre><button id="download">Сохранить JSON результата</button></details>
<footer><p>Это автономный просмотр полученного результата, не запись экрана Android.
Редактирование и сохранение в библиотеку реализованы в Android-приложении FreeTune
в ветке feature/audio-song-analysis.
Демонстрация не отправляет аудио в сеть.</p><p>@@ATTRIBUTION@@</p>
<p>Запись встроена без перекодирования. Добавлены автоматические текст, интервалы слов и аккордов;
исполнитель не подтверждал их точность и не заявлял поддержку приложения.</p></footer>
</main>
<script id="analysis" type="application/json">@@RESULT@@</script>
<script>
const result=JSON.parse(document.getElementById('analysis').textContent);
const $=id=>document.getElementById(id),audio=$('audio');let a=null,b=null,previousLine=-1;
const time=value=>{const ms=Math.round(Math.max(0,value)*1000);return `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`};
const active=(items,t)=>items.findIndex(x=>x.start<=t&&t<x.end);
$('duration').textContent=time(result.duration).slice(0,-4);
$('elapsed').textContent=result.metrics?`${result.metrics.elapsedSeconds.toFixed(1)} с`:'—';
$('memory').textContent=result.metrics?`${(result.metrics.peakRssMb/1024).toFixed(2)} ГиБ`:'—';
$('chordsCount').textContent=String(result.chords.length);
$('metadata').textContent=JSON.stringify({model:result.model,metrics:result.metrics,duration:result.duration,originalFileSha256:'@@HASH@@',warnings:result.warnings},null,2);
const warningText={lyrics_unreliable:'Некоторые слова неразборчивы: … и подчёркнутые фрагменты требуют проверки.',word_timing_unreliable:'Часть таймингов слов ненадёжна; такие строки подсвечиваются целиком.',no_lyrics:'Надёжный текст не обнаружен.'};
$('warnings').textContent=result.warnings.map(x=>warningText[x]||x).join(' ');
const chordNodes=result.chords.map((chord,i)=>{const node=document.createElement('button');node.className='interval';node.style.left=`${100*chord.start/result.duration}%`;node.style.width=`${100*(chord.end-chord.start)/result.duration}%`;node.title=`${chord.label} · ${time(chord.start)}–${time(chord.end)}`;node.setAttribute('aria-label',node.title);node.onclick=()=>{audio.currentTime=chord.start;update()};$('rail').append(node);return node});
const lineNodes=result.lyrics.map((line,i)=>{const node=document.createElement('div');node.className='lyric';const stamp=document.createElement('span');stamp.className='stamp';stamp.textContent=`${time(line.start)} — ${time(line.end)}`;node.append(stamp);const words=document.createElement('div');words.className='words';const wordNodes=[];
if(line.words.length){for(const word of line.words){const span=document.createElement('span');span.className='word'+(word.uncertain?' uncertain':'');span.textContent=word.text+' ';span.title=`${time(word.start)}–${time(word.end)}`;span.onclick=event=>{event.stopPropagation();audio.currentTime=word.start;update()};words.append(span);wordNodes.push(span)}}else{words.textContent=line.text;if(line.uncertain)words.classList.add('uncertain')}
node.append(words);node.onclick=()=>{audio.currentTime=line.start;update()};$('lyrics').append(node);return{node,wordNodes}});
function update(){let t=audio.currentTime;if(a!==null&&b!==null&&t>=b&&!audio.paused){audio.currentTime=a;t=a}$('clock').textContent=time(t);$('head').style.left=`${100*t/result.duration}%`;const chord=active(result.chords,t),line=active(result.lyrics,t);$('currentChord').textContent=chord<0?'—':result.chords[chord].label;chordNodes.forEach((n,i)=>n.classList.toggle('active',i===chord));lineNodes.forEach(({node,wordNodes},i)=>{node.classList.toggle('active',i===line);const word=i===line?active(result.lyrics[i].words,t):-1;wordNodes.forEach((n,k)=>n.classList.toggle('active',k===word))});if(line!==previousLine&&line>=0&&!audio.paused){$('lyrics').scrollTo({top:lineNodes[line].node.offsetTop-$('lyrics').offsetTop-70,behavior:'smooth'})}previousLine=line;}
function showLoop(){$('loop').textContent=a===null?'':`A ${time(a)}${b===null?'':` → B ${time(b)}`}`}
$('first').onclick=()=>{audio.currentTime=result.lyrics[0]?.start||0;update()};
$('setA').onclick=()=>{a=audio.currentTime;b=null;showLoop()};
$('setB').onclick=()=>{if(a===null)a=0;if(audio.currentTime<=a){$('loop').textContent='Конец должен быть после A';return}b=audio.currentTime;showLoop()};
$('clearLoop').onclick=()=>{a=null;b=null;showLoop()};
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='freetune-real-analysis.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
['timeupdate','seeked','pause','play','loadedmetadata'].forEach(name=>audio.addEventListener(name,update));
function frame(){if(!audio.paused)update();requestAnimationFrame(frame)}requestAnimationFrame(frame);update();
</script></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--artist", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--license", required=True)
    parser.add_argument("--license-source", required=True)
    args = parser.parse_args()
    state = json.loads(args.result.read_text())
    result = state.get("result", state)
    if result.get("version") != 1 or not result.get("duration") or not result.get("model"):
        raise ValueError("Supply the actual version-1 analysis result, not a placeholder")
    recording = args.audio.read_bytes()
    sha = hashlib.sha256(recording).hexdigest()
    if state.get("audio_sha256") and state["audio_sha256"] != sha:
        raise ValueError("The original audio hash does not match this analysis job")
    credits = (f'{html.escape(args.artist)} — {html.escape(args.title)}. '
               f'<a href="{html.escape(args.source_url, quote=True)}">Исходная публикация</a>. '
               f'Лицензия: {html.escape(args.license)} '
               f'(<a href="{html.escape(args.license_source, quote=True)}">источник сведений о лицензии</a>).')
    replacements = {
        "@@TITLE@@": html.escape(f"{args.artist} — {args.title}"),
        "@@AUDIO@@": base64.b64encode(recording).decode(),
        "@@RESULT@@": json.dumps(result, ensure_ascii=False).replace("<", "\\u003c"),
        "@@HASH@@": sha, "@@ATTRIBUTION@@": credits,
    }
    document = TEMPLATE
    for key, value in replacements.items():
        document = document.replace(key, value)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(document)
    print(json.dumps({"output": str(args.output), "bytes": args.output.stat().st_size,
                      "audioSha256": sha, "lyricLines": len(result["lyrics"]),
                      "chordIntervals": len(result["chords"])}, indent=2))


if __name__ == "__main__":
    main()
