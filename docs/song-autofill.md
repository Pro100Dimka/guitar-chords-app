# Song autofill status (feature/song-autofill)

Base: d52753586e1c7126114442a1eaf785404b397b8c. No changes from audio-song-analysis branches.

## Implemented
- Existing add/edit form has an optional **Find lyrics (LRCLIB)** button.
- Searches by explicitly entered artist and title. Strict independent identity matching; no mixing different versions or chords.
- The chosen lyrics-only candidate changes the form's `content` **only** after selection; replacing an existing chord arrangement requires confirmation.
- Request cancellation/timeout (10s), 429 and no-match states; stale responses do not apply after cancellation or manual form edits.
- Existing save action, song ID, performer ID, media import and database migrations are unchanged. No audio file is created by this feature.
- Unit tests added for identity, partial lyrics result, 429 and no-match; execution on Android/iOS and CI is **not verified**.

## Provider review
| Source | Actual current status | Restrictions / action |
| --- | --- | --- |
| LRCLIB | Integrated client-side, lyrics-only fallback | https://lrclib.net/docs : anonymous API, client identification, rate limits; honor 429/Retry-After before retry; lyrics may be copyrighted, separately review redistribution permissions |
| pisennyk.com.ua | Not integrated | https://pisennyk.com.ua/pravyla : site states it pays licenses for publishing works, but does not grant downstream application ingestion/redistribution rights |
| www.pisni.org.ua | Not integrated | https://www.pisni.org.ua/articles/34.html : visible user rules are not permission for automated redistribution; no validated machine API/license |
| akkordov.net | Not integrated | https://akkordov.net/agreement : section 6.5 restricts copying/saving/transmitting user content without permission; 6.7 personal non-commercial use |

No chord source meets the two-authorized-providers requirement. No owner contacted. No catalog download performed.

## Not implemented / blocking
- Microphone/file audio fingerprint recognition is **not implemented**. ShazamIO is Python-side and cannot be silently embedded as a Python Android environment. A reachable, secured, configured developer backend is required; none is deployed, and Oracle was explicitly excluded. A source tree without a live URL would not satisfy the user's end-to-end requirement.
- There is therefore no `Recognize song` library button: it would otherwise advertise an inoperative workflow. The existing text/chord file importer still works, but audio files are not handled.
- Capo, key, and chord conversion cannot be obtained from the current lyrics-only provider. No new schema or phantom metadata introduced.
- At this stage the sole connected remote source is LRCLIB, not a two-provider chords solution.

## Verification matrix
| Scenario | Status |
| --- | --- |
| API identity matching; no-match; 429 | Jest cases added, not executed in connected environment |
| Form result is opt-in and saved via existing Save | Static review, device not tested |
| Cancel/timeout/stale response | Static review, device not tested |
| ShazamIO audio -> chords -> form | Blocked, not end-to-end tested |
| Fall back to independent chord provider | Blocked on permissions/integration |
| Microphone temp-file lifecycle and crash cleanup | Not applicable, audio capture not implemented |
| Android / iOS real hardware | Not tested |
| npm test, lint, TypeScript | Not run (GitHub connector provides source edits; no local repo/network-backed build runtime) |

Do not advertise this branch as complete song recognition until the above blockers are resolved. No APK built.
