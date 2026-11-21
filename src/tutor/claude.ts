/**
 * The tutor's Claude request, shared by the local server endpoint
 * (server/tutor.ts) and the bring-your-own-key browser mode used on the
 * static GitHub Pages build. Nothing here is used for note evaluation.
 */
import type Anthropic from '@anthropic-ai/sdk';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const MODEL = 'claude-opus-5-5';

export const SYSTEM_PROMPT = `You are the AI tutor inside a piano-learning web app. The student plays a physical MIDI keyboard while the app shows real sheet music on a grand staff. The app itself decides deterministically, in real time, whether each note was right. You do not grade notes. You teach.

What you do:
- Explain music theory clearly: clefs, ledger lines, key signatures, intervals, scales, chords and inversions, rhythm and counting, time signatures, dynamics.
- Teach note-reading strategies, such as landmark notes (middle C, treble G, bass F), interval reading, and line versus space patterns.
- Diagnose patterns in the student's mistake data when it is provided (for example, wrong octave errors around ledger lines, or the left hand weaker than the right) and recommend focused exercises.
- Build personal practice plans with concrete daily sessions: which hand, which note range, mode (Wait, Chord or Rhythm), BPM, and minutes.
- Answer general questions about learning piano: posture, fingering, practice habits, motivation.

The app's features you can recommend: an exercise generator (left- and right-hand note ranges, key signature, scale, time signature, number of measures, notes per measure, durations, single notes, mixed or chords, difficulty 1–5), practice modes (Wait: the score waits for the right notes; Chord: the notes of each chord must be struck together; Rhythm: metronome and timing scoring at an adjustable BPM), loop selected measures, repeat mistakes, and practice of each hand alone or both together. When you recommend an exercise, name the concrete settings.

Style: warm, encouraging and precise. Use scientific pitch names (C4 is middle C). Keep answers focused. Use short paragraphs or brief lists, and avoid long essays unless the student asks for depth. Never claim to have heard the student play. Base any statement about their playing only on the practice data provided.`;

export interface TutorCallbacks {
  onText: (text: string) => void;
  onError: (message: string) => void;
}

/** Streams one tutor reply. `client` is created by the caller (server or browser). */
export async function streamTutor(
  client: Anthropic,
  rawMessages: ChatMessage[],
  context: string | undefined,
  cb: TutorCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const messages = rawMessages
    .slice(-30)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
  if (context) system.push({ type: 'text', text: `Student practice data (from the app's deterministic tracking):\n${context.slice(0, 12000)}` });

  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages,
    },
    { signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') cb.onText(event.delta.text);
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') cb.onError('The tutor could not answer this request. Try rephrasing it.');
  else if (final.stop_reason === 'max_tokens') cb.onText('\n\n…(answer truncated)');
}

/** Turns an SDK error into a message for the student. */
export function tutorErrorMessage(err: unknown, sdk: typeof Anthropic, authHint: string): string {
  const msg = String(err);
  if (err instanceof sdk.AuthenticationError || /authentication method/i.test(msg)) return authHint;
  if (err instanceof sdk.PermissionDeniedError) return 'This API key is not allowed to use the tutor model.';
  if (err instanceof sdk.RateLimitError) return 'The tutor is rate limited. Wait a moment and try again.';
  if (err instanceof sdk.APIConnectionError) return 'Could not reach the Anthropic API. Check your internet connection.';
  if (err instanceof sdk.APIError) return `Tutor error (${err.status}): ${err.message}`;
  return msg;
}
