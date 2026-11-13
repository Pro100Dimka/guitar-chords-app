// @ts-nocheck
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const crypto = require("node:crypto");

async function recognize(path) {
  const uri = execFileSync("cargo", ["run", "--quiet", "--manifest-path",
    "android/song-fingerprint/Cargo.toml", "--bin", "fingerprint_probe", "--", path], {encoding:"utf8"}).trim();
  if (!uri.startsWith("data:audio/vnd.shazam.sig;base64,"))
    throw Error("Invalid native signature");
  const timestamp = Date.now();
  const endpoint = "https://amp.shazam.com/discovery/v5/en-US/GB/iphone/-/tag/" +
    crypto.randomUUID().toUpperCase() + "/" + crypto.randomUUID().toUpperCase() +
    "?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3";
  const body = {timezone:"Europe/Paris",timestamp,context:{},geolocation:{},
    signature:{uri,samplems:Math.round(readFileSync(path).byteLength / 32)}};
  const response = await fetch(endpoint, {method:"POST",
    headers:{"Content-Type":"application/json","User-Agent":"Dalvik/2.1.0 (Linux; U; Android 11)","X-Shazam-Platform":"IPHONE","X-Shazam-AppVersion":"14.1.0","Accept-Language":"en-US"},
    body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const payload = await response.text();
  let track=null;
  try {const obj=JSON.parse(payload);track=obj.track ? {title:obj.track.title,artist:obj.track.subtitle}:null;}
  catch {}
  console.log(JSON.stringify({clip:path,status:response.status,track,signatureBytes:uri.length}));
  if (!response.ok) throw Error("Shazam endpoint returned HTTP "+response.status);
  return track;
}
(async()=>{let matched=0;for(const path of process.argv.slice(2)){if(await recognize(path)) matched++;}
  if(matched===0) {console.error("No verified Shazam match on supplied clips");process.exitCode=1;}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
