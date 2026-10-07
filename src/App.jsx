/**
 * Backend harness: a bare-bones Today screen that exercises every backend feature
 * (live day model, now line, timer, logging, chimes, backup/restore, CSV).
 * Replace with the real screens from the design; the hooks and `src/backend` API stay the same.
 */
import { useState } from 'react';
import {
  exportBackup, exportLogsCsv, formatCountdown, formatRange, formatTime, logDoneAsPlanned, logSkipped, markBackedUp,
  clearLog, pickFile, previewBackup, readBackupFile, replaceImpact, restoreBackup, saveFile, seedDemoData, startTimer, stopTimer,
  toDateStr, updateSettings, formatDateLabel,
} from './backend/index.js';
import { useApp, useBackupStatus, useCatchUp, useDay, useNow, useSettings, useSoundState } from './react/hooks.jsx';

const box = { border: '1px solid #D6CEE6', borderRadius: 12, padding: 12, margin: '8px 0', background: '#fff' };
const btn = { minHeight: 44, padding: '0 14px', borderRadius: 22, border: '1px solid #4B2E83', background: '#fff', color: '#4B2E83', fontWeight: 700, marginRight: 6 };

export default function App() {
  const { player } = useApp();
  const now = useNow();
  const today = toDateStr(now);
  const day = useDay(today);
  const settings = useSettings();
  const sound = useSoundState();
  const backup = useBackupStatus();
  const [catchUp, dismissCatchUp] = useCatchUp();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(null); // parsed backup waiting for merge/replace

  const hour12 = settings?.day.hour12 ?? true;
  const run = (fn) => async () => {
    try {
      setMessage((await fn()) ?? '');
    } catch (err) {
      setMessage(err.message);
    }
  };

  const doBackup = run(async () => {
    const file = await exportBackup();
    const result = await saveFile(file);
    if (result !== 'cancelled') await markBackedUp();
    return `Backup ${result}.`;
  });
  const doImport = run(async () => {
    const file = await pickFile();
    if (!file) return '';
    setPending(await readBackupFile(file));
  });
  const doRestore = (mode) =>
    run(async () => {
      const out = await restoreBackup(pending, { mode });
      setPending(null);
      return `Restored (${mode}): ${JSON.stringify(out)}`;
    });

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: 'system-ui', color: '#15111F' }}>
      <h1 style={{ marginBottom: 0 }}>{formatDateLabel(today)}</h1>
      <p style={{ marginTop: 4 }}>
        Backend harness · day score so far: <b>{day?.summary ? `${day.summary.followedPct}%` : '–'}</b>
        {day?.nowLine?.visible && <> · now {day.nowLine.label}</>}
      </p>

      {sound === 'needs-tap' && <button style={btn} onClick={() => player.unlock()}>Tap to turn on sounds</button>}
      <button style={btn} onClick={() => updateSettings({ sounds: { enabled: sound === 'muted' } })}>{sound === 'muted' ? 'Unmute' : 'Mute'} ({sound})</button>
      <button style={btn} onClick={() => player.test(settings?.sounds.chimeId)}>Test chime</button>
      <button style={btn} onClick={run(async () => (await seedDemoData(), 'Demo data loaded.'))}>Load demo data</button>

      {backup?.due && <div style={box}>Last backup was {backup.daysSince} days ago. <button style={btn} onClick={doBackup}>Back up</button></div>}

      {catchUp && (
        <div style={box}>
          <b>While you were away</b> ({formatTime(catchUp.fromMin, { hour12 })} – {formatTime(catchUp.toMin, { hour12 })})
          <ul>{catchUp.changes.map((c) => <li key={c.block.key}>{formatTime(c.atMin, { hour12 })} {c.block.title}: {c.state}</li>)}</ul>
          <button style={btn} onClick={dismissCatchUp}>Dismiss</button>
        </div>
      )}

      {day?.current && (
        <div style={box}>
          NOW · <b>{day.current.title}</b> · {formatCountdown(day.remainingSec)} left
          {day.next && <div>NEXT · {day.next.title} · {formatTime(day.next.startMin, { hour12 })}</div>}
        </div>
      )}

      {day?.blocks.length === 0 && <p>No blocks yet. Load the demo data to see the backend in action.</p>}
      {day?.blocks.map((b) => (
        <div key={b.key} style={{ ...box, borderColor: b.state === 'now' || b.state === 'running' ? '#2F7D54' : '#D6CEE6' }}>
          <b>{b.title}</b> · {formatRange(b.startMin, b.endMin, { hour12 })}
          <div>{b.state}{b.tag ? ` · ${b.tag}` : ''}{b.score !== null ? ` · ${b.score}%` : ''}{b.timer ? ` · timer ${formatCountdown(b.timer.elapsedSec)}` : ''}</div>
          {b.state === 'running' ? (
            <button style={btn} onClick={run(async () => (await stopTimer(b.key), ''))}>Stop timer</button>
          ) : (
            <button style={btn} onClick={run(async () => (await startTimer(b.key), ''))}>Start timer</button>
          )}
          <button style={btn} onClick={run(async () => (await logDoneAsPlanned(b.key), ''))}>Done</button>
          <button style={btn} onClick={run(async () => (await logSkipped(b.key), ''))}>Skip</button>
          {b.log && <button style={btn} onClick={run(async () => (await clearLog(b.key), ''))}>Undo</button>}
        </div>
      ))}

      <h2>Backup</h2>
      <p>{backup ? (backup.never ? 'Never backed up.' : `Last backup ${backup.daysSince} days ago.`) : ''}</p>
      <button style={btn} onClick={doBackup}>Export backup</button>
      <button style={btn} onClick={doImport}>Import backup</button>
      <button style={btn} onClick={run(async () => `CSV ${await saveFile(await exportLogsCsv())}.`)}>Export CSV</button>

      {pending && (
        <div style={box}>
          <b>Restore backup</b> · saved {formatDateLabel(toDateStr(pending.exportedAtMs), { month: 'short', day: 'numeric' })} · {previewBackup(pending).taskCount} tasks · {previewBackup(pending).daysLogged} days logged
          <div style={{ marginTop: 8 }}>
            <button style={btn} onClick={doRestore('merge')}>Merge</button>
            <button style={btn} onClick={async () => {
              const { logsLost } = await replaceImpact(pending);
              if (window.confirm(`Replace erases this iPhone's data${logsLost ? ` (${logsLost} logs made since the backup would be lost)` : ''}. Continue?`)) doRestore('replace')();
            }}>Replace</button>
            <button style={btn} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}

