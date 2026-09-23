/**
 * The narrators a player can choose in the startup window while the voice
 * loads. `id` is the voice file stem in tts-server/voices; the window plays
 * `assets/narrators/<id>.mp3`, an excerpt of that same take.
 *
 * Adding a narrator: level the take to -18 LUFS / -2 dBTP (44.1 kHz mono
 * s16le wav) and copy it into electronwrapper/voices, tts-server/voices,
 * tts-server-amd/voices and both Steam TTS staging depots; cut its sample
 * into assets/narrators; add a row here. A row whose voice file is missing
 * is not offered.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export const NARRATORS = [
  { id: 'Narrator', label: 'British male' },
  { id: 'BritishFemaleNarrator', label: 'British female' },
  { id: 'AmericanMaleNarrator', label: 'American male' },
  { id: 'AmericanFemaleNarrator', label: 'American female' },
  { id: 'YoungMaleNarrator', label: 'Young male' },
  { id: 'YoungFemaleNarrator', label: 'Young female' },
];

export const DEFAULT_NARRATOR = 'Narrator';

const choicePath = (): string =>
  path.join(app.getPath('userData'), 'narrator.json');

/** The narrator chosen at an earlier launch, or the stock narrator. */
export const loadNarratorChoice = (): string => {
  try {
    const { narrator } = JSON.parse(fs.readFileSync(choicePath(), 'utf8'));
    if (NARRATORS.some(n => n.id === narrator)) return narrator;
  } catch { /* first launch, or an unreadable file */ }
  return DEFAULT_NARRATOR;
};

export const saveNarratorChoice = (id: string): void => {
  try {
    fs.writeFileSync(choicePath(), JSON.stringify({ narrator: id }));
  } catch (err) {
    console.warn('[Narrator] Could not save the choice:', err);
  }
};
