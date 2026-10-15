import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect } from "react";
import { t } from "../i18n/locale";
import { FocusButton } from "../navigation/Focusable";

interface Props {
  genres: string[];
  onPick: (genre: string) => void;
  onClose: () => void;
}

/**
 * The phone app's categories: a dark panel that slides in from the right over a dimmed screen,
 * measured on a 393 px wide phone: from 34 % across, 16 px top-left corner, 56 px rows.
 */
export function CategorySheet({ genres, onPick, onClose }: Props) {
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "CATEGORY_SHEET",
    isFocusBoundary: true,
  });

  useEffect(() => {
    if (genres.length > 0) focusSelf();
  }, [genres.length, focusSelf]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        className="fixed inset-0 z-50"
        role="dialog"
        aria-modal="true"
        aria-label={t.home.categories}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-[fade-in_200ms_ease-out] bg-black/60"
          onClick={onClose}
        />
        <ul
          ref={ref}
          className="no-scrollbar absolute top-2 right-0 bottom-0 left-[34%] animate-[slide-in_250ms_ease-out] overflow-y-auto rounded-tl-2xl bg-[#232323] py-2 shadow-2xl"
        >
          {genres.map((genre) => (
            <li key={genre}>
              <FocusButton
                onPress={() => onPick(genre)}
                className="flex h-14 w-full items-center px-3.5 text-left text-[18px] text-white/90 outline-none focused:bg-white focused:text-black"
              >
                <span className="truncate">{genre}</span>
              </FocusButton>
            </li>
          ))}
        </ul>
      </div>
    </FocusContext.Provider>
  );
}
