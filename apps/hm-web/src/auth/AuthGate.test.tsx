import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { jsonResponse, renderApp } from "../test/render";
import { AuthGate } from "./AuthGate";
import { dropSession } from "./session";

const ME = { userId: "u1", userName: "sam" };

describe("AuthGate", () => {
  it("shows the app to a signed-in admin", async () => {
    renderApp(
      <AuthGate>
        <p>panel</p>
      </AuthGate>,
      { handler: () => jsonResponse(ME) },
    );
    expect(await screen.findByText("panel")).toBeTruthy();
  });

  it("sends a visitor without a session to sign in, remembering where they were going", async () => {
    const { location } = renderApp(
      <AuthGate>
        <p>panel</p>
      </AuthGate>,
      { handler: () => jsonResponse({ error: "unauthorized" }, 401), path: "/series/abc" },
    );
    await waitFor(() => expect(location.history.at(-1)).toBe("/login?next=%2Fseries%2Fabc"));
    expect(screen.queryByText("panel")).toBeNull();
  });

  it("does not take the first check for a lost session (no onUnauthorized)", async () => {
    const { unauthorized, location } = renderApp(
      <AuthGate>
        <p>panel</p>
      </AuthGate>,
      { handler: () => jsonResponse({ error: "unauthorized" }, 401) },
    );
    await waitFor(() => expect(location.history.at(-1)).toBe("/login"));
    expect(unauthorized).toHaveLength(0);
  });

  it("sends them to sign in when a later call finds the session gone", async () => {
    const { queryClient, location } = renderApp(
      <AuthGate>
        <p>panel</p>
      </AuthGate>,
      { handler: () => jsonResponse(ME), path: "/jobs" },
    );
    await screen.findByText("panel");
    act(() => dropSession(queryClient));
    await waitFor(() => expect(location.history.at(-1)).toBe("/login?next=%2Fjobs"));
  });

  it("tells a broken server from a missing session", async () => {
    renderApp(
      <AuthGate>
        <p>panel</p>
      </AuthGate>,
      { handler: () => jsonResponse({ error: "boom" }, 500) },
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("panel")).toBeNull();
  });
});
