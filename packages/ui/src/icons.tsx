import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  );
}

/** A phone next to a screen: linking another device to this account. */
export function LinkDeviceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="4" width="14" height="10" rx="1.5" />
      <path d="M6 18h6M9 14v4" />
      <rect x="15" y="9" width="7" height="12" rx="1.5" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12 5 5L20 7" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1Z" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </Icon>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12H4M10 6l-6 6 6 6" />
    </Icon>
  );
}

export function TvIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Icon>
  );
}

export function FilmIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" />
    </Icon>
  );
}

export function ThumbUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 10v11H4V10Zm0 0 4-7a2.5 2.5 0 0 1 2.5 3L13 10h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.1 21H7" />
    </Icon>
  );
}

export function ThumbDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17 14V3h3v11Zm0 0-4 7a2.5 2.5 0 0 1-2.5-3l.5-4H5.5a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 6.9 3H17" />
    </Icon>
  );
}

/** Netflix's "Love this": two thumbs up, one behind the other. */
export function DoubleThumbUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 11v10H6V11Zm0 0 3.5-6.5a2.3 2.3 0 0 1 2.3 2.8L14.4 11h4.8a1.8 1.8 0 0 1 1.8 2.2l-1.3 6.2a1.9 1.9 0 0 1-1.9 1.6H9" />
      <path d="M5 16.5V9.5L8.2 3.8" />
    </Icon>
  );
}

/** Netflix's "Start over": an arrow running back round a circle. */
export function RestartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
      <path d="M4.5 4v5h5" />
      <path d="M10.5 9.2v5.6l4.4-2.8Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Netflix's play button on an episode still or a search row: a ring with a solid triangle. */
export function PlayCircleIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.5} {...props}>
      <circle cx="12" cy="12" r="10.5" />
      <path d="M10 8.2v7.6l6-3.8Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Netflix's small solid caret next to the profile button. */
export function CaretIcon(props: IconProps) {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <path d="M6 9.5h12L12 16Z" />
    </Icon>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <rect x="5.5" y="4" width="4.5" height="16" rx="1" />
      <rect x="14" y="4" width="4.5" height="16" rx="1" />
    </Icon>
  );
}

/** A circular arrow with the 10 seconds it jumps written inside, as on Netflix's player. */
function Skip10Icon({ forward, ...props }: IconProps & { forward: boolean }) {
  return (
    <Icon strokeWidth={1.8} {...props}>
      <g transform={forward ? undefined : "matrix(-1 0 0 1 24 0)"}>
        <path d="M19.5 12A7.5 7.5 0 1 1 12 4.5h3" />
        <path d="m13 1.8 2.7 2.7-2.7 2.7" />
      </g>
      <text
        x="12"
        y="15.6"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
      >
        10
      </text>
    </Icon>
  );
}

export function RewindIcon(props: IconProps) {
  return <Skip10Icon forward={false} {...props} />;
}

export function ForwardIcon(props: IconProps) {
  return <Skip10Icon forward {...props} />;
}

/** The speaker with as many waves as the volume is high, and a cross when muted. */
export function VolumeIcon({
  muted,
  level = 1,
  ...props
}: IconProps & { muted: boolean; level?: number }) {
  return (
    <Icon {...props}>
      <path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4Z" fill="currentColor" />
      {muted || level === 0 ? (
        <path d="m16 9.5 5 5M21 9.5l-5 5" />
      ) : (
        <>
          <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
          {level > 0.5 && <path d="M18.5 6.5a8 8 0 0 1 0 11" />}
        </>
      )}
    </Icon>
  );
}

export function ChevronIcon({ left, ...props }: IconProps & { left?: boolean }) {
  return (
    <Icon {...props}>
      <path d={left ? "m15 5-7 7 7 7" : "m9 5 7 7-7 7"} />
    </Icon>
  );
}

/** Netflix's "Audio & subtitles": a speech bubble with lines of text. */
export function SubtitlesIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.8} {...props}>
      <path d="M3.5 5.5h17v11H10l-4.5 3.5v-3.5h-2Z" />
      <path d="M7 10h4M13.5 10H17M7 13h7" />
    </Icon>
  );
}

export function NextEpisodeIcon(props: IconProps) {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <path d="M4 5.2v13.6a.8.8 0 0 0 1.25.66L15 12.66a.8.8 0 0 0 0-1.32L5.25 4.54A.8.8 0 0 0 4 5.2Z" />
      <rect x="17" y="4.5" width="3" height="15" rx=".8" />
    </Icon>
  );
}

export function FullscreenIcon({ exit, ...props }: IconProps & { exit: boolean }) {
  return (
    <Icon {...props}>
      {exit ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      )}
    </Icon>
  );
}

/** Netflix's collection mark: a shelf of standing volumes. */
export function CollectionIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.8} {...props}>
      <path d="M3 4h18v16H3Z" />
      <path d="M7 8v8M10.5 8v8M14 8l3 8" />
    </Icon>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </Icon>
  );
}

export function LaptopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </Icon>
  );
}
