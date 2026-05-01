import React from "react";

const TITLES = {
  connecting: "Connecting…",
  open: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline — refresh to retry",
};

export function ConnectionDot({ state }) {
  const cls = `conn-dot conn-dot--${state}`;
  return <span className={cls} title={TITLES[state] ?? state} aria-label={TITLES[state] ?? state} />;
}
