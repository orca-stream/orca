import { useState } from "react";
import { avatarUrl } from "../jellyfin/client";
import type { Session } from "../jellyfin/session";
import { fallbackColor } from "./fallback-color";

interface Props {
  session: Session;
  className?: string;
}

export function Avatar({ session, className = "" }: Props) {
  const url = avatarUrl(session);
  const [broken, setBroken] = useState<string | null>(null);

  if (url && broken !== url) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        onError={() => setBroken(url)}
        className={`object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`grid place-items-center font-bold text-white ${fallbackColor(session.userId)} ${className}`}
    >
      {session.userName.charAt(0).toUpperCase()}
    </span>
  );
}
