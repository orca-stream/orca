import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect } from "react";
import { FocusButton } from "../navigation/Focusable";
import { CloseIcon } from "./icons";

export interface PickerOption {
  id: string;
  label: string;
}

interface Props {
  label: string;
  closeLabel: string;
  options: PickerOption[];
  selected: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}

const SELECTED_KEY = "PICKER_SELECTED";

/**
 * Netflix's full-screen list for categories and seasons: the options centred over a dark veil,
 * the chosen one larger and white, and a round white close button at the bottom.
 */
export function Picker({ label, closeLabel, options, selected, onPick, onClose }: Props) {
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "PICKER",
    isFocusBoundary: true,
    preferredChildFocusKey: SELECTED_KEY,
  });

  useEffect(() => {
    focusSelf();
    function close(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "GoBack" && event.key !== "BrowserBack") return;
      // Handled here, so an overlay underneath doesn't close along with the picker.
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", close, { capture: true });
    return () => window.removeEventListener("keydown", close, { capture: true });
  }, [focusSelf, onClose]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="fixed inset-0 z-50 grid grid-rows-[1fr_auto] bg-black/85 backdrop-blur-sm"
      >
        {/*
          Centred with auto margins, not `content-center`: a centred list longer than the screen
          spills above the top, where it can't be scrolled to. Auto margins drop to 0 instead.
        */}
        <div className="no-scrollbar grid min-h-0 overflow-y-auto">
          <ul className="my-auto grid justify-items-center gap-2 py-10">
            {options.map((option) => {
              const isSelected = option.id === selected;
              return (
                <li key={option.id}>
                  <FocusButton
                    focusKey={isSelected ? SELECTED_KEY : undefined}
                    aria-current={isSelected ? "true" : undefined}
                    onPress={() => onPick(option.id)}
                    className={`rounded px-4 py-2 outline-none focused:bg-white focused:text-black ${
                      isSelected
                        ? "text-[21px] font-bold text-white"
                        : "text-lg text-white/60 hover:text-white"
                    }`}
                  >
                    {option.label}
                  </FocusButton>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="grid justify-items-center pt-2 pb-10">
          <FocusButton
            aria-label={closeLabel}
            onPress={onClose}
            className="grid size-14 place-items-center rounded-full bg-white text-black outline-none focused:ring-4 focused:ring-white/50"
          >
            <CloseIcon className="size-7" />
          </FocusButton>
        </div>
      </div>
    </FocusContext.Provider>
  );
}
