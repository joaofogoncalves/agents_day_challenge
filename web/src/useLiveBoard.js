// web/src/useLiveBoard.js
//
// React hook that owns the WebSocket lifecycle for the live board.
// Dispatches incoming Wire events to the pure reducer. Exposes
// { ideas, activity, presence, me, connectionState, dispatch }.
//
// REST safety net: on mount, fires fetchBoard + fetchMe in parallel with
// the WS connect. When both resolve a synthetic hello is dispatched so the
// board populates even if /api/socket never upgrades. A real WS hello
// replaces the REST-seeded state (WS is source of truth once connected).
//
// Reconnect: exponential backoff with 20% jitter (1, 2, 4, 8, 15s cap).
// After >10s offline, re-fires the REST fallback so the board re-populates.

import { useEffect, useReducer, useRef, useState } from "react";
import { initial, reduce } from "./reducer.js";
import { fetchBoard, fetchMe } from "./api.js";

const BACKOFF_SCHEDULE = [1000, 2000, 4000, 8000, 15000];
function jittered(ms) {
  const delta = ms * 0.2;
  return ms + Math.floor((Math.random() * 2 - 1) * delta);
}

async function restFallback(chat, helloSeenRef, dispatch) {
  try {
    const [boardJson, meJson] = await Promise.all([fetchBoard(chat), fetchMe()]);
    // If a real WS hello arrived while we were fetching, don't overwrite it.
    if (helloSeenRef.current) return;
    const syntheticHello = {
      kind: "hello",
      snapshot: {
        ideas: boardJson.ideas ?? [],
        activity: [],
        presence: [],
        me:
          meJson && meJson.login
            ? {
                voter_key: `gh:${meJson.login.toLowerCase()}`,
                login: meJson.login,
                can_edit: !!meJson.can_edit,
              }
            : { voter_key: "", login: null, can_edit: false },
        last_event_id: 0,
      },
    };
    dispatch(syntheticHello);
  } catch {
    // REST fallback failing is non-fatal — board stays empty until WS connects.
  }
}

export function useLiveBoard({ chat }) {
  const [state, dispatch] = useReducer(reduce, initial);
  const [connectionState, setConnectionState] = useState("connecting");
  const wsRef = useRef(null);
  const attemptRef = useRef(0);
  const offlineTimerRef = useRef(null);
  const closedByUserRef = useRef(false);
  const helloSeenRef = useRef(false);

  useEffect(() => {
    closedByUserRef.current = false;
    helloSeenRef.current = false;
    let cancelled = false;

    // Fire REST in parallel with WS connect — cold-start safety net.
    restFallback(chat, helloSeenRef, dispatch);

    function connect() {
      if (cancelled) return;
      setConnectionState((cur) => (cur === "open" ? "reconnecting" : "connecting"));
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/socket${chat ? `?chat=${encodeURIComponent(chat)}` : ""}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        setConnectionState("open");
      };

      ws.onmessage = (msg) => {
        try {
          const ev = JSON.parse(msg.data);
          if (ev.kind === "hello") helloSeenRef.current = true;
          dispatch(ev);
        } catch {
          // bad frame — ignore
        }
      };

      ws.onclose = () => {
        if (closedByUserRef.current || cancelled) return;
        setConnectionState("reconnecting");
        const delay = jittered(BACKOFF_SCHEDULE[Math.min(attemptRef.current, BACKOFF_SCHEDULE.length - 1)]);
        attemptRef.current += 1;
        if (!offlineTimerRef.current) {
          offlineTimerRef.current = setTimeout(() => {
            setConnectionState("offline");
            // Re-seed from REST when we've been offline long enough.
            restFallback(chat, helloSeenRef, dispatch);
          }, 10_000);
        }
        setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire — backoff handles the rest
      };
    }

    connect();

    return () => {
      cancelled = true;
      closedByUserRef.current = true;
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
      }
    };
  }, [chat]);

  return { ...state, connectionState, dispatch };
}
