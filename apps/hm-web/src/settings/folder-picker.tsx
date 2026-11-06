import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Folder01Icon,
  FolderAddIcon,
  FolderSearchIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n/locale";
import { BAR_POPUP } from "@/series/bar";
import { cn } from "@/lib/utils";
import { ApiError } from "@/api/client";
import { useFolders, useMakeFolder } from "./api";

/**
 * Picks a folder of the server's disk, the way Jellyfin picks a library's: the browser's own picker
 * gives no path, and would show the disk of the device looking, not the server's. Opens on the
 * folder typed in the row when there is one, else on the home folder of whoever runs H&M.
 */
export function FolderPicker({
  during,
  value,
  onPick,
}: {
  during: "setup" | "settings";
  value: string;
  onPick: (path: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const folders = useFolders(during, path, open);
  const listing = folders.data;
  const make = useMakeFolder(during);
  // The new folder's name while one is being made; null while not.
  const [newName, setNewName] = useState<string | null>(null);

  function go(next: string | null) {
    setPath(next);
    setNewName(null);
    make.reset();
  }

  function create() {
    const name = newName?.trim();
    if (!listing || !name || make.isPending) return;
    make.mutate(
      { parent: listing.path, name },
      // Into it at once: a folder just made is the one to pick, most of the time.
      { onSuccess: ({ path: made }) => go(made) },
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) go(value.startsWith("/") ? value.trim() : null);
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t.settings.folders.browse}
            title={t.settings.folders.browse}
            className="flex size-14 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none data-popup-open:bg-primary/10 data-popup-open:text-primary"
          />
        }
      >
        <HugeiconsIcon icon={FolderSearchIcon} className="size-5" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn(BAR_POPUP, "w-[min(28rem,calc(100vw-2rem))] gap-0 p-0")}
      >
        <PopoverTitle className="sr-only">{t.settings.folders.title}</PopoverTitle>
        {/* Where it is, and the way up. */}
        <div className="flex items-center gap-2 border-b border-(--glass-edge) p-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.settings.folders.up}
            title={t.settings.folders.up}
            disabled={!listing?.parent}
            onClick={() => listing?.parent && go(listing.parent)}
          >
            <HugeiconsIcon icon={ArrowUp01Icon} />
          </Button>
          <p
            className="min-w-0 flex-1 truncate text-left text-sm font-medium [direction:rtl]"
            title={listing?.path}
          >
            {/* An isolate keeps the path's slashes where they are while its start is the one cut. */}
            <bdi>{listing?.path ?? path ?? "…"}</bdi>
          </p>
          {folders.isFetching && <Spinner className="mr-2 size-4" />}
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {folders.isError ? (
            <div role="alert" className="flex flex-col items-start gap-2 p-3 text-sm">
              <p className="flex items-center gap-2 text-destructive">
                <HugeiconsIcon icon={Alert02Icon} className="size-4" />
                {t.settings.folders.failed}
              </p>
              {path !== null && (
                <Button variant="outline" size="sm" onClick={() => go(null)}>
                  {t.settings.folders.retry}
                </Button>
              )}
            </div>
          ) : listing && listing.folders.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t.settings.folders.empty}</p>
          ) : (
            <ul>
              {listing?.folders.map((folder) => (
                <li key={folder.path}>
                  <button
                    type="button"
                    aria-label={t.settings.folders.open(folder.name)}
                    onClick={() => go(folder.path)}
                    className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-white/60 focus-visible:bg-white/60 focus-visible:outline-none"
                  >
                    <HugeiconsIcon
                      icon={Folder01Icon}
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {newName !== null ? (
          // Not a form: the popup is drawn outside, but React would still submit the panel's own.
          <div className="flex flex-col gap-2 border-t border-(--glass-edge) p-2">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                aria-label={t.settings.folders.newName}
                placeholder={t.settings.folders.newName}
                value={newName}
                maxLength={255}
                aria-invalid={make.isError || undefined}
                onChange={(event) => {
                  setNewName(event.target.value);
                  if (make.isError) make.reset();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    create();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    go(path);
                  }
                }}
                className="h-10 min-w-0 flex-1 rounded-full bg-white/60 px-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:ring-3 aria-invalid:ring-destructive/30"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.common.cancel}
                title={t.common.cancel}
                onClick={() => go(path)}
              >
                <HugeiconsIcon icon={Cancel01Icon} />
              </Button>
              <Button
                disabled={newName.trim() === "" || make.isPending}
                aria-busy={make.isPending || undefined}
                onClick={create}
              >
                {make.isPending ? <Spinner className="size-4" /> : t.settings.folders.create}
              </Button>
            </div>
            {make.isError && (
              <p role="alert" className="px-2 text-sm text-destructive">
                {make.error instanceof ApiError && make.error.status === 409
                  ? t.settings.folders.exists
                  : t.settings.folders.createFailed}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 border-t border-(--glass-edge) p-2">
            <Button
              variant="ghost"
              disabled={!listing || folders.isError}
              onClick={() => setNewName("")}
            >
              <HugeiconsIcon icon={FolderAddIcon} data-icon="inline-start" />
              {t.settings.folders.newFolder}
            </Button>
            <Button
              disabled={!listing || folders.isError}
              onClick={() => {
                if (!listing) return;
                onPick(listing.path);
                setOpen(false);
              }}
            >
              {t.settings.folders.choose}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
