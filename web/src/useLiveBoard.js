// web/src/useLiveBoard.js
//
// React hook that owns the WebSocket lifecycle for the live board.
// Dispatches incoming Wire events to the pure reducer. Exposes
// { ideas, activity, presence, me, connectionState }.
//
// Reconnect: exponential backoff with 20% jitter (1, 2, 4, 8, 15s cap).
// After >10s offline, fires onStaleFallback so the UI can do a one-shot
// REST refetch instead of staring at a stale snapshot.

import { useEffect, useReducer, useRef, useState } from "react";
import { initial, reduce } from "./reducer.js";

const BACKOFF_SCHEDULE = [1000, 2000, 4000, 8000, 15000];
function jittered(ms) {
  const delta = ms * 0.2;
  return ms + Math.floor((Math.random() * 2 - 1) * delta);
}

export function useLiveBoard({ chat, onStaleFallback }) {
  const [state, dispatch] = useReducer(reduce, initial);
  const [connectionState, setConnectionState] = useState("connecting");
  const wsRef = useRef(null);
  const attemptRef = useRef(0);
  const offlineTimerRef = useRef(null);
  const closedByUserRef = useRef(false);

  useEffect(() => {
    closedByUserRef.current = false;
    let cancelled = false;

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
            if (onStaleFallback) onStaleFallback();
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
  }, [chat, onStaleFallback]);

  return { ...state, connectionState };
}
