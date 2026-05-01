import { useEffect, useMemo, useState, useCallback } from 'react';
import { fetchBoard, fetchMe, patchIdea, voteIdea, logout, usingMock } from './api.js';

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
  // me = {} when anonymous, { login, avatar_url, can_vote, can_edit } when signed in.
  const [me, setMe] = useState(null);

  useEffect(() => {
    Promise.all([fetchBoard(), fetchMe()])
      .then(([board, who]) => {
        setIdeas(board.ideas ?? []);
        setMe(who);
      })
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
      setError(e.message);
      if (prev) setIdeas(prev);
    }
  }, []);

  // Optimistic toggle on the karma button. If the server rejects (e.g. session
  // expired), roll back the local state.
  const toggleVote = useCallback(async (uid) => {
    let prev;
    setIdeas((cur) => {
      prev = cur;
      return cur.map((i) =>
        i.uid === uid
          ? { ...i, voted_by_me: !i.voted_by_me, votes: (i.votes || 0) + (i.voted_by_me ? -1 : 1) }
          : i,
      );
    });
    try {
      const res = await voteIdea(uid);
      setIdeas((cur) =>
        cur.map((i) => (i.uid === uid ? { ...i, votes: res.votes, voted_by_me: res.voted } : i)),
      );
    } catch (e) {
      console.error('vote failed', e);
      setError(e.message);
      if (prev) setIdeas(prev);
    }
  }, []);

  const isAuthed = !!me?.login;
  const canEdit = !!me?.can_edit;
  const canVote = !!me?.can_vote;

  return (
    <div className="app">
      <Header total={ideas.length} me={me} />

      <main className="board">
        {COLUMNS.map((col, idx) => (
          <Column
            key={col.id}
            index={idx}
            column={col}
            ideas={byStage[col.id]}
            loading={loading}
            onOpen={canEdit ? setOpenId : null}
            onVote={canVote ? toggleVote : null}
            isAuthed={isAuthed}
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

      {open && canEdit && (
        <Editor idea={open} onClose={() => setOpenId(null)} onSave={updateIdea} />
      )}
    </div>
  );
}

function Header({ total, me }) {
  const isAuthed = !!me?.login;
  const isEditor = !!me?.can_edit;

  const onSignIn = () => {
    // Round-trip current location through OAuth so we land back here, not at /.
    const next = window.location.pathname + window.location.search + window.location.hash;
    window.location.href = `/auth/github/start?next=${encodeURIComponent(next)}`;
  };
  const onSignOut = async () => {
    await logout();
    window.location.reload();
  };

  return (
    <header className="head">
      <div className="head__brand">
        <span className="head__mark">◤</span>
        <span className="head__name">Quorum</span>
        <span className="head__tag">— what to build</span>
      </div>
      <div className="head__meta">
        <span className="head__count">
          <em>{String(total).padStart(2, '0')}</em> ideas in flight
        </span>
        <span className="head__sep" />
        {usingMock ? null : isAuthed ? (
          <div className="auth">
            {me.avatar_url && <img className="auth__avatar" src={me.avatar_url} alt="" />}
            <span className="auth__login">@{me.login}</span>
            <span className={`auth__role ${isEditor ? 'auth__role--editor' : ''}`}>
              {isEditor ? 'editor' : 'viewer · vote'}
            </span>
            <button className="auth__btn" onClick={onSignOut}>
              sign out
            </button>
          </div>
        ) : (
          <button className="auth__signin" onClick={onSignIn}>
            <GhMark /> sign in with github
          </button>
        )}
      </div>
    </header>
  );
}

function ThumbsUp({ filled }) {
  // Thumbs-up glyph. Outlined when un-voted, filled when voted. Stroke + fill
  // both follow currentColor so the accent state is just a CSS color swap.
  return (
    <svg
      className="vote__icon"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 22V11" />
      <path d="M3 11h4v11H3z" />
      <path d="M7 11l4.5-8a2 2 0 0 1 3.7 1.4L14 9h5.5a2.5 2.5 0 0 1 2.4 3.1l-2 8A2.5 2.5 0 0 1 17.4 22H7" />
    </svg>
  );
}

function GhMark() {
  // Pure CSS-friendly inline mark, sized to the surrounding text.
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ marginRight: 7, verticalAlign: -2 }}>
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

function Column({ column, ideas, loading, onOpen, onVote, isAuthed, index }) {
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
          <Card
            key={idea.uid}
            idea={idea}
            delay={i}
            onOpen={onOpen}
            onVote={onVote}
            isAuthed={isAuthed}
          />
        ))}
      </div>
    </section>
  );
}

function Card({ idea, delay, onOpen, onVote, isAuthed }) {
  const clickable = !!onOpen;

  // The card body is clickable iff onOpen is set (= editor). Anyone else just
  // sees a static surface. The vote button is its own click target and stops
  // propagation so it works regardless of card-level interactivity.
  const Tag = clickable ? 'button' : 'div';
  const handleCardClick = clickable ? () => onOpen(idea.uid) : undefined;

  const handleVote = (e) => {
    e.stopPropagation();
    if (onVote) onVote(idea.uid);
  };

  return (
    <Tag
      className={`card ${clickable ? '' : 'card--static'}`}
      style={{ '--d': delay }}
      onClick={handleCardClick}
      aria-label={clickable ? `Open ${idea.name}` : idea.name}
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

        {isAuthed ? (
          <button
            className={`vote ${idea.voted_by_me ? 'vote--on' : ''}`}
            onClick={handleVote}
            aria-pressed={!!idea.voted_by_me}
            aria-label={idea.voted_by_me ? 'Remove vote' : 'Upvote'}
            type="button"
          >
            <ThumbsUp filled={!!idea.voted_by_me} />
            <span className="vote__count">{idea.votes ?? 0}</span>
            <span className="vote__label">vote</span>
          </button>
        ) : (
          <span className="card__pulse" aria-hidden="true">
            <i /><i /><i />
          </span>
        )}
      </div>
    </Tag>
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
