// web/src/reducer.js
//
// Pure reducer for live-board state. Consumes Wire events and produces
// new { ideas, activity, presence, me } on each call. No side effects.

const STATUS_TO_STAGE = {
  ideating: "bucket",
  validating: "candidates",
  planning: "selected",
};

export const initial = {
  ideas: [],
  activity: [],
  presence: [],
  me: { voter_key: "", login: null, can_edit: false },
  last_event_id: 0,
};

function pushActivity(activity, row) {
  return [row, ...activity].slice(0, 50);
}

export function reduce(state, ev) {
  switch (ev.kind) {
    case "hello":
      return {
        ideas: ev.snapshot.ideas,
        activity: [...ev.snapshot.activity].reverse(),
        presence: ev.snapshot.presence,
        me: ev.snapshot.me,
        last_event_id: ev.snapshot.last_event_id,
      };

    case "idea_added":
      return { ...state, ideas: [...state.ideas, ev.idea], activity: pushActivity(state.activity, ev.activity) };

    case "idea_voted": {
      const meKey = state.me.voter_key;
      const ideas = state.ideas.map((i) => {
        if (i.uid !== ev.uid) return i;
        return {
          ...i,
          votes: ev.votes,
          score_votes: Math.min(ev.votes / 5, 1),
          voted_by_me: ev.voter_key === meKey ? ev.voted : i.voted_by_me,
        };
      });
      return { ...state, ideas, activity: pushActivity(state.activity, ev.activity) };
    }

    case "idea_edited": {
      const ideas = state.ideas.map((i) => i.uid === ev.uid ? { ...i, ...ev.patch } : i);
      return { ...state, ideas, activity: pushActivity(state.activity, ev.activity) };
    }

    case "idea_phase_change": {
      const stage = STATUS_TO_STAGE[ev.status];
      const ideas = stage
        ? state.ideas.map((i) => i.uid === ev.uid ? { ...i, stage } : i)
        : state.ideas.filter((i) => i.uid !== ev.uid);
      return { ...state, ideas, activity: pushActivity(state.activity, ev.activity) };
    }

    case "scored": {
      const ideas = state.ideas.map((i) => i.uid === ev.uid ? { ...i, score: ev.score } : i);
      return { ...state, ideas, activity: pushActivity(state.activity, ev.activity) };
    }

    case "constraint_applied":
      return { ...state, activity: pushActivity(state.activity, ev.activity) };

    case "presence_join":
      return {
        ...state,
        presence: [...state.presence.filter((p) => p.connection_id !== ev.presence.connection_id), ev.presence],
      };

    case "presence_leave":
      return { ...state, presence: state.presence.filter((p) => p.connection_id !== ev.connection_id) };

    default:
      return state;
  }
}
