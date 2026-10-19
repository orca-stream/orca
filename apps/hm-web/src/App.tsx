import { Redirect, Route, Router, Switch } from "wouter";
import { AuthGate } from "./auth/AuthGate";
import { LoginScreen } from "./auth/LoginScreen";
import { useT } from "./i18n/locale";
import { Providers } from "./providers";
import { Placeholder } from "./shell/Placeholder";
import { Shell } from "./shell/Shell";

function Panel() {
  const t = useT();
  return (
    <AuthGate>
      <Shell>
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
      </Shell>
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
