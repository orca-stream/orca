import type { ReactNode } from "react";
import { Redirect, Route, Router, Switch } from "wouter";
import { AuthGate } from "./auth/AuthGate";
import { LoginScreen } from "./auth/LoginScreen";
import { DownloadsScreen } from "./dashboard/DownloadsScreen";
import { useLiveEvents } from "./events/use-live-events";
import { HomeScreen } from "./home/HomeScreen";
import { Providers } from "./providers";
import { Loading } from "./components/loading";
import { Button } from "./components/ui/button";
import { useT } from "./i18n/locale";
import { useSetupStatus } from "./settings/api";
import { SettingsScreen } from "./settings/SettingsScreen";
import { SetupScreen } from "./settings/SetupScreen";
import { AddSeriesScreen } from "./series/AddSeriesScreen";
import { SeriesDetailScreen } from "./series/SeriesDetailScreen";
import { SeriesListScreen } from "./series/SeriesListScreen";
import { Shell } from "./shell/Shell";

/** Mounted only for a signed-in admin, so the event stream never opens without a session. */
function LiveShell({ children }: { children: ReactNode }) {
  const live = useLiveEvents();
  return <Shell live={live}>{children}</Shell>;
}

function Panel() {
  return (
    <AuthGate>
      <LiveShell>
        <Switch>
          <Route path="/" component={HomeScreen} />
          <Route path="/downloads" component={DownloadsScreen} />
          <Route path="/settings" component={SettingsScreen} />
          {/* "new" before ":id", or the add screen would be read as a series called new. */}
          <Route path="/series/new" component={AddSeriesScreen} />
          <Route path="/series/:id" component={SeriesDetailScreen} />
          <Route path="/series" component={SeriesListScreen} />
          <Route>
            <Redirect to="/" replace />
          </Route>
        </Switch>
      </LiveShell>
    </AuthGate>
  );
}

/** Until the server is set up, every address shows the setup; afterwards, the panel. */
function SetupGate({ children }: { children: ReactNode }) {
  const t = useT();
  const status = useSetupStatus();
  if (status.isError) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <p role="alert">{t.errors.network}</p>
        <Button onClick={() => void status.refetch()}>{t.common.retry}</Button>
      </main>
    );
  }
  if (!status.isSuccess) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loading className="size-8" />
      </main>
    );
  }
  if (!status.data.configured) return <SetupScreen needsCode={status.data.needsCode} />;
  return children;
}

export default function App() {
  return (
    <Providers>
      <Router>
        <SetupGate>
          <Switch>
            <Route path="/login" component={LoginScreen} />
            <Route component={Panel} />
          </Switch>
        </SetupGate>
      </Router>
    </Providers>
  );
}
