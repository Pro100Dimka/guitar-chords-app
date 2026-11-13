const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const crypto = require("node:crypto");

async function recognize(path) {
  const uri = execFileSync("cargo", ["run", "--quiet", "--manifest-path",
    "android/song-fingerprint/Cargo.toml", "--bin", "fingerprint_probe", "--", path], {encoding:"utf8"}).trim();
  if (!uri.startsWith("data:audio/vnd.shazam.sig;base64,"))
    throw Error("Invalid native signature");
  const timestamp = Date.now();
  const endpoint = "https://amp.shazam.com/discovery/v5/en/US/iphone/-/tag/" +
    crypto.randomUUID().toUpperCase() + "/" + crypto.randomUUID().toUpperCase() +
    "?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3";
  const body = {timezone:"Europe/Paris",timestamp,context:{},geolocation:{},
    signature:{uri,samplems:Math.round(readFileSync(path).byteLength / 32)}};
  const response = await fetch(endpoint, {method:"POST",
    headers:{"Content-Type":"application/json","User-Agent":"Shazam/18.11.0 (iPhone; iOS 18.0)"},
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
