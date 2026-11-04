# Orca'H&M — the admin panel

**English** · [Español](es/hm-web.md) · [All guides](../../README.md)

The panel (`apps/hm-web`) is the web interface of the [Orca'H&M server](hm-server.md). Home is a grid of
cards: your series first, then one card per available extractor (with a shortcut to try its example).
From there: the list of series, adding a series from an address (with a preview of what will be
downloaded, the season, the first episode number, TMDB/IMDb ids and track choices), each series' sources
and episodes, the downloads (a list over the dock: queue, errors and the last finished; hovering a card's download badge shows what it is fetching) and notifications (live, over
server-sent events).

The list of series looks like home, with no top bar or title: a card to add one more, then a card per
series whose whole background is its cover (TMDB's, by its id, when the server has none), darkened
towards the bottom under its name, year and how many episodes are here (`24/24`). On a series' own screen, the **+** button by its addresses opens
adding a series with that one already chosen as "Add to" (`/series/new?into=<id>`): another season,
or the part a site is missing. With two or more addresses they fold under a header that counts them
(and how many are closed); its arrow unfolds them all, in a list that scrolls on its own past four and a half rows. Each address says which season and which episodes it brought (`Season 1, episodes 25 to 37`), and the numbers it skips in between (`Season 3, episodes 1 to 25, without E23` — often TMDB's own numbering, where a double episode takes two numbers), and has a padlock that closes or
reopens it: a closed source (a finished season) is no longer read when the series looks for new
episodes. When TMDB says the show has ended or was canceled, a source still open is marked
`Open` in amber, its padlock stands out and the header says `1 open, but the show has ended`: it
will bring nothing new, so close it. Its card in the series list shows the open-sources pill in
amber, with a warning in place of the site's globe.

When adding, leave "Add to" empty to make a new series, or pick one you have to add the address to it.
For a new series, typing its TMDB id fills in the title, the year and the IMDb id: the server asks
Jellyfin's own TMDB provider (no TMDB key of ours), in the server's preferred metadata language. It
replaces what the site suggested and fills any empty field, but never overwrites what you typed. The title is what Jellyfin and
Orca'JP will show, since the series' `tvshow.nfo` names it. On disk, characters a file name can't
hold are dropped or replaced: `Mashle: Magic and Muscles` lives in `Mashle - Magic and Muscles (2023)/`.

The last row of the bar is the numbering: the season the episodes go to and the number the address's
first episode gets there (empty keeps the site's own numbers; adding to a series that already has
that season, it starts right after the last episode there, e.g. 25 after 24; and when the series
already has that season whole — episodes found by an earlier source, downloaded or not — the season
moves on its own to the next one it lacks, as TMDB lists them), with where they will land at its end
(`S02E13–E24`). When the show has a TMDB id (typed for a new series, or the one the chosen series has)
and the server has a TMDB key (Settings › TMDB), both are lists to pick from: TMDB's seasons, then the episodes of
the season picked, in the panel's language. Left alone, they show what the site's numbering
amounts to (its season, when the address has only one, and its first episode). Without a key, or while TMDB has nothing for it, you type
the numbers.

One offset can't place everything: a site may count an extra TMDB doesn't (a recap, an episode 0)
or number one episode where TMDB has another. The code on each episode's frame (`S04E01 · S01E01`:
where it lands, then where the site has it) opens its numbering: **the next in order** (the
default), **a special** (it goes to season 0 with the number you pick and takes no number of its
own, so the ones after it move up one) or **another number** (the ones after it carry on from it).
What a later search finds on that address is numbered the same way. A site's episode 0 starts as a
special, left out, so its episode 1 stays 1. Among the specials only what lands there is compared
with TMDB.

Once TMDB has named the show, it fills the screen's background behind the glass: its backdrop,
blurred (with a TMDB key), or else its poster, blurred further.

Below the numbering, two switches: follow the series (look for new episodes on the site; only for a new
series or a Jellyfin show, since an existing series keeps its own setting) and download now (off by default:
the episodes are added but not downloaded yet). The bar ends with what will be added and the **Add series**
button.

Once an address is read, the screen splits in two: the bar on the left and, on the right, a grid with a
card per episode. Each card has a frame (TMDB's, for where the episode lands, when there is a key; a
placeholder otherwise) and, over it, the code it will get (and the site's, when the numbering moves it),
the server it comes from (a host, or "Mirrors" when the episode page lists several players and one is
picked when it downloads), what happens to it ("Will download", "Not downloaded", "Left out", or
"Already there" when the chosen series has that code, which blocks adding) and the site's warnings
(inferred, gap…). Below it, TMDB's name, air date, length and synopsis. The round button in its corner,
or the whole card, includes or leaves out the episode; "All" in the grid's header does every one.

A new series with the TMDB or IMDb id of one you already have is refused, and the panel says so as you
type the id, with a button to add the address to that one instead.

"Add to" also lists the shows your Jellyfin already has and H&M doesn't (marked "In Jellyfin"), as long
as their folder is under H&M's media folder. Adding to one makes it an H&M series with the show's
title, year and ids, and **renames its episode files to H&M's names** (`Season 01/Show S01E01.ext`),
together with the files named after each one (subtitles, `.nfo`, thumbnails, trickplay). A file holding
several episodes, or whose new name is taken, keeps its name; the show's `tvshow.nfo` and images are left
alone. The episodes of the address that are already on disk aren't downloaded again. Jellyfin may see
a renamed file as a new item: check that what was watched is still marked as such.

A series' own screen is laid out the same way, across the whole window and with no top bar (the
arrow on its card goes back to the list). On the left, one panel: its card (poster, year, seasons, synopsis, TMDB
and IMDb ids, and how many episodes are here) and, below it in the same panel, its settings: its addresses and
how each numbers its episodes (as the site does, or into a season and shifted), when the site was last
and will next be searched for new episodes, with **Search now**, following and the hours between
searches, its title and year, the TMDB and IMDb ids, the maximum video height, and the audio and subtitle languages picked
from a list (none picked keeps every track; subtitles can also be **No subtitles**; the first audio
language picked is the original). Changes save themselves as they are made; only a
failure shows, with **Retry**. A new title, year or id makes Jellyfin reread the series about a
minute later; the folder keeps its name and episodes are still matched by the ids, so a wrong title only
changes the name shown until you fix it. A followed series also finds the seasons its site adds: each search
asks the site which seasons the show has (sites that read a show through its API) and adds each one after
the last its sources read as a source of its own — whichever order the site uploads them in, and with a
TMDB key only seasons TMDB has — queues its episodes and closes the source before. Only where the site
numbers seasons as the series does. On the right, one panel holds the header, the episodes as a grid of frames one season at a time (a
button per season when there is more than one): each says whether it is available, queued, downloading
(with its progress), missing or failed (with **Retry**). **Download the missing ones** queues every
missing or failed episode. Picking episodes (the round button or the whole card) brings up, at the
panel's foot, a bar with
**Select all** (or the season), **Clear selection** and **Download (n)**. With a TMDB
id, TMDB's backdrop fills the background and its frames and names fill the cards. An episode TMDB lists
for a season the series has and no source brings shows as a faded card with a dashed rim in its place
(**In no source** when it has aired, **Not aired** when not), and the header shows an amber **n missing**
that lists them by season on hover; a season's row there shows that season. Whole seasons TMDB has as
aired and no source brings are listed there too, and counted in it; the season picker lists them as
well (their count in amber, against TMDB's episodes), and picking one shows all its episodes as gaps.

It has no backend of its own: it always talks to an H&M server on the **same origin**, under `/api`.
Sign in with a **Jellyfin administrator** account of the Jellyfin that server uses.

## In development

The Vite dev server proxies `/api` to the H&M server, so the browser sees one origin and the session
cookie works.

It proxies to the `HOST` and `PORT` of `apps/hm-server/.env` (what `pnpm setup:hm` writes). Only for a
server that runs elsewhere, copy `apps/hm-web/.env.example` to `apps/hm-web/.env`:

| Variable        | Meaning                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| `HM_SERVER_URL` | Where that H&M server listens, e.g. `http://<host>:8787`; it wins over `apps/hm-server/.env` |

While the server is not set up, the panel shows its **setup** at every address; once it is, the server's
settings are in **Settings** (see [the server guide](hm-server.md#first-run)).

```bash
pnpm dev:hm                               # server + panel together
pnpm --filter @orca/hm-web dev            # the panel alone, against a server already running
```

Open the address Vite prints (`http://localhost:5173`, or the next free port when Orca'JP's dev server
already took it).

## In production

Build it and let the H&M server serve it:

```bash
pnpm --filter @orca/hm-web build          # output: apps/hm-web/dist/
```

Set `WEB_ROOT` to the absolute path of `apps/hm-web/dist` in `apps/hm-server/.env`. The Docker image already
includes the built panel; open `http://<server>:<port>/`.

Behind HTTPS, set `SECURE_COOKIES=true` on the server.

## Tests

```bash
pnpm --filter @orca/hm-web test
```
