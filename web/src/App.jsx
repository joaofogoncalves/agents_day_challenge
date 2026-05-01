import { useEffect, useMemo, useState, useCallback } from 'react';
import { fetchBoard, patchIdea, usingMock } from './api.js';

const COLUMNS = [
  { id: 'bucket', label: 'Bucket', hint: 'raw ideas, unconverged' },
  { id: 'candidates', label: 'Candidates', hint: 'under validation' },
  { id: 'selected', label: 'Selected for Development', hint: 'committed' },
];

export default function App() {
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    fetchBoard()
      .then((data) => setIdeas(data.ideas ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const byStage = useMemo(() => {
    const map = { bucket: [], candidates: [], selected: [] };
    for (const i of ideas) (map[i.stage] ?? map.bucket).push(i);
    for (const k of Object.keys(map)) map[k].sort((a, b) => b.score - a.score);
    return map;
  }, [ideas]);

  const open = ideas.find((i) => i.uid === openId) ?? null;

  // Optimistic local update + PATCH; rollback on failure.
  const updateIdea = useCallback(async (uid, patch) => {
    let prev;
    setIdeas((cur) => {
      prev = cur;
      return cur.map((i) => (i.uid === uid ? { ...i, ...patch } : i));
    });
    try {
      const res = await patchIdea(uid, patch);
      if (res?.idea) {
        setIdeas((cur) => cur.map((i) => (i.uid === uid ? res.idea : i)));
      }
    } catch (e) {
      console.error('save failed', e);
      if (prev) setIdeas(prev);
    }
  }, []);

  return (
    <div className="app">
      <Header total={ideas.length} />

      <main className="board">
        {COLUMNS.map((col, idx) => (
          <Column
            key={col.id}
            index={idx}
            column={col}
            ideas={byStage[col.id]}
            loading={loading}
            onOpen={setOpenId}
          />
        ))}
      </main>

      <footer className="foot">
        <span className="foot__dot" />
        <span>quorum/web · prototype · agents control the board</span>
        <span className="foot__sep">/</span>
        <span className="foot__mute">{usingMock ? 'mock data' : 'live'}</span>
        {error && (
          <>
            <span className="foot__sep">/</span>
            <span className="foot__mute" style={{ color: '#ff6a3d' }}>
              {error}
            </span>
          </>
        )}
      </footer>

      {open && <Editor idea={open} onClose={() => setOpenId(null)} onSave={updateIdea} />}
    </div>
  );
}

function Header({ total }) {
  return (
    <header className="head">
      <div className="head__brand">
        <span className="head__mark">◤</span>
        <span className="head__name">Quorum</span>
        <span className="head__tag">— what to build</span>
      </div>
      <div className="head__meta">
        <span className="kbd">⌘</span>
        <span className="kbd">K</span>
        <span className="head__count">
          <em>{String(total).padStart(2, '0')}</em> ideas in flight
        </span>
      </div>
    </header>
  );
}

function Column({ column, ideas, loading, onOpen, index }) {
  return (
    <section className={`col col--${column.id}`} style={{ '--i': index }}>
      <div className="col__head">
        <div className="col__head-row">
          <span className="col__num">{String(index + 1).padStart(2, '0')}</span>
          <h2 className="col__title">{column.label}</h2>
          <span className="col__count">{ideas.length}</span>
        </div>
        <p className="col__hint">{column.hint}</p>
      </div>

      <div className="col__body">
        {loading && <div className="muted mono">loading…</div>}
        {!loading && ideas.length === 0 && <div className="empty">— empty —</div>}
        {ideas.map((idea, i) => (
          <Card key={idea.uid} idea={idea} delay={i} onClick={() => onOpen(idea.uid)} />
        ))}
      </div>
    </section>
  );
}

function Card({ idea, delay, onClick }) {
  return (
    <button
      className="card"
      style={{ '--d': delay }}
      onClick={onClick}
      aria-label={`Open ${idea.name}`}
    >
      <div className="card__top">
        <h3 className="card__name">{idea.name}</h3>
        <div className="card__score" aria-label={`score ${idea.score} of 10`}>
          <span className="card__score-num">{idea.score}</span>
          <span className="card__score-den">/10</span>
        </div>
      </div>

      <p className="card__brief">{idea.brief}</p>

      <div className="card__meta">
        <span className="chip">
          <span className="chip__k">est</span>
          <span className="chip__v">~{idea.hours}h</span>
        </span>
        <span className="card__pulse" aria-hidden="true">
          <i /><i /><i />
        </span>
      </div>
    </button>
  );
}

function Editor({ idea, onClose, onSave }) {
  const [name, setName] = useState(idea.name);
  const [long, setLong] = useState(idea.long);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty = name !== idea.name || long !== idea.long;

  const save = () => {
    if (!dirty) return onClose();
    onSave(idea.uid, { name, long });
    onClose();
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="modal__uid">{idea.uid}</span>
          <button className="modal__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal__body">
          <label className="field">
            <span className="field__label">name</span>
            <input
              className="field__input field__input--display"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>

          <div className="modal__row">
            <ReadOnly label="stage" value={idea.stage} />
            <ReadOnly label="score" value={`${idea.score}/10`} />
            <ReadOnly label="estimate" value={`~${idea.hours}h`} />
          </div>

          <label className="field">
            <span className="field__label">brief</span>
            <div className="field__readonly">{idea.brief}</div>
          </label>

          <label className="field">
            <span className="field__label">long description</span>
            <textarea
              className="field__input field__input--long"
              value={long}
              onChange={(e) => setLong(e.target.value)}
              rows={9}
            />
          </label>
        </div>

        <div className="modal__foot">
          <span className="modal__hint">
            score, estimate &amp; stage are agent-controlled. esc to close.
          </span>
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={onClose}>
              cancel
            </button>
            <button className="btn btn--primary" onClick={save} disabled={!dirty}>
              save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadOnly({ label, value }) {
  return (
    <div className="ro">
      <span className="ro__k">{label}</span>
      <span className="ro__v">{value}</span>
    </div>
  );
}
