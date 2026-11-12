import bank from "../../assets/meta-steel-guitar.json";

export function acousticBank(notes: { frequency: number; string: number }[]) {
  const samples = new Set<(typeof bank.samples)[number]>();
  notes.forEach(({ frequency, string }) => {
    const midi = 69 + 12 * Math.log2(frequency / 440);
    const distance = (sample: (typeof bank.samples)[number]) =>
      Math.abs(sample.midi - midi) * 10 + (sample.string === string ? 0 : 1);
    samples.add(
      bank.samples.reduce((best, sample) =>
        distance(sample) < distance(best) ? sample : best
      )
    );
  });
  return {
    samples: [...samples],
    impulse: bank.impulse,
    wetGain: bank.wetGain
  };
}

// Shared by rhythm practice and fingering previews in the Web Audio player.
export const acousticEngine = `function createAcousticPlayer(audio, bank) {
  const output=audio.createGain(), wet=audio.createGain(), room=audio.createConvolver(), roomInput=audio.createGain();
  roomInput.channelCount=1;roomInput.channelCountMode='explicit';roomInput.connect(room);
  output.gain.value=.7;wet.gain.value=bank.wetGain;room.normalize=false;
  const safety=audio.createDynamicsCompressor();
  safety.threshold.value=-2;safety.knee.value=2;safety.ratio.value=8;
  safety.attack.value=.003;safety.release.value=.18;
  output.connect(safety);safety.connect(audio.destination);
  room.connect(wet);wet.connect(output);
  let buffers=[],voices=[],seed=78;
  const sounding=new Set();
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const decode=encoded=>{
    const raw=atob(encoded),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return audio.decodeAudioData(bytes.buffer);
  };
  const ready=Promise.all([
    decode(bank.impulse).then(buffer=>{room.buffer=buffer;}),
    Promise.all(bank.samples.map(async sample=>({
      string:sample.string,midi:sample.midi,
      soft:await decode(sample.soft),medium:await decode(sample.medium)
    }))).then(value=>{buffers=value;})
  ]);
  function levelAt(voice,age){
    const lift=6*(1-Math.exp(-age/.32))*Math.exp(-Math.max(age-2,0)/1.5)*(voice.bass ? .45 : 1);
    const mute=voice.muted?Math.exp(-Math.max(0,age-.006)*90):1;
    return voice.level*Math.pow(10,lift/20)*mute;
  }
  function damp(voice,when){
    if(!voice||voice.stoppedAt<=when+.22)return;
    if(when<voice.when){voice.stoppedAt=when;voice.source.stop();return;}
    const gain=voice.gain.gain,level=levelAt(voice,when-voice.when);
    if(gain.cancelAndHoldAtTime)gain.cancelAndHoldAtTime(when);
    else {gain.cancelScheduledValues(when);gain.setValueAtTime(level,when);}
    for(let i=1;i<=24;i++)gain.linearRampToValueAtTime(level*(.5+.5*Math.cos(Math.PI*i/24)),when+.22*i/24);
    voice.source.stop(when+.22);voice.stoppedAt=when+.22;
  }
  function stop(){sounding.forEach(voice=>damp(voice,audio.currentTime));voices=[];seed=78;}
  function stroke(notes,hit,when,position,changed,pattern){
    if(!notes.length)return;
    if(changed)voices.forEach(voice=>damp(voice,when));
    const up=hit==='U',muted=hit==='X',six=pattern==='D-DU-UDU';
    const index=six?[0,-1,1,2,-1,3,4,5][position%8]:-1;
    let ordered=up?[...notes].reverse().slice(0,index===3?4:3):notes;
    if(index===1)ordered=ordered.slice(1);
    const duration=(index>=0?[.065,.055,.034,.042,.060,.032][index]:(up?.037:.065))*(.94+random()*.12);
    const gaps=Array.from({length:Math.max(0,ordered.length-1)},()=>.8+random()*.4);
    const total=gaps.reduce((sum,value)=>sum+value,0);
    const strength=index>=0?[.9,.74,.58,.63,.82,.55][index]:(position%(pattern.length||8)===0?.9:up?.6:.76);
    const motion=index>=0?[1,.94,.95,1.04,1.02,.91][index]:1;
    const timing=index>=0?[0,.004,-.003,.005,.002,-.004][index]:0;
    let offset=0,end=when;
    ordered.forEach((note,i)=>{
      if(i)offset+=gaps[i-1]/total*duration;
      const midi=69+12*Math.log2(note.frequency/440);
      const distance=sample=>Math.abs(sample.midi-midi)*10+(sample.string===note.string?0:1);
      const sample=buffers.reduce((best,item)=>distance(item)<distance(best)?item:best);
      const buffer=up||(index===1&&note.string>=3)?sample.soft:sample.medium;
      const rate=Math.pow(2,(midi-sample.midi)/12),at=when+offset+timing;
      damp(voices[note.string],at);
      const source=audio.createBufferSource(),gain=audio.createGain();
      source.buffer=buffer;source.playbackRate.value=rate;
      const voice={source,gain,when:at,level:strength*motion*(.96+random()*.08)*[.82,.82,.94,1,1.08,1.08][note.string],bass:note.string===notes[0].string,muted,stoppedAt:Infinity};
      const noteDuration=muted?.11:buffer.duration/rate;
      gain.gain.setValueAtTime(levelAt(voice,0),at);
      for(let j=1;j<=128;j++)gain.gain.linearRampToValueAtTime(levelAt(voice,noteDuration*j/128),at+noteDuration*j/128);
      source.connect(gain);gain.connect(output);gain.connect(roomInput);
      voices[note.string]=voice;sounding.add(voice);
      source.onended=()=>{sounding.delete(voice);source.disconnect();gain.disconnect();if(voices[note.string]===voice)voices[note.string]=null;};
      source.start(at);if(muted){source.stop(at+noteDuration);voice.stoppedAt=at+noteDuration;}
      end=Math.max(end,at+noteDuration+1.7);
    });
    return end;
  }
  return {ready,stroke,stop};
}`;
