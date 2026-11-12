import { Dirs, FileSystem } from "react-native-file-access";
import {
  listAudioFileNames,
  recoverInterruptedJobs
} from "../database/audio-analysis";
import { songAudio } from "../song-audio";

export async function initializeSongAnalysis() {
  await recoverInterruptedJobs();
  if (!songAudio.isSupported) return;
  // Finish before the library opens: a new import can reuse an old hash-named
  // orphan, so cleanup must not race its SQLite commit. Errors remain optional.
  await cleanOrphans().catch(() => {});
}

async function cleanOrphans() {
  // Never touch songs referenced by SQLite, or recently imported files whose
  // transaction might still be in flight. Native import removes its own .part files.
  const directory = `${Dirs.DocumentDir}/FreeTuneAudio`;
  const retained = new Set(await listAudioFileNames());
  if (!(await FileSystem.exists(directory))) return;
  for (const name of await FileSystem.ls(directory)) {
    if (!/^[a-f0-9]{64}\.(mp3|wav|m4a)$/.test(name) || retained.has(name))
      continue;
    const path = `${directory}/${name}`;
    const stat = await FileSystem.stat(path);
    if (Date.now() - stat.lastModified > 24 * 60 * 60 * 1000) {
      await FileSystem.unlink(path);
    }
  }
}
