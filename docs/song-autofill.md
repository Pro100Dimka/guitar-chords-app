# Song autofill status (feature/song-autofill)

Base: d52753586e1c7126114442a1eaf785404b397b8c. No changes from audio-song-analysis branches.

## Implemented
- Existing add/edit form has an optional **Find lyrics (LRCLIB)** button.
- Searches by explicitly entered artist and title. Strict independent identity matching; no mixing different versions or chords.
- The chosen lyrics-only candidate changes the form's `content` **only** after selection; replacing an existing chord arrangement requires confirmation.
- Request cancellation/timeout (10s), 429 and no-match states; stale responses do not apply after cancellation or manual form edits.
- Existing save action, song ID, performer ID, media import and database migrations are unchanged. No audio file is created by this feature.
- LRCLIB results show album, duration and expandable full text inside the same form; distinct records stay separate.
- LRCLIB honors `Retry-After` via a local cooldown after HTTP 429; stale responses cannot replace manual edits.
- Lookup labels/errors localized in English, Ukrainian and Russian.
- Jest cases cover identity, partial lyrics, album/length variants, pre-cancelled request, no-match and 429; a branch-only GitHub Actions workflow runs Jest, TypeScript and lint without building APK. CI outcomes must be checked before declaring green.

## Provider review
| Source | Actual current status | Restrictions / action |
| --- | --- | --- |
| LRCLIB | Integrated client-side, lyrics-only fallback | https://lrclib.net/docs : anonymous API, client identification, rate limits; honor 429/Retry-After before retry; lyrics may be copyrighted, separately review redistribution permissions |
| pisennyk.com.ua | Not integrated | https://pisennyk.com.ua/pravyla : site states it pays licenses for publishing works, but does not grant downstream application ingestion/redistribution rights |
| www.pisni.org.ua | Not integrated | https://www.pisni.org.ua/articles/34.html : visible user rules are not permission for automated redistribution; no validated machine API/license |
| akkordov.net | Not integrated | https://akkordov.net/agreement : section 6.5 restricts copying/saving/transmitting user content without permission; 6.7 personal non-commercial use |

No chord source meets the two-authorized-providers requirement. No owner contacted. No catalog download performed.

## Direct on-device Shazam research (November 13, 2026)
- Audile `master` is GPL-3.0-or-later; its bundled `songrecfp` crate explicitly declares `GPL-3.0+` in `core/recognition/native/songrecfp/Cargo.toml`. Its fingerprints are generated locally before a direct Shazam HTTP request, but that code cannot be copied to FreeTune without accepting and satisfying GPL obligations (FreeTune's distribution/licensing status has not established compatibility). Reference: https://github.com/AudileTeam/Audile.
- `shazamio/shazamio-core` is MIT licensed and implemented in Rust, but exposes PyO3 Python bindings and does not provide a ready Android JNI/React Native module. Adapting the Rust implementation requires a separately tested Android-native decoder/resampler, JNI binding and dependency license audit. References: https://github.com/shazamio/shazamio-core/blob/master/pyproject.toml and THIRD-PARTY-NOTICES.md.
- The Shazam endpoint is unofficial and may change, throttle or disallow clients. No **real sample fingerprint -> HTTP response** test was available here. Therefore microphone/audio recognition has **not** been connected as a pretend working feature. No URL/token/backend placeholders were introduced.

## Not implemented / blocking
- Microphone/file audio fingerprint recognition is **not implemented**. ShazamIO is Python-side and cannot be silently embedded as a Python Android environment. A server is not inherently required if a compatible Android-native fingerprint generator can be built and validated; this has not been done. A source tree without a live URL would not satisfy the user's end-to-end requirement.
- There is therefore no `Recognize song` library button: it would otherwise advertise an inoperative workflow. The existing text/chord file importer still works, but audio files are not handled.
- Capo, key, and chord conversion cannot be obtained from the current lyrics-only provider. No new schema or phantom metadata introduced.
- At this stage the sole connected remote source is LRCLIB, not a two-provider chords solution.

## Verification matrix
| Scenario | Status |
| --- | --- |
| API identity matching; no-match; 429; metadata variants; cancellation | Jest added; GitHub Actions checks to be reviewed |
| Form result is opt-in and saved via existing Save | Static review, device not tested |
| Cancel/timeout/stale response | Static review, device not tested |
| ShazamIO audio -> chords -> form | Blocked, not end-to-end tested |
| Fall back to independent chord provider | Blocked on permissions/integration |
| Microphone temp-file lifecycle and crash cleanup | Not applicable, audio capture not implemented |
| Android / iOS real hardware | Not tested |
| npm test, lint, TypeScript | Branch GitHub Actions workflow added, results pending at documentation write |

Do not advertise this branch as complete song recognition until the above blockers are resolved. No APK built.
