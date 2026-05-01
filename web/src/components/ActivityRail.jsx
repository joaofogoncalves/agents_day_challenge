import React, { useEffect, useRef, useState } from "react";

function formatRelative(ts) {
  const dt = Math.max(0, Date.now() - ts);
  const s = Math.floor(dt / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ActivityRail({ activity }) {
  const scrollRef = useRef(null);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop <= 8) {
      el.scrollTop = 0;
      setUnseen(0);
    } else {
      setUnseen((n) => n + 1);
    }
  }, [activity.length]);

  function jumpToTop() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setUnseen(0);
  }

  return (
    <aside className="rail">
      <header className="rail__header">activity</header>
      {unseen > 0 && (
        <button className="rail__pill" onClick={jumpToTop}>
          {unseen} new ↑
        </button>
      )}
      <div className="rail__scroll" ref={scrollRef}>
        {activity.map((row) => (
          <div key={row.id} className="rail__row">
            <span className="rail__chevron">{">"}</span>
            <span className="rail__summary">{row.summary}</span>
            <span className="rail__ts">{formatRelative(row.ts)}</span>
          </div>
        ))}
        {activity.length === 0 && <div className="rail__empty">no activity yet</div>}
      </div>
    </aside>
  );
}
