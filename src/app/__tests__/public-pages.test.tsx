// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import HomePage from "@/app/page";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
import NotificationsPage from "@/app/notifications/page";
import BrowsePage from "@/app/browse/page";
import RegistrationsPage from "@/app/registrations/page";
import { ROLES } from "@/lib/roles";
import { can, type Action } from "@/lib/permissions";
import {
  mockApi,
  render,
  reply,
  router,
  screen,
  setRoute,
  signedInAs,
  signedOut,
  userEvent,
  waitFor,
} from "@/test/ui";

describe("Home page", () => {
  it("offers Log in and Register", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "ConnectSphere" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register");
  });
});

describe("Login page", () => {
  const ROUTE = "POST /api/auth/login";
  const success = { token: "session-token", user: { id: "u1", name: "Rachel", email: "r@example.com", role: "organiser" } };

  async function submit(email = "rachel@example.com", password = "long-enough-pw") {
    if (email) await userEvent.type(screen.getByLabelText(/Email/), email);
    if (password) await userEvent.type(screen.getByLabelText(/Password/), password);
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
  }

  it("signs in: stores the session and goes to the dashboard", async () => {
    setRoute("/login");
    const api = mockApi({ [ROUTE]: success });
    render(<LoginPage />);

    await submit();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard"));
    expect(api.sent(ROUTE)[0].body).toEqual({ email: "rachel@example.com", password: "long-enough-pw" });
    expect(localStorage.getItem("connectsphere_token")).toBe("session-token");
  });

  it("after an expired session, says so and returns the user to where they were", async () => {
    setRoute("/login?next=%2Fevents%2FEVT-000007");
    mockApi({ [ROUTE]: success });
    render(<LoginPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Your session expired.");
    await submit();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/events/EVT-000007"));
  });

  it("shows no session-expired notice on a plain visit", () => {
    setRoute("/login");
    mockApi();
    render(<LoginPage />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register");
  });

  it("shows wrong credentials as one form error, not against either field", async () => {
    setRoute("/login");
    mockApi({ [ROUTE]: reply(400, { error: "Invalid email or password" }) });
    render(<LoginPage />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.getByLabelText(/Email/)).toBeValid();
    expect(router.push).not.toHaveBeenCalled();
    expect(localStorage.getItem("connectsphere_token")).toBeNull();
  });

  it("puts the server's field errors under the fields they belong to", async () => {
    setRoute("/login");
    mockApi({
      [ROUTE]: reply(400, {
        error: "Validation failed",
        details: { fieldErrors: { email: ["Enter a valid email address"], password: ["Enter your password"] } },
      }),
    });
    render(<LoginPage />);

    await submit("not-an-email", "");

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toBeInvalid();
    expect(screen.getByLabelText(/Password/)).toHaveAccessibleDescription("Enter your password");
    // The field messages say it all; "Validation failed" is not shown above them.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells a deactivated user to contact an administrator", async () => {
    setRoute("/login");
    mockApi({ [ROUTE]: reply(403, { error: "This account has been deactivated. Contact your ConnectSphere administrator." }) });
    render(<LoginPage />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("This account has been deactivated.");
  });

  it("falls back to a general message when the server gives none", async () => {
    setRoute("/login");
    mockApi({ [ROUTE]: reply(500, {}) });
    render(<LoginPage />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not log in");
  });

  it("reports a network failure", async () => {
    setRoute("/login");
    mockApi({ [ROUTE]: () => Promise.reject(new Error("Failed to fetch")) });
    render(<LoginPage />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("clears the previous error when the form is submitted again", async () => {
    setRoute("/login");
    const api = mockApi({ [ROUTE]: reply(400, { error: "Invalid email or password" }) });
    render(<LoginPage />);
    await submit();
    await screen.findByRole("alert");

    api.on(ROUTE, success);
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the button while the request is in flight, so it cannot be sent twice", async () => {
    setRoute("/login");
    let finish: (value: unknown) => void = () => {};
    const api = mockApi({ [ROUTE]: () => new Promise((resolve) => (finish = resolve)) });
    render(<LoginPage />);

    await submit();

    expect(screen.getByRole("button", { name: "Logging in…" })).toBeDisabled();
    finish(success);
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(api.sent(ROUTE)).toHaveLength(1);
  });
});

describe("Register page", () => {
  const ROUTE = "POST /api/auth/register";

  async function fill(values: { name?: string; email?: string; password?: string } = {}) {
    const { name = "Rachel Ng", email = "rachel@example.com", password = "long-enough-pw" } = values;
    if (name) await userEvent.type(screen.getByLabelText(/Full name/), name);
    if (email) await userEvent.type(screen.getByLabelText(/Email/), email);
    if (password) await userEvent.type(screen.getByLabelText(/Password/), password);
  }
  const submit = () => userEvent.click(screen.getByRole("button", { name: "Create account" }));

  it("offers only the two roles a member of the public may register as", () => {
    mockApi();
    render(<RegisterPage />);

    const options = screen.getAllByRole("option").map((o) => o.textContent);

    expect(options).toEqual(["Event Organiser", "Attendee"]);
    expect(screen.getByLabelText(/Role/)).toHaveValue("organiser");
  });

  it("creates the account and sends the user to log in", async () => {
    const api = mockApi({ [ROUTE]: reply(201, { id: "u1" }) });
    render(<RegisterPage />);

    await fill();
    await userEvent.selectOptions(screen.getByLabelText(/Role/), "Attendee");
    await submit();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login"));
    expect(api.sent(ROUTE)[0].body).toEqual({
      name: "Rachel Ng",
      email: "rachel@example.com",
      password: "long-enough-pw",
      role: "attendee",
    });
  });

  it("says nothing about a field while it is being typed in", async () => {
    mockApi();
    render(<RegisterPage />);

    await userEvent.type(screen.getByLabelText(/Email/), "not-an-em");

    expect(screen.getByLabelText(/Email/)).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Enter a valid email address")).not.toBeInTheDocument();
  });

  it("checks a field when the user leaves it", async () => {
    mockApi();
    render(<RegisterPage />);

    await userEvent.type(screen.getByLabelText(/Email/), "not-an-email");
    await userEvent.tab();

    expect(screen.getByLabelText(/Email/)).toBeInvalid();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    // Only the field that was left - the untouched ones stay quiet.
    expect(screen.getByLabelText(/Full name/)).toBeValid();
  });

  it("clears a field's error as soon as the user starts fixing it", async () => {
    mockApi();
    render(<RegisterPage />);
    await userEvent.type(screen.getByLabelText(/Password/), "short");
    await userEvent.tab();
    expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Password/), "x");

    expect(screen.queryByText("Password must be at least 8 characters")).not.toBeInTheDocument();
  });

  it("leaves a valid field unmarked when the user leaves it", async () => {
    mockApi();
    render(<RegisterPage />);

    await userEvent.type(screen.getByLabelText(/Full name/), "Rachel Ng");
    await userEvent.tab();

    expect(screen.getByLabelText(/Full name/)).toBeValid();
  });

  it("on submit, marks every invalid field, focuses the first, and sends nothing", async () => {
    const api = mockApi();
    render(<RegisterPage />);

    await submit();

    expect(screen.getByLabelText(/Full name/)).toBeInvalid();
    expect(screen.getByLabelText(/Email/)).toBeInvalid();
    expect(screen.getByLabelText(/Password/)).toBeInvalid();
    expect(screen.getByLabelText(/Full name/)).toHaveFocus();
    expect(api.calls).toHaveLength(0);
  });

  it("shows an account that already exists as a form error", async () => {
    mockApi({ [ROUTE]: reply(400, { error: "A user with this email already exists" }) });
    render(<RegisterPage />);

    await fill();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("A user with this email already exists");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("maps the server's field errors back onto the fields", async () => {
    mockApi({
      [ROUTE]: reply(400, {
        error: "Validation failed",
        details: { fieldErrors: { email: ["Enter a valid email address"] } },
      }),
    });
    render(<RegisterPage />);

    await fill();
    await submit();

    await waitFor(() => expect(screen.getByLabelText(/Email/)).toBeInvalid());
    expect(screen.getByLabelText(/Email/)).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to a general message when the server gives none", async () => {
    mockApi({ [ROUTE]: reply(500, {}) });
    render(<RegisterPage />);

    await fill();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Registration failed");
  });

  it("explains a network failure in plain words", async () => {
    mockApi({ [ROUTE]: () => Promise.reject(new Error("Failed to fetch")) });
    render(<RegisterPage />);

    await fill();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the server. Check your connection and try again."
    );
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("links back to Log in", () => {
    mockApi();
    render(<RegisterPage />);

    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });
});

describe("screens that are specified but not built yet", () => {
  const placeholders: Array<{
    name: string;
    Page: () => React.ReactNode;
    path: string;
    action?: Action;
    screenId: string;
    reason?: string;
  }> = [
    { name: "Notifications", Page: NotificationsPage, path: "/notifications", screenId: "S-04 (Notification Centre)" },
    {
      name: "Browse Events",
      Page: BrowsePage,
      path: "/browse",
      action: "registration:create",
      screenId: "S-26 (Attendee Event Browsing)",
      reason: "Browsing and registering for events is what an Attendee account is for.",
    },
    // Equipment (S-24 Equipment Catalogue) was built by SPM-55 - see equipment-catalogue-page.test.tsx.
    {
      name: "My Registrations",
      Page: RegistrationsPage,
      path: "/registrations",
      action: "registration:create",
      screenId: "S-27 (My Registrations)",
      reason: "Registrations belong to an Attendee account.",
    },
  ];

  describe.each(placeholders)("$name", ({ name, Page, path, action, screenId, reason }) => {
    const allowed = ROLES.filter((role) => !action || can(role, action));
    const refused = ROLES.filter((role) => action && !can(role, action));

    it("sends an anonymous visitor to log in", async () => {
      setRoute(path);
      mockApi(signedOut());

      render(<Page />);

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(path)}`));
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });

    it.each(allowed)("tells %s the screen exists but is not built", async (role) => {
      setRoute(path);
      mockApi(signedInAs(role));

      render(<Page />);

      expect(await screen.findByRole("status")).toHaveTextContent("This screen is not built yet");
      expect(screen.getByRole("status")).toHaveTextContent(screenId);
      expect(screen.getByRole("heading", { level: 1, name })).toBeInTheDocument();
    });

    if (refused.length > 0) {
      it.each(refused)("refuses %s, with the reason", async (role) => {
        setRoute(path);
        mockApi(signedInAs(role));

        render(<Page />);

        expect(await screen.findByRole("alert")).toHaveTextContent(reason!);
        expect(screen.queryByText("This screen is not built yet")).not.toBeInTheDocument();
      });
    }
  });
});
