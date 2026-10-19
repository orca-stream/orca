import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronIcon } from "../ui/icons";

interface Props {
  children: ReactNode;
}

/**
 * A row of the icon picker with Netflix's arrows: one on each side while there's more that way,
 * over the icon the edge cuts, always visible (not only on hover, unlike the home shelves).
 */
export function IconRow({ children }: Props) {
  const row = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ back: false, forward: false });

  function measure() {
    const list = row.current;
    if (!list) return;
    const back = list.scrollLeft > 1;
    const forward = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
    setMore((current) =>
      current.back === back && current.forward === forward ? current : { back, forward },
    );
  }

  useEffect(() => {
    const list = row.current;
    if (!list) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  /** A screen of icons at a time, keeping the one the edge cut as the first of the next screen. */
  function page(direction: 1 | -1) {
    const list = row.current;
    const icon = list?.querySelector("li");
    if (!list || !icon) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollBy({
      left: direction * Math.max(icon.offsetWidth, list.clientWidth - icon.offsetWidth),
      behavior: smooth ? "smooth" : "auto",
    });
  }

  return (
    <div className="relative">
      <ul
        ref={row}
        onScroll={measure}
        className="-mx-2 flex gap-3 overflow-x-auto px-2 py-2 [scrollbar-width:none] sm:gap-4"
      >
        {children}
      </ul>
      <RowArrow left hidden={!more.back} onPress={() => page(-1)} />
      <RowArrow hidden={!more.forward} onPress={() => page(1)} />
    </div>
  );
}

/** For a mouse or touch: keys and the gamepad move icon by icon, so it never takes focus. */
function RowArrow(props: { left?: boolean; hidden: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={props.onPress}
      className={`absolute inset-y-2 z-10 grid w-10 place-items-center from-neutral-950 via-neutral-950/80 to-transparent transition-opacity sm:w-14 ${
        props.left ? "-left-2 bg-linear-to-r" : "-right-2 bg-linear-to-l"
      } ${props.hidden ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      <ChevronIcon left={props.left} className="size-8 transition-transform hover:scale-125" />
    </button>
  );
}
