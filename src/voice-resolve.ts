/**
 * Voice-name → filename resolution for the local Chatterbox Turbo server.
 *
 * The renderer sends bare, often lowercased voice names ('narrator', 'Bodin',
 * 'Malineth'). Chatterbox resolves a predefined voice by *exact* filename
 * inside its ./voices directory (`voices_dir / <name>` + `is_file()`), with no
 * extension inference, no case folding, and no default — a miss is a hard HTTP
 * 404. Voice files also ship as either .wav or .mp3 (e.g. `Narrator.wav`,
 * `Bodin.mp3`, `Malineth.mp3`). This module bridges that gap so every request
 * names a file that actually exists on the server.
 *
 * Deliberately free of Electron/Node imports so the matching logic can be
 * unit-tested directly against a plain list of filenames.
 */

/** Voice used when a requested name cannot be matched to any file. */
export const FALLBACK_VOICE_STEM = 'narrator';

/** Strip a trailing .wav/.mp3 so names compare without their extension. */
export const voiceStem = (name: string): string =>
  name.replace(/\.(wav|mp3)$/i, '');

/** Placeholder the server returns when it has no real voices installed. */
const isPlaceholder = (name: string): boolean => name === 'default';

/**
 * Resolve `requested` to an exact filename drawn from `files` (the server's
 * predefined-voice list), or `null` if `files` contains no real voices.
 *
 * Matching order:
 *   1. exact filename, case-insensitive      'Bodin.mp3' -> 'Bodin.mp3'
 *   2. extension-less stem, case-insensitive 'narrator'  -> 'Narrator.wav'
 *                                            'Bodin'     -> 'Bodin.mp3'
 *   3. narrator fallback (allowFallback)     'Nobody'    -> 'Narrator.wav'
 *   4. first available voice (allowFallback)  (narrator missing)
 *
 * Empty / whitespace / 'default' are treated as a narrator request. When a
 * stem exists as both .wav and .mp3, .wav wins. With `allowFallback = false`
 * a genuine miss returns `null` so callers can distinguish "not found" from
 * "fell back" (used to trigger a one-shot voice-list refresh).
 */
export const matchVoiceFile = (
  files: string[],
  requested: string | undefined,
  allowFallback = true
): string | null => {
  const usable = files.filter(f => f && !isPlaceholder(f));
  if (usable.length === 0) return null;

  const byStem = (stem: string): string | undefined => {
    const target = stem.toLowerCase();
    const hits = usable.filter(f => voiceStem(f).toLowerCase() === target);
    if (hits.length === 0) return undefined;
    // Prefer .wav when the same stem ships as both .wav and .mp3.
    return hits.find(f => /\.wav$/i.test(f)) ?? hits[0];
  };

  const trimmed = requested?.trim();
  const want =
    trimmed && trimmed.toLowerCase() !== 'default'
      ? trimmed
      : FALLBACK_VOICE_STEM;

  // 1. exact filename (covers a name that already carries an extension)
  const exact = usable.find(f => f.toLowerCase() === want.toLowerCase());
  if (exact) return exact;

  // 2. extension-less stem match
  const stemMatch = byStem(voiceStem(want));
  if (stemMatch) return stemMatch;

  if (!allowFallback) return null;

  // 3. narrator, then 4. anything — never send a name the server will 404 on.
  return byStem(FALLBACK_VOICE_STEM) ?? usable[0];
};
