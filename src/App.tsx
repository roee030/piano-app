import { useEffect } from 'react';
import { app, View } from './app/controller';
import { useStore } from './ui/hooks';
import { PracticeScreen } from './ui/screens/PracticeScreen';
import { ExercisesScreen } from './ui/screens/ExercisesScreen';
import { ProgressScreen } from './ui/screens/ProgressScreen';
import { TutorScreen } from './ui/screens/TutorScreen';
import { MidiScreen } from './ui/screens/MidiScreen';
import { DevSimulator } from './dev/DevSimulator';

const NAV: { id: View; label: string }[] = [
  { id: 'practice', label: 'Practice' },
  { id: 'exercises', label: 'Exercises' },
  { id: 'progress', label: 'Progress' },
  { id: 'tutor', label: 'AI tutor' },
  { id: 'midi', label: 'MIDI' },
];

function MidiPill() {
  const midi = useStore(app.midi);
  const dev = midi.devices.find((d) => d.id === midi.selectedId);
  const cls = midi.status === 'ready' && midi.connected ? 'ok' : midi.status === 'idle' || midi.status === 'requesting' ? 'warn' : 'bad';
  const text =
    midi.status === 'ready' ? (midi.connected ? dev?.name ?? 'All inputs' : midi.devices.length ? 'Device disconnected' : 'No MIDI device') :
    midi.status === 'idle' ? 'Connect keyboard' : midi.status === 'requesting' ? 'Requesting access…' : midi.status === 'denied' ? 'MIDI blocked' : midi.status === 'unsupported' ? 'No Web MIDI' : midi.status === 'insecure' ? 'Needs HTTPS' : 'MIDI error';
  return (
    <button className="pill" onClick={() => (midi.status === 'idle' ? app.initMidi() : app.view.set('midi'))} title="MIDI connection">
      <span className={`dot ${cls} ${cls === 'bad' && midi.status === 'ready' ? 'pulse' : ''}`} /> {text}
    </button>
  );
}

export default function App() {
  const view = useStore(app.view);
  const prefs = useStore(app.prefs);

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs.theme]);

  // Connect automatically if MIDI permission was granted before
  useEffect(() => {
    const perms = navigator.permissions as Permissions | undefined;
    perms?.query({ name: 'midi' as PermissionName }).then((p) => { if (p.state === 'granted') app.initMidi(); }).catch(() => {});
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">𝄞</span> Étude</div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={view === n.id ? 'active' : ''} onClick={() => app.view.set(n.id)}>{n.label}</button>
          ))}
        </nav>
        <div className="topbar-right">
          <MidiPill />
          <button className="btn icon ghost" title="Toggle theme" onClick={() => app.setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}>{prefs.theme === 'dark' ? '☀' : '☾'}</button>
        </div>
      </header>
      <main className="main">
        {view === 'practice' && <PracticeScreen />}
        {view === 'exercises' && <ExercisesScreen />}
        {view === 'progress' && <ProgressScreen />}
        {view === 'tutor' && <TutorScreen />}
        {view === 'midi' && <MidiScreen />}
      </main>
      {import.meta.env.DEV && <DevSimulator />}
    </div>
  );
}
