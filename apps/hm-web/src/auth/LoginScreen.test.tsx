import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { jsonResponse, renderApp, type Handler } from "../test/render";
import { LoginScreen } from "./LoginScreen";

const ME = { userId: "u1", userName: "sam" };

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Usuario"), "sam");
  await user.type(screen.getByLabelText("Contraseña"), "s3cret");
  await user.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("LoginScreen", () => {
  it("posts the credentials and goes to where the person was heading", async () => {
    const handler: Handler = (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/api/auth/login") return jsonResponse(ME);
      if (pathname === "/api/auth/me") return jsonResponse(ME);
      return jsonResponse({ error: "not_found" }, 404);
    };
    const user = userEvent.setup();
    const { requests, location } = renderApp(<LoginScreen />, {
      handler,
      path: "/login?next=%2Fseries%2Fabc",
    });

    await fillAndSubmit(user);

    await waitFor(() => expect(location.history.at(-1)).toBe("/series/abc"));
    const login = requests.find((r) => new URL(r.url).pathname === "/api/auth/login");
    expect(login?.method).toBe("POST");
    expect(await login?.json()).toEqual({ username: "sam", password: "s3cret" });
  });

  it("ignores a next that points outside the panel", async () => {
    const handler: Handler = () => jsonResponse(ME);
    const user = userEvent.setup();
    const { location } = renderApp(<LoginScreen />, {
      handler,
      path: "/login?next=%2F%2Fevil.test",
    });
    await fillAndSubmit(user);
    await waitFor(() => expect(location.history.at(-1)).toBe("/"));
  });

  it("says the credentials are wrong on a 401, without treating the session as lost", async () => {
    const user = userEvent.setup();
    const { unauthorized } = renderApp(<LoginScreen />, {
      handler: () => jsonResponse({ error: "invalid_credentials" }, 401),
    });
    await fillAndSubmit(user);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Usuario o contraseña incorrectos.",
    );
    expect(unauthorized).toHaveLength(0);
  });

  it("says only administrators may enter on a 403", async () => {
    const user = userEvent.setup();
    renderApp(<LoginScreen />, { handler: () => jsonResponse({ error: "forbidden" }, 403) });
    await fillAndSubmit(user);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Solo los administradores pueden entrar.",
    );
  });

  it("says the server is unreachable when nothing answers", async () => {
    const user = userEvent.setup();
    renderApp(<LoginScreen />, {
      handler: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await fillAndSubmit(user);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No se pudo contactar con el servidor. Inténtalo de nuevo.",
    );
  });

  it.each([502, 503])("says Jellyfin isn't answering on a %i", async (status) => {
    const user = userEvent.setup();
    renderApp(<LoginScreen />, { handler: () => jsonResponse({ error: "upstream" }, status) });
    await fillAndSubmit(user);
    expect((await screen.findByRole("alert")).textContent).toBe("Jellyfin no responde.");
  });

  it("does not send an empty form", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<LoginScreen />);
    const submit = screen.getByRole("button", { name: "Entrar" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.click(submit);
    expect(requests).toHaveLength(0);
  });

  it("speaks English when asked to", () => {
    renderApp(<LoginScreen />, { locale: "en" });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("tells how long to wait when the server throttles sign-ins (429 + Retry-After)", async () => {
    const user = userEvent.setup();
    renderApp(<LoginScreen />, {
      handler: () =>
        new Response(JSON.stringify({ error: "too_many_requests" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "90" },
        }),
    });
    await fillAndSubmit(user);
    expect((await screen.findByRole("alert")).textContent).toContain("2 min");
  });

  it("falls back to a generic wait message when a 429 gives no Retry-After", async () => {
    const user = userEvent.setup();
    renderApp(<LoginScreen />, { handler: () => jsonResponse({ error: "x" }, 429) });
    await fillAndSubmit(user);
    expect((await screen.findByRole("alert")).textContent).toContain("Demasiados intentos");
  });
});
