import { useEffect, useEffectEvent, useState } from "react";
import { t } from "../i18n/locale";
import { loadGenres } from "../jellyfin/browse";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import { Picker } from "../ui/Picker";
import { CategorySheet } from "./CategorySheet";

interface Props {
  connection: Connection;
  userId: string;
  libraryId: string | null;
  /** Wide screens get the full-screen list; phones, the app's side panel. */
  wide: boolean;
  onPick: (genre: string) => void;
  onClose: () => void;
  onExpired: () => void;
}

/** Netflix's "Categories" chip opens this: every genre, in its full-screen list. */
export function Categories(props: Props) {
  const { connection, userId, libraryId, wide, onPick, onClose, onExpired } = props;
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

  if (!wide) return <CategorySheet genres={genres} onPick={onPick} onClose={onClose} />;
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
