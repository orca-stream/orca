import { useEffect, useEffectEvent, useState } from "react";
import { t } from "../i18n/locale";
import { loadGenres } from "../jellyfin/browse";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import { Picker } from "../ui/Picker";

interface Props {
  connection: Connection;
  userId: string;
  libraryId: string | null;
  onPick: (genre: string) => void;
  onClose: () => void;
  onExpired: () => void;
}

/** Netflix's "Categories" chip opens this: every genre, in its full-screen list. */
export function Categories({ connection, userId, libraryId, onPick, onClose, onExpired }: Props) {
  const [genres, setGenres] = useState<string[]>([]);
  const fail = useEffectEvent((error: unknown) => {
    if (error instanceof SessionExpiredError) onExpired();
  });

  useEffect(() => {
    let current = true;
    loadGenres(connection, userId, libraryId ?? undefined).then((loaded) => {
      if (current) setGenres(loaded);
    }, fail);
    return () => {
      current = false;
    };
  }, [connection, userId, libraryId]);

  return (
    <Picker
      label={t.home.categories}
      closeLabel={t.home.closeCategories}
      options={genres.map((genre) => ({ id: genre, label: genre }))}
      selected={null}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
