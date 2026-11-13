import { useEffect, useState } from 'react';

// The server does not stream progress, so after the bytes are uploaded we walk through the stages it really
// performs (in this order) on a timer, and stay on the last one until the response arrives.
const STAGES = {
  file: [
    ['Reading the file', 2],
    ['Splitting it into passages', 4],
    ['Teaching NeuroLens the meaning', 14],
    ['Building the search index', 4],
  ],
  url: [
    ['Fetching the page safely', 3],
    ['Extracting the readable text', 3],
    ['Teaching NeuroLens the meaning', 8],
    ['Building the search index', 4],
  ],
};

const TIPS = [
  'Tick documents in the list to make answers come only from them.',
  'Every answer cites the passages it used, so you can check the source.',
  'Text that looks like instructions to an AI is flagged and fenced off as data.',
  'Your library is private to this organisation. Other teams never see it.',
  'Ask follow-up questions; NeuroLens remembers the last few turns.',
  'Hybrid search blends meaning (vectors) with exact keywords (BM25).',
];

const fmt = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function useElapsed(active) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t0 = Date.now();
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [active]);
  return secs;
}

function stageIndex(kind, secs) {
  const list = STAGES[kind] || STAGES.file;
  let acc = 0;
  for (let i = 0; i < list.length - 1; i += 1) {
    acc += list[i][1];
    if (secs < acc) return i;
  }
  return list.length - 1;
}

function Job({ job }) {
  const processing = job.phase === 'processing';
  const secs = useElapsed(processing);
  const stages = STAGES[job.kind] || STAGES.file;
  const si = processing ? stageIndex(job.kind, secs) : 0;

  let label;
  let pct = null; // null → indeterminate shimmer
  if (job.phase === 'queued') label = 'Waiting…';
  else if (job.phase === 'uploading') { pct = Math.round(job.pct * 100); label = `Uploading · ${pct}%`; }
  else if (processing) label = `${stages[si][0]}…`;
  else if (job.phase === 'done') { pct = 100; label = `Ready · ${job.chunks} passages`; }
  else label = job.error;

  return (
    <div className={`ingest-job ${job.phase}`} role="status" aria-live="polite">
      <div className="ingest-row">
        <span className="ingest-icon" aria-hidden="true">
          {job.phase === 'done' ? '✓' : job.phase === 'error' ? '!' : <i className="ingest-orb" />}
        </span>
        <span className="ingest-name" title={job.name}>{job.name}</span>
        <span className="muted small">{job.size ? fmt(job.size) : ''}</span>
      </div>
      <div className={`ingest-track ${pct === null && job.phase !== 'queued' ? 'indeterminate' : ''}`}>
        <div style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      <div className="ingest-label small">
        <span>{label}</span>
        {processing && <span className="muted">{secs}s</span>}
      </div>
      {processing && (
        <ol className="ingest-steps" aria-hidden="true">
          {stages.map(([name], i) => (
            <li key={name} className={i < si ? 'done' : i === si ? 'now' : ''} title={name} />
          ))}
        </ol>
      )}
    </div>
  );
}

export default function IngestProgress({ jobs }) {
  const working = jobs.some((j) => j.phase === 'uploading' || j.phase === 'processing');
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => {
    if (!working) return undefined;
    const id = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 5000);
    return () => clearInterval(id);
  }, [working]);

  if (!jobs.length) return null;
  const done = jobs.filter((j) => j.phase === 'done' || j.phase === 'error').length;
  return (
    <div className="ingest animate-fade-in">
      {jobs.length > 1 && <div className="small muted">{done} of {jobs.length} finished</div>}
      {jobs.map((j) => <Job key={j.id} job={j} />)}
      {working && <p key={tip} className="ingest-tip small animate-fade-in">💡 {TIPS[tip]}</p>}
    </div>
  );
}
