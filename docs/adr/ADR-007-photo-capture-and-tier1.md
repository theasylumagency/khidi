# ADR-007 — Full-resolution capture with offline deterministic checks

Status: Accepted (M4 implementation choice authorized by AGENTS.md P4)
Date: 2026-11-02

The capture UI described below was revised by the owner's 2026-11-04 decision at the
end of this ADR. That decision supersedes the optional photo stream and explicit acceptance UI.

Use native rear-camera JPEG capture as the primary path (`input[type=file]` with
`accept=image/jpeg` and `capture=environment`). It provides a full-resolution camera
file on Android and installed iPhone PWAs without relying on Safari's ImageCapture API.
The Hub also offers a rear-camera stream with a live framing overlay and a separate
JPEG/PNG/WebP picker. A stream snapshot is available only when its actual long edge
meets the configured minimum; never upscale a low-resolution frame to pass validation.
The native camera owns its own controls; the Hub shows its framing guide and preview
before/after native capture. Physical-device validation remains the owner's checklist.

The stream requests 4096 × 3072 ideally, uses muted inline video, and stops all tracks
on exit, backgrounding or phone lock. Stream JPEG encoding occurs once at capture;
that resulting file, or the native file, is the raw original stored byte-for-byte.
Quality analysis uses a downscaled copy and never alters the original.

Tier-1 is shared pure code: Laplacian variance on at most a 256 px grayscale sample,
clipped dark/highlight shares and actual image dimensions. Initial thresholds:
long edge 1920 px, variance 50, dark share ≤85%, bright share ≤90%, clipping values
8 and 247. All are configuration (`MEDIA_QUALITY_CONFIG`) and are returned to the
authorized capture screen. The upload server independently repeats these checks.
Opaque/transparent samples use a neutral background. No OCR or semantic/product
recognition is claimed; label readability beyond these checks is M5/human review.

Required Product Type slots and instructions are used when identity is known; otherwise
use MAIN, SECONDARY and IDENTIFICATION. Only durable local acceptance can show
“✓ ფოტო მიღებულია”. Required slots block the next-product button until accepted;
an explicit inability reason is durably reported for admin attention instead.
P5 connects this component to the scan-dependent per-user IndexedDB queue.

The owner clarified that photo rows always target the original intake. Duplicates
and KH-label attachment confirmations do not start capture automatically; they show
the original's photo status and offer only missing-slot completion to assigned task
members and ADMIN. Verified SKU images make their slots optional at intake time;
the required/covered slots are snapshotted, including an empty required set.

Opening a task online caches the server's already-scanned normalized identifiers.
The same browser-safe normalization plus the device's queued scans forms the local
duplicate list. New scans start capture immediately without network waiting; known
duplicates do not. A server duplicate response closes capture before capture begins.
Already-taken offline photos are retained as additional UNVERIFIED original-intake
candidates, even for an already-filled slot; they never replace existing images.
The deterministic perceptual-hash check flags similar candidates for admin review.

Owner decision (2026-11-02): Class B scan photos stay under their blocked scan and
never upload independently. Confirmed scan discard atomically discards its blobs and
reports only metadata. A separately blocked photo may be retaken/discarded by its
owner; OFFLINE_PHOTO_DISCARDED flags required photos missing for admin attention.
Nothing is silently removed. These rules are recorded in AGENTS.md P5.

## Owner decision before merge — server quality is advisory (2026-11-03)

Device acceptance must survive different browser/libvips decoding, resampling or grayscale
results. The server re-runs Tier-1 as an observation and never rejects a photo for blur,
exposure or minimum resolution. Upload rejection remains for size above 15 MiB,
unsupported/undecodable raster data and decompression-bomb limits (64 million pixels,
single-frame JPEG/PNG/WebP). Existing authorization and metadata/idempotency validation
still apply.

Acceptance decoding uses Sharp `failOn: "error"`, allowing minor camera JPEG warnings.
The exact submitted bytes remain the raw original; processing failures follow the worker's
normal retry/dead-letter path. Device Tier-1 results travel with the durable offline upload.
`tier1_quality_json` keeps the device and server reports separately, plus a disagreement
flag; its top-level `passed` records upload acceptance for slot progress. Old queued photos
without a device report remain deliverable and record `device: null` explicitly.

A disagreement stores/enqueues the image normally and marks its original intake ATTENTION,
even if all slots have been uploaded. The admin can inspect both reports, review the image
or issue PHOTO_REQUEST. Admin verification/rejection resolves that image's quality-attention
flag; neither raw data nor another candidate is replaced automatically. This rule supersedes
the initial server-side Tier-1 rejection behavior.

## Owner UX revision — native camera and automatic durable acceptance (2026-11-04)

Barcode scanning retains its live stream and existing decoder. Photo capture offers only
the native rear-camera JPEG chooser and the JPEG/PNG/WebP gallery chooser, in one compact
workspace. Instructions and ordering come from the existing configured slots. There is no
photo stream/shutter or second application confirmation after the OS camera accepts a file.

A returned file immediately runs the existing device Tier-1 checks, then enters the existing
per-user IndexedDB queue unchanged. The step/count advances only after that transaction
commits, independently of network availability. Cancellation changes nothing. Failed storage
retains the checked file and its original captured time for retry; failed quality stays on
the same slot. Required slots still require a photo or the existing explicit attention report.

Saved-slot thumbnails allow retakes. Each ordinary retake adds a new immutable candidate
to the same original intake; it does not discard, replace or overwrite an earlier candidate.
The displayed count is distinct saved slots out of configured slots, including optional slots;
only the required slots gate finishing. Optional slots are labelled and may be skipped.

Local-save feedback and queued/blocked status are distinct from a server receipt. A new
candidate is shown as received by the server only after the existing upload response validates
its id and SHA-256. These in-memory UI receipts are bounded and reset per user; the durable
queue protocol, dependencies, ownership, replay and backoff remain unchanged. On reopening,
server capture context confirms uploaded slots; queued retakes retain their own pending status
even when an older photo already filled that slot. No thumbnail download API is added.
