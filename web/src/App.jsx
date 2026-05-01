import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  fetchBoard,
  fetchMe,
  patchIdea,
  voteIdea,
  logout,
  patchBoard,
  clearConstraints,
  usingMock,
} from './api.js';

const COLUMNS = [
  { id: 'bucket', label: 'Bucket', hint: 'raw ideas, unconverged' },
  { id: 'candidates', label: 'Candidates', hint: 'under validation' },
  { id: 'selected', label: 'Selected for Development', hint: 'committed' },
];

export default function App() {
  const [ideas, setIdeas] = useState([]);
  const [boardName, setBoardName] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const [team, setTeam] = useState([]);
  const [context, setContext] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  // me = {} when anonymous, { login, avatar_url, can_vote, can_edit } when signed in.
  const [me, setMe] = useState(null);

  const refreshBoard = useCallback(() => {
    fetchBoard()
      .then((board) => {
        setIdeas(board.ideas ?? []);
        setBoardName(board.name ?? null);
        setDeadline(board.deadline ?? null);
        setTeam(board.team ?? []);
        setContext(board.context ?? []);
      })
      .catch(() => {/* silent on poll errors */});
  }, []);

  useEffect(() => {
    Promise.all([fetchBoard(), fetchMe()])
      .then(([board, who]) => {
        setIdeas(board.ideas ?? []);
        setBoardName(board.name ?? null);
        setDeadline(board.deadline ?? null);
        setTeam(board.team ?? []);
        setContext(board.context ?? []);
        setMe(who);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    if (!usingMock) {
      const id = setInterval(refreshBoard, 10_000);
      return () => clearInterval(id);
    }
  }, [refreshBoard]);

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
      return cur.map((i) => {
        if (i.uid !== uid) return i;
        const newVotes = (i.votes || 0) + (i.voted_by_me ? -1 : 1);
        return { ...i, voted_by_me: !i.voted_by_me, votes: newVotes, score_votes: Math.min(newVotes / 5, 1) };
      });
    });
    try {
      const res = await voteIdea(uid);
      setIdeas((cur) =>
        cur.map((i) =>
          i.uid === uid
            ? { ...i, votes: res.votes, voted_by_me: res.voted, score_votes: Math.min(res.votes / 5, 1) }
            : i,
        ),
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

  // Editor-only: wipe both the singular `constraint` and the JSON-array
  // `constraints` rows. Optimistic — drop them locally, restore on failure.
  const clearAllConstraints = useCallback(async () => {
    const prev = context;
    setContext((cur) => cur.filter((e) => e.key !== 'constraints' && e.key !== 'constraint'));
    try {
      await clearConstraints();
    } catch (e) {
      console.error('clear constraints failed', e);
      setError(e.message);
      setContext(prev);
    }
  }, [context]);

  // Optimistic deadline save. Empty string clears.
  const saveDeadline = useCallback(async (next) => {
    const cleaned = (next ?? '').trim();
    const prev = deadline;
    setDeadline(cleaned || null);
    try {
      const res = await patchBoard({ deadline: cleaned });
      setDeadline(res?.deadline ?? null);
    } catch (e) {
      console.error('deadline save failed', e);
      setError(e.message);
      setDeadline(prev);
    }
  }, [deadline]);

  return (
    <div className="app">
      <Header
        total={ideas.length}
        me={me}
        boardName={boardName}
        deadline={deadline}
        canEdit={canEdit}
        onSaveDeadline={saveDeadline}
      />

      <main className="body">
        <Rail
          team={team}
          context={context}
          loading={loading}
          canEdit={canEdit}
          onClearConstraints={clearAllConstraints}
        />
        <section className="board">
          {COLUMNS.map((col, idx) => (
            <Column
              key={col.id}
              index={idx}
              column={col}
              ideas={byStage[col.id]}
              loading={loading}
              onOpen={setOpenId}
              onVote={canVote ? toggleVote : null}
              isAuthed={isAuthed}
            />
          ))}
        </section>
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

      {open && (
        <Editor
          idea={open}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onSave={updateIdea}
        />
      )}
    </div>
  );
}

function Header({ total, me, boardName, deadline, canEdit, onSaveDeadline }) {
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
        <img className="head__mark" src="/logo.svg" alt="" width="22" height="22" />
        <span className="head__name">Quorum</span>
        {boardName ? (
          <>
            <span className="head__divider" aria-hidden="true">/</span>
            <span className="head__board">{boardName}</span>
          </>
        ) : (
          <span className="head__tag">— what to build</span>
        )}
      </div>
      <div className="head__meta">
        <DeadlineChip
          deadline={deadline}
          canEdit={canEdit && !usingMock}
          onSave={onSaveDeadline}
        />
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

function DeadlineChip({ deadline, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(deadline ?? '');

  useEffect(() => {
    setDraft(deadline ?? '');
  }, [deadline]);

  if (!deadline && !canEdit) return null;

  const commit = () => {
    setEditing(false);
    if ((draft ?? '').trim() !== (deadline ?? '')) onSave(draft);
  };
  const cancel = () => {
    setDraft(deadline ?? '');
    setEditing(false);
  };
  const onKey = (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  };

  if (editing) {
    return (
      <input
        className="head__deadline-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        placeholder="e.g. May 1 2026"
        autoFocus
      />
    );
  }

  if (!deadline) {
    return (
      <button
        className="head__deadline head__deadline--add"
        onClick={() => setEditing(true)}
        title="Set a deadline"
        type="button"
      >
        + deadline
      </button>
    );
  }

  return (
    <button
      className={`head__deadline${canEdit ? ' head__deadline--editable' : ''}`}
      onClick={canEdit ? () => setEditing(true) : undefined}
      disabled={!canEdit}
      title={canEdit ? 'Click to edit deadline' : 'Deadline'}
      type="button"
    >
      <span aria-hidden="true">🗓</span>
      <span>{deadline}</span>
    </button>
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

function Rail({ team, context, loading, canEdit, onClearConstraints }) {
  const hasConstraints = context.some(
    (e) => e.key === 'constraints' || e.key === 'constraint',
  );
  return (
    <aside className="rail">
      <section className="rail__section">
        <div className="rail__head">
          <span className="rail__num">A</span>
          <h2 className="rail__title">Team</h2>
          <span className="rail__count">{team.length}</span>
        </div>
        {loading ? (
          <div className="rail__hint">loading…</div>
        ) : team.length === 0 ? (
          <div className="rail__empty">— no members yet —</div>
        ) : (
          <ul className="rail__list">
            {team.map((m, i) => (
              <Member key={`${m.gh_user ?? m.name}-${i}`} member={m} />
            ))}
          </ul>
        )}
        <p className="rail__hint">join chat or sign in with github to appear here</p>
      </section>

      <section className="rail__section">
        <div className="rail__head">
          <span className="rail__num">B</span>
          <h2 className="rail__title">Context</h2>
          <span className="rail__count">{context.length}</span>
          {canEdit && hasConstraints && (
            <button
              className="rail__clear"
              type="button"
              onClick={onClearConstraints}
              title="Clear all constraints"
            >
              clear constraints
            </button>
          )}
        </div>
        {loading ? (
          <div className="rail__hint">loading…</div>
        ) : context.length === 0 ? (
          <div className="rail__empty">— none set —</div>
        ) : (
          <ul className="rail__ctx">
            {context.flatMap((entry) => renderContextEntry(entry))}
          </ul>
        )}
        <p className="rail__hint">/event &lt;url&gt; · /constraint &lt;text&gt;</p>
      </section>
    </aside>
  );
}

function Member({ member }) {
  const initial = (member.name?.[0] ?? '?').toUpperCase();
  const avatarUrl = member.gh_user
    ? `https://github.com/${encodeURIComponent(member.gh_user)}.png?size=80`
    : null;
  const skillsTitle = member.skills.length ? `skills: ${member.skills.join(', ')}` : 'no skills set';
  return (
    <li className="member" title={skillsTitle}>
      {avatarUrl ? (
        <img className="member__avatar" src={avatarUrl} alt="" />
      ) : (
        <span className="member__avatar member__avatar--initial">{initial}</span>
      )}
      <span className="member__body">
        <span className="member__name">{member.name}</span>
        {member.gh_user && (
          <span className="member__sub">@{member.gh_user}</span>
        )}
        {member.skills.length > 0 && (
          <span className="member__skills">
            {member.skills.slice(0, 3).join(' · ')}
            {member.skills.length > 3 ? ` +${member.skills.length - 3}` : ''}
          </span>
        )}
      </span>
    </li>
  );
}

// Render a context entry as one or more <li>. Arrays expand into separate
// rows so a multi-constraint /event read isn't one giant blob.
function renderContextEntry({ key, value }) {
  const label = key.replace(/_/g, ' ');
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return value.map((v, i) => (
      <li key={`${key}-${i}`} className="ctx">
        <span className="ctx__k">{label}</span>
        <span className="ctx__v">{stringifyContextValue(v)}</span>
      </li>
    ));
  }
  if (key === 'event_url' && typeof value === 'string') {
    return [
      <li key={key} className="ctx">
        <span className="ctx__k">{label}</span>
        <a className="ctx__v ctx__link" href={value} target="_blank" rel="noopener noreferrer">
          {value.replace(/^https?:\/\//, '')}
        </a>
      </li>,
    ];
  }
  return [
    <li key={key} className="ctx">
      <span className="ctx__k">{label}</span>
      <span className="ctx__v">{stringifyContextValue(value)}</span>
    </li>,
  ];
}

function stringifyContextValue(v) {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if (typeof v.name === 'string') return v.name;
    return JSON.stringify(v);
  }
  return String(v);
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

  // The card opens the modal for everyone — editors get an editable form,
  // viewers get a read-only detail view (handled inside <Editor>). The vote
  // button and the score badge are their own click targets that stop
  // propagation so they work regardless of card-level interactivity.
  const Tag = clickable ? 'button' : 'div';
  const handleCardClick = clickable ? () => onOpen(idea.uid) : undefined;

  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // Show "—" only when there is genuinely no signal: not yet validated AND no votes.
  // With votes replacing the old market placeholder, votes ARE a real signal —
  // an unvalidated idea with 3 votes deserves a partial score, not a dash.
  const unvalidated = idea.score_team == null && idea.score_resource == null && !idea.votes;
  const scoreLabel = unvalidated ? '—' : idea.score;

  const handleVote = (e) => {
    e.stopPropagation();
    if (onVote) onVote(idea.uid);
  };

  // Toggle the in-card scoring breakdown. Always available — anyone, editor
  // or viewer, can inspect how a score was assembled. We use role=button on a
  // div (not a real <button>) because the parent card may itself be a
  // <button> for editors, and nested <button> is invalid HTML.
  const toggleBreakdown = (e) => {
    e.stopPropagation();
    setBreakdownOpen((open) => !open);
  };
  const onScoreKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleBreakdown(e);
    }
  };

  return (
    <Tag
      className={`card ${clickable ? '' : 'card--static'} ${breakdownOpen ? 'card--open' : ''}`}
      style={{ '--d': delay }}
      onClick={handleCardClick}
      aria-label={clickable ? `Open ${idea.name}` : idea.name}
    >
      <div className="card__top">
        <h3 className="card__name">{idea.name}</h3>
        <div
          className={`card__score ${breakdownOpen ? 'card__score--open' : ''}`}
          role="button"
          tabIndex={0}
          aria-expanded={breakdownOpen}
          aria-label={`Score ${unvalidated ? 'pending' : `${idea.score} of 10`}. ${breakdownOpen ? 'Hide' : 'Show'} breakdown.`}
          onClick={toggleBreakdown}
          onKeyDown={onScoreKey}
        >
          <span className="card__score-num">{scoreLabel}</span>
          <span className="card__score-den">/10</span>
          <span className="card__score-caret" aria-hidden="true">▾</span>
        </div>
      </div>

      <p className="card__brief">{idea.brief}</p>

      {breakdownOpen && (
        <div className="card__breakdown" onClick={(e) => e.stopPropagation()}>
          <ScoreBar label="team" weight={0.5} value={idea.score_team} />
          <ScoreBar label="resource" weight={0.4} value={idea.score_resource} />
          <ScoreBar label="votes" weight={0.1} value={idea.score_votes ?? 0} />
          {idea.score_reason ? (
            <p className="card__breakdown-reason">{idea.score_reason}</p>
          ) : (
            <p className="card__breakdown-reason card__breakdown-reason--pending">
              not yet validated
            </p>
          )}
        </div>
      )}

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

function ScoreBar({ label, weight, value }) {
  const isPending = value == null;
  const pct = isPending ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className={`bar ${isPending ? 'bar--pending' : ''}`}>
      <div className="bar__head">
        <span className="bar__label">{label}</span>
        <span className="bar__weight">×{Math.round(weight * 100)}%</span>
        <span className="bar__value">{isPending ? '—' : value.toFixed(2)}</span>
      </div>
      <div className="bar__track">
        <div className="bar__fill" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

function Editor({ idea, canEdit, onClose, onSave }) {
  const [name, setName] = useState(idea.name);
  const [brief, setBrief] = useState(idea.brief ?? '');
  const [long, setLong] = useState(idea.long);
  const unvalidated = idea.score_team == null && idea.score_resource == null && !idea.votes;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty =
    canEdit &&
    (name !== idea.name || brief !== (idea.brief ?? '') || long !== idea.long);

  const save = () => {
    if (!dirty) return onClose();
    onSave(idea.uid, { name, brief, long });
    onClose();
  };

  const hoursLabel = idea.hours == null ? '—' : `~${idea.hours}h`;

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
          {canEdit ? (
            <label className="field">
              <span className="field__label">name</span>
              <input
                className="field__input field__input--display"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>
          ) : (
            <div className="field">
              <span className="field__label">name</span>
              <div className="field__readonly field__readonly--display">{idea.name}</div>
            </div>
          )}

          <div className="modal__row">
            <ReadOnly label="stage" value={idea.stage} />
            <ReadOnly label="score" value={unvalidated ? '—/10' : `${idea.score}/10`} />
            <ReadOnly label="estimate" value={hoursLabel} />
          </div>

          {canEdit ? (
            <label className="field">
              <span className="field__label">brief</span>
              <textarea
                className="field__input"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={2}
                placeholder="One-line description shown on the card"
              />
            </label>
          ) : (
            <div className="field">
              <span className="field__label">brief</span>
              <div className="field__readonly">{idea.brief}</div>
            </div>
          )}

          {canEdit ? (
            <label className="field">
              <span className="field__label">long description</span>
              <textarea
                className="field__input field__input--long"
                value={long}
                onChange={(e) => setLong(e.target.value)}
                rows={9}
              />
            </label>
          ) : (
            <div className="field">
              <span className="field__label">long description</span>
              <div className="field__readonly field__readonly--long">
                {idea.long || <span className="muted">— no long description yet —</span>}
              </div>
            </div>
          )}
        </div>

        <div className="modal__foot">
          <span className="modal__hint">
            {canEdit
              ? 'score, estimate & stage are agent-controlled. esc to close.'
              : 'read-only · esc to close · sign in as an editor to edit'}
          </span>
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={onClose}>
              {canEdit ? 'cancel' : 'close'}
            </button>
            {canEdit && (
              <button className="btn btn--primary" onClick={save} disabled={!dirty}>
                save
              </button>
            )}
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
