import type { ReactNode } from "react";
import { Redirect, Route, Router, Switch } from "wouter";
import { AuthGate } from "./auth/AuthGate";
import { LoginScreen } from "./auth/LoginScreen";
import { DashboardScreen } from "./dashboard/DashboardScreen";
import { useLiveEvents } from "./events/use-live-events";
import { ExtractorsScreen } from "./extractors/ExtractorsScreen";
import { Providers } from "./providers";
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
          <Route path="/" component={DashboardScreen} />
          {/* "new" before ":id", or the add screen would be read as a series called new. */}
          <Route path="/series/new" component={AddSeriesScreen} />
          <Route path="/series/:id" component={SeriesDetailScreen} />
          <Route path="/series" component={SeriesListScreen} />
          <Route path="/extractors" component={ExtractorsScreen} />
          <Route>
            <Redirect to="/" replace />
          </Route>
        </Switch>
      </LiveShell>
    </AuthGate>
  );
}

export default function App() {
  return (
    <Providers>
      <Router>
        <Switch>
          <Route path="/login" component={LoginScreen} />
          <Route component={Panel} />
        </Switch>
      </Router>
    </Providers>
  );
}
