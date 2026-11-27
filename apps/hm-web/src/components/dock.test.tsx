import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { Link, Route, Switch } from "wouter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { jsonResponse, renderApp } from "@/test/render";
import { Dock, DockButton, DockHost, DockPlaces } from "./dock";

function Here({ extra }: { extra?: string }) {
  return (
    <>
      <Link href={extra ? "/" : "/other"}>go</Link>
      <Dock label="Atajos">
        <DockPlaces />
        {extra && <DockButton label={extra} icon={[]} onClick={() => {}} />}
      </Dock>
    </>
  );
}

// Two screens of their own, as the panel's are: React draws each anew.
function Home() {
  return <Here />;
}
function Other() {
  return <Here extra="Revisar" />;
}

describe("DockHost", () => {
  it("keeps one bar from screen to screen, and only its actions change", async () => {
    const user = userEvent.setup();
    renderApp(
      <TooltipProvider>
        <DockHost>
          <Switch>
            <Route path="/other">
              <Other />
            </Route>
            <Route>
              <Home />
            </Route>
          </Switch>
        </DockHost>
      </TooltipProvider>,
      { handler: () => jsonResponse([]) },
    );
    const bar = screen.getByRole("navigation", { name: "Atajos" });
    expect(within(bar).queryByRole("button", { name: "Revisar" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "go" }));
    expect(screen.getByRole("navigation", { name: "Atajos" })).toBe(bar);
    expect(within(bar).getByRole("button", { name: "Revisar" })).toBeTruthy();
    expect(screen.getAllByRole("navigation", { name: "Atajos" })).toHaveLength(1);
  });
});
