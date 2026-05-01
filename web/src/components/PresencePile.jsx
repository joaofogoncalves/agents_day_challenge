import React from "react";

const VISIBLE = 5;

function avatarFor(actor) {
  if (actor.kind === "user") {
    return actor.avatar || `https://github.com/${actor.login}.png?size=40`;
  }
  return null;
}

function titleFor(actor) {
  if (actor.kind === "user") return actor.login;
  if (actor.kind === "agent") return "Quorum";
  return "anonymous";
}

export function PresencePile({ presence }) {
  const visible = presence.slice(0, VISIBLE);
  const overflow = Math.max(0, presence.length - VISIBLE);
  return (
    <div className="presence-pile" aria-label={`${presence.length} viewer${presence.length === 1 ? "" : "s"}`}>
      {visible.map((p) => {
        const url = avatarFor(p.actor);
        return (
          <span key={p.connection_id} className="presence-pile__slot" title={titleFor(p.actor)}>
            {url ? <img src={url} alt={titleFor(p.actor)} /> : <span className="presence-pile__anon" />}
          </span>
        );
      })}
      {overflow > 0 && <span className="presence-pile__overflow">+{overflow}</span>}
    </div>
  );
}
