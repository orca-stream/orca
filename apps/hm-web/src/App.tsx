import type { ReactNode } from "react";
import { Redirect, Route, Router, Switch } from "wouter";
import { AuthGate } from "./auth/AuthGate";
import { LoginScreen } from "./auth/LoginScreen";
import { useLiveEvents } from "./events/use-live-events";
import { useT } from "./i18n/locale";
import { Providers } from "./providers";
import { Placeholder } from "./shell/Placeholder";
import { Shell } from "./shell/Shell";

/** Mounted only for a signed-in admin, so the event stream never opens without a session. */
function LiveShell({ children }: { children: ReactNode }) {
  const live = useLiveEvents();
  return <Shell live={live}>{children}</Shell>;
}

function Panel() {
  const t = useT();
  return (
    <AuthGate>
      <LiveShell>
        <Switch>
          <Route path="/">
            <Placeholder title={t.nav.dashboard} />
          </Route>
          <Route path="/series">
            <Placeholder title={t.nav.series} />
          </Route>
          <Route path="/settings">
            <Placeholder title={t.nav.settings} />
          </Route>
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
