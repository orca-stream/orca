import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { t } from "../i18n/locale";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import type { MediaItem } from "../jellyfin/library";
import {
  loadEpisodes,
  loadSimilar,
  loadTitle,
  setFavorite,
  setLiked,
  type Episode,
  type Title,
} from "../jellyfin/title";
import { PosterCard } from "../home/PosterCard";
import { FocusButton } from "../navigation/Focusable";
import {
  BackIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  PlayCircleIcon,
  PlayIcon,
  PlusIcon,
  ThumbUpIcon,
} from "../ui/icons";
import { Picker } from "../ui/Picker";

interface Props {
  connection: Connection;
  userId: string;
  itemId: string;
  /** Wide screens get Netflix web's modal; phones, the app's full page. */
  wide: boolean;
  onClose: () => void;
  onOpen: (item: MediaItem) => void;
  /** Plays a movie, an episode, or a series' next episode. */
  onPlay: (itemId: string) => void;
  onExpired: () => void;
}

type State = { kind: "loading" } | { kind: "ready"; title: Title } | { kind: "error" };
type Tab = "episodes" | "similar";

const PLAY = "TITLE_PLAY";

export function TitlePage(props: Props) {
  const { connection, userId, itemId, wide, onClose, onOpen, onPlay, onExpired } = props;
  const [state, setState] = useState<State>({ kind: "loading" });
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "TITLE_PAGE",
    isFocusBoundary: true,
    preferredChildFocusKey: PLAY,
  });
  const expired = useEffectEvent(onExpired);

  useEffect(() => {
    let current = true;
    loadTitle(connection, userId, itemId).then(
      (title) => {
        if (current) setState({ kind: "ready", title });
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof SessionExpiredError) expired();
        else setState({ kind: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [connection, userId, itemId]);

  useEffect(() => {
    if (state.kind !== "loading") focusSelf();
  }, [state.kind, focusSelf]);

  const body =
    state.kind === "ready" ? (
      <Details
        // A similar title opens in place: nothing carries over from the previous one.
        key={state.title.item.id}
        title={state.title}
        connection={connection}
        userId={userId}
        wide={wide}
        onOpen={onOpen}
        onPlay={onPlay}
        onExpired={onExpired}
      />
    ) : state.kind === "error" ? (
      <p className="px-2.5 py-16 text-center text-white/70">{t.title.loadError}</p>
    ) : (
      <div aria-hidden="true" className="aspect-video w-full animate-pulse bg-white/10" />
    );

  return (
    <FocusContext.Provider value={focusKey}>
      {wide ? (
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-30 overflow-y-auto bg-black/70 px-4 py-8"
          onClick={(event) => event.target === event.currentTarget && onClose()}
        >
          <div className="relative mx-auto max-w-[850px] overflow-hidden rounded-lg bg-[#181818] pb-12 shadow-2xl">
            <FocusButton
              aria-label={t.title.back}
              onPress={onClose}
              className="absolute top-4 right-4 z-10 grid size-9 place-items-center rounded-full bg-[#181818] outline-none focused:ring-4 focused:ring-white/60"
            >
              <CloseIcon className="size-5" />
            </FocusButton>
            {body}
          </div>
        </div>
      ) : (
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-30 overflow-y-auto bg-black pb-28"
        >
          <div className="sticky top-0 z-10 flex h-[52px] items-center bg-black px-1">
            <FocusButton
              aria-label={t.title.back}
              onPress={onClose}
              className="grid size-11 place-items-center rounded-full outline-none focused:bg-white focused:text-black"
            >
              <BackIcon className="size-6" />
            </FocusButton>
          </div>
          {body}
        </div>
      )}
    </FocusContext.Provider>
  );
}

interface DetailsProps {
  title: Title;
  connection: Connection;
  userId: string;
  wide: boolean;
  onOpen: (item: MediaItem) => void;
  onPlay: (itemId: string) => void;
  onExpired: () => void;
}

function Details(props: DetailsProps) {
  const { title, connection, userId, wide, onOpen, onPlay, onExpired } = props;
  const { item } = title;
  const series = item.kind === "series";
  const [tab, setTab] = useState<Tab>(series ? "episodes" : "similar");
  const [favorite, setFavoriteState] = useState(item.favorite);
  const [liked, setLikedState] = useState(item.liked);
  const [episodesHd, setEpisodesHd] = useState(false);

  // Optimistic, as Netflix's buttons are: the icon flips at once and flips back if the server says no.
  function toggle(value: boolean, set: (next: boolean) => void, save: typeof setFavorite): void {
    set(!value);
    save(connection, userId, item.id, !value).catch((error: unknown) => {
      set(value);
      if (error instanceof SessionExpiredError) onExpired();
    });
  }

  const meta = (
    <Meta
      year={item.year}
      rating={item.rating}
      extent={
        series
          ? title.episodeCount
            ? t.title.episodeCount(title.episodeCount)
            : undefined
          : item.runtimeMinutes
            ? t.home.duration(Math.floor(item.runtimeMinutes / 60), item.runtimeMinutes % 60)
            : undefined
      }
      hd={title.hd || episodesHd}
    />
  );
  const people = (
    <>
      {title.cast.length > 0 && <People label={t.title.cast} names={title.cast} />}
      {title.creators.length > 0 && (
        <People label={series ? t.title.creators : t.title.directors} names={title.creators} />
      )}
    </>
  );
  const actions = (
    <div className="mt-5 flex">
      <Action
        label={t.home.myList}
        active={favorite}
        icon={
          favorite ? <CheckIcon className="size-[26px]" /> : <PlusIcon className="size-[26px]" />
        }
        onPress={() => toggle(favorite, setFavoriteState, setFavorite)}
      />
      <Action
        label={liked ? t.title.rated : t.title.rate}
        active={liked}
        icon={<ThumbUpIcon className={`size-[26px] ${liked ? "fill-current" : ""}`} />}
        onPress={() => toggle(liked, setLikedState, setLiked)}
      />
    </div>
  );

  const tabs = (
    <Tabs
      tab={tab}
      onTab={setTab}
      tabs={[
        ...(series ? [{ id: "episodes" as const, label: t.title.episodes }] : []),
        { id: "similar" as const, label: t.title.similar },
      ]}
    />
  );
  const panel =
    tab === "episodes" ? (
      <Episodes
        title={title}
        connection={connection}
        userId={userId}
        wide={wide}
        onPlay={onPlay}
        onHd={setEpisodesHd}
        onExpired={onExpired}
      />
    ) : (
      <Similar
        connection={connection}
        userId={userId}
        itemId={item.id}
        onOpen={onOpen}
        onExpired={onExpired}
      />
    );

  if (wide) {
    return (
      <>
        <div className="relative aspect-video w-full">
          {item.backdropUrl && (
            <img src={item.backdropUrl} alt="" className="size-full object-cover" />
          )}
          <div className="absolute inset-0 bg-linear-to-t from-[#181818] via-transparent to-transparent" />
          <div className="absolute inset-x-12 bottom-10 grid gap-6">
            <h1>
              {item.logoUrl ? (
                <img
                  src={item.logoUrl}
                  alt={item.title}
                  className="max-h-28 max-w-[50%] object-contain object-left"
                />
              ) : (
                <span className="text-4xl font-bold">{item.title}</span>
              )}
            </h1>
            <div className="flex items-center gap-3">
              <FocusButton
                focusKey={PLAY}
                onPress={() => onPlay(item.id)}
                className="inline-flex h-11 items-center gap-2 rounded-[4px] bg-white px-7 text-lg font-bold text-black outline-none hover:bg-white/80 focused:ring-4 focused:ring-white/50"
              >
                <PlayIcon className="size-7 flex-none" />
                {t.home.play}
              </FocusButton>
              <RoundButton
                label={t.home.myList}
                pressed={favorite}
                onPress={() => toggle(favorite, setFavoriteState, setFavorite)}
              >
                {favorite ? <CheckIcon className="size-6" /> : <PlusIcon className="size-6" />}
              </RoundButton>
              <RoundButton
                label={t.title.rate}
                pressed={liked}
                onPress={() => toggle(liked, setLikedState, setLiked)}
              >
                <ThumbUpIcon className={`size-6 ${liked ? "fill-current" : ""}`} />
              </RoundButton>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-[2fr_1fr] gap-8 px-12">
          <div className="grid content-start gap-4">
            {meta}
            {item.overview && <p className="text-[15px] leading-6">{item.overview}</p>}
          </div>
          <div className="grid content-start gap-2 text-sm">{people}</div>
        </div>
        <div className="mt-8 px-12">
          {tabs}
          {panel}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="relative aspect-video w-full bg-neutral-900">
        {item.backdropUrl && (
          <img src={item.backdropUrl} alt="" className="size-full object-cover" />
        )}
        {/* A tap on the picture plays too; the keys reach "Play" below instead. */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={t.home.play}
          onClick={() => onPlay(item.id)}
          className="absolute inset-0 grid place-items-center outline-none"
        >
          <PlayCircleIcon className="size-[47px] rounded-full bg-black/35 text-white" />
        </button>
      </div>
      <div className="px-2.5">
        <h1 className="mt-3 text-[25px] leading-[30px] font-bold">{item.title}</h1>
        <div className="mt-1.5">{meta}</div>
        <FocusButton
          focusKey={PLAY}
          onPress={() => onPlay(item.id)}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-[4px] bg-white text-[17px] font-bold text-black outline-none focused:ring-4 focused:ring-white/50"
        >
          <PlayIcon className="size-6 flex-none" />
          {t.title.watch}
        </FocusButton>
        {item.overview && <p className="mt-3 text-[14px] leading-5">{item.overview}</p>}
        <div className="mt-2 grid gap-0.5 text-[12px] leading-[17px]">{people}</div>
        {actions}
      </div>
      <div className="mt-6">
        {tabs}
        <div className="px-2.5">{panel}</div>
      </div>
    </>
  );
}

function Meta(props: { year?: number; rating?: string; extent?: string; hd: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-2.5 text-[13px] text-white/70">
      {props.year && <span>{props.year}</span>}
      {props.rating && (
        <span className="rounded-[2px] bg-[#414141] px-1.5 py-px text-white/90">
          {props.rating}
        </span>
      )}
      {props.extent && <span>{props.extent}</span>}
      {props.hd && (
        <span className="rounded-[3px] border border-white/70 px-1 text-[10px] leading-[14px] font-bold text-white/90">
          HD
        </span>
      )}
    </p>
  );
}

function People({ label, names }: { label: string; names: string[] }) {
  return (
    <p className="line-clamp-1 text-white/60">
      <span>{label} </span>
      <span>{names.join(", ")}</span>
    </p>
  );
}

function Action(props: { label: string; icon: ReactNode; active: boolean; onPress: () => void }) {
  return (
    <FocusButton
      aria-pressed={props.active}
      onPress={props.onPress}
      className="group grid w-[95px] justify-items-center gap-2 rounded-md py-1 text-[11px] text-white/60 outline-none focused:bg-white focused:text-black"
    >
      <span className="text-white group-focused:text-black">{props.icon}</span>
      {props.label}
    </FocusButton>
  );
}

function RoundButton(props: {
  label: string;
  pressed: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <FocusButton
      aria-label={props.label}
      aria-pressed={props.pressed}
      onPress={props.onPress}
      className="grid size-11 place-items-center rounded-full border-2 border-white/50 bg-[#2a2a2a]/60 outline-none hover:border-white focused:border-white focused:bg-white focused:text-black"
    >
      {props.children}
    </FocusButton>
  );
}

function Tabs({
  tab,
  onTab,
  tabs,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  tabs: { id: Tab; label: string }[];
}) {
  return (
    <div role="tablist" className="flex gap-6 border-t border-white/25 px-2.5">
      {tabs.map((entry) => {
        const active = entry.id === tab;
        return (
          <FocusButton
            key={entry.id}
            role="tab"
            aria-selected={active}
            onPress={() => onTab(entry.id)}
            className={`relative pt-3.5 pb-1 text-[15px] font-bold outline-none focused:underline ${
              active ? "text-white" : "text-white/70"
            }`}
          >
            {active && (
              <span className="absolute inset-x-0 -top-px h-1 bg-[#e50914]" aria-hidden="true" />
            )}
            {entry.label}
          </FocusButton>
        );
      })}
    </div>
  );
}

function Episodes({
  title,
  connection,
  userId,
  wide,
  onPlay,
  onHd,
  onExpired,
}: {
  title: Title;
  connection: Connection;
  userId: string;
  wide: boolean;
  onPlay: (itemId: string) => void;
  onHd: (hd: boolean) => void;
  onExpired: () => void;
}) {
  const [seasonId, setSeasonId] = useState(title.initialSeasonId);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [picking, setPicking] = useState(false);
  const expired = useEffectEvent(onExpired);
  const reportHd = useEffectEvent(onHd);
  const season = title.seasons.find((entry) => entry.id === seasonId);

  useEffect(() => {
    if (!seasonId) return;
    let current = true;
    loadEpisodes(connection, userId, title.item.id, seasonId).then(
      (loaded) => {
        if (!current) return;
        setEpisodes(loaded);
        reportHd(loaded.some((episode) => episode.hd));
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof SessionExpiredError) expired();
        else setEpisodes([]);
      },
    );
    return () => {
      current = false;
    };
  }, [connection, userId, title.item.id, seasonId]);

  return (
    <div className="mt-[22px]">
      {title.seasons.length > 1 ? (
        <FocusButton
          aria-haspopup="dialog"
          aria-label={`${t.title.chooseSeason}: ${season?.name ?? ""}`}
          onPress={() => setPicking(true)}
          className="inline-flex h-9 items-center gap-2 rounded-[4px] bg-[#2b2b2b] px-3 text-[15px] font-bold outline-none focused:bg-white focused:text-black"
        >
          {season?.name}
          <ChevronDownIcon className="size-4" />
        </FocusButton>
      ) : (
        <h2 className="text-[17px] font-bold">{season?.name}</h2>
      )}
      {picking && (
        <Picker
          label={t.title.chooseSeason}
          closeLabel={t.title.back}
          options={title.seasons.map((entry) => ({ id: entry.id, label: entry.name }))}
          selected={seasonId}
          onPick={(id) => {
            setPicking(false);
            if (id !== seasonId) {
              setEpisodes(null);
              setSeasonId(id);
            }
          }}
          onClose={() => setPicking(false)}
        />
      )}
      <ol className={wide ? "mt-4 grid gap-2" : "mt-1 grid"}>
        {episodes === null
          ? Array.from({ length: 3 }, (_, index) => (
              <li key={index} className="mt-[22px] flex items-center gap-3">
                <span className="aspect-video w-[130px] animate-pulse rounded-[3px] bg-white/10" />
              </li>
            ))
          : episodes.map((episode) => (
              <EpisodeRow
                key={episode.id}
                episode={episode}
                wide={wide}
                onPlay={() => onPlay(episode.id)}
              />
            ))}
      </ol>
    </div>
  );
}

function EpisodeRow({
  episode,
  wide,
  onPlay,
}: {
  episode: Episode;
  wide: boolean;
  onPlay: () => void;
}) {
  const name =
    episode.number != null ? t.title.episode(episode.number, episode.title) : episode.title;
  const duration =
    episode.runtimeMinutes &&
    t.home.duration(Math.floor(episode.runtimeMinutes / 60), episode.runtimeMinutes % 60);
  return (
    <li className={wide ? "border-b border-white/15 py-4" : "mt-[22px]"}>
      <FocusButton
        onPress={onPlay}
        className="group flex w-full items-center gap-3 rounded text-left outline-none focused:bg-white/10"
      >
        <span
          className={`relative flex-none overflow-hidden rounded-[3px] bg-neutral-800 ${wide ? "w-[180px]" : "w-[130px]"} aspect-video`}
        >
          {episode.stillUrl && (
            <img src={episode.stillUrl} alt="" loading="lazy" className="size-full object-cover" />
          )}
          <span className="absolute inset-0 grid place-items-center">
            <PlayCircleIcon className="size-[30px] rounded-full bg-black/35 text-white" />
          </span>
          {episode.progress !== undefined && (
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/30">
              <span
                className="block h-full bg-[#e50914]"
                style={{ width: `${Math.round(episode.progress * 100)}%` }}
              />
            </span>
          )}
        </span>
        <span className="grid gap-0.5">
          <span className="text-[15px] leading-5 font-bold">{name}</span>
          {duration && <span className="text-[13px] text-white/60">{duration}</span>}
        </span>
      </FocusButton>
      {episode.overview && (
        <p className="mt-2.5 text-[14px] leading-5 text-white/70">{episode.overview}</p>
      )}
    </li>
  );
}

function Similar({
  connection,
  userId,
  itemId,
  onOpen,
  onExpired,
}: {
  connection: Connection;
  userId: string;
  itemId: string;
  onOpen: (item: MediaItem) => void;
  onExpired: () => void;
}) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const expired = useEffectEvent(onExpired);

  useEffect(() => {
    let current = true;
    loadSimilar(connection, userId, itemId).then(
      (loaded) => {
        if (current) setItems(loaded);
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof SessionExpiredError) expired();
        else setItems([]);
      },
    );
    return () => {
      current = false;
    };
  }, [connection, userId, itemId]);

  if (items?.length === 0) {
    return <p className="mt-6 text-white/60">{t.title.noSimilar}</p>;
  }
  return (
    <ul className="mt-4 grid grid-cols-3 gap-1.5">
      {(items ?? Array.from({ length: 6 }, () => null)).map((item, index) => (
        <li key={item?.id ?? index}>
          {item ? (
            <PosterCard item={item} onOpen={() => onOpen(item)} />
          ) : (
            <span className="block aspect-[111/155] animate-pulse rounded-[4px] bg-white/10" />
          )}
        </li>
      ))}
    </ul>
  );
}
