// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import HomePage from "@/app/page";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
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
  it("[SPM-21] offers Log in and Register", () => {
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

  it("[SPM-21][AC1] signs in: stores the session and goes to the dashboard", async () => {
    setRoute("/login");
    const api = mockApi({ [ROUTE]: success });
    render(<LoginPage />);

    await submit();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard"));
    expect(api.sent(ROUTE)[0].body).toEqual({ email: "rachel@example.com", password: "long-enough-pw" });
    expect(localStorage.getItem("connectsphere_token")).toBe("session-token");
  });

  it("[SPM-21][AC1] after an expired session, says so and returns the user to where they were", async () => {
    setRoute("/login?next=%2Fevents%2FEVT-000007");
    mockApi({ [ROUTE]: success });
    render(<LoginPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Your session expired.");
    await submit();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/events/EVT-000007"));
  });

  it("[SPM-21] shows no session-expired notice on a plain visit", () => {
    setRoute("/login");
    mockApi();
    render(<LoginPage />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register");
  });

  it("[SPM-21][AC2] shows wrong credentials as one form error, not against either field", async () => {
    setRoute("/login");
    mockApi({ [ROUTE]: reply(400, { error: "Invalid email or password" }) });
    render(<LoginPage />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.getByLabelText(/Email/)).toBeValid();
    expect(router.push).not.toHaveBeenCalled();
    expect(localStorage.getItem("connectsphere_token")).toBeNull();
  });

  it("[SPM-21][AC2] puts the server's field errors under the fields they belong to", async () => {
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

  it("[SPM-21][AC2] tells a deactivated user to contact an administrator", async () => {
    setRoute("/login");
    mockApi({ [ROUTE]: reply(403, { error: "This account has been deactivated. Contact your ConnectSphere administrator." }) });
    render(<LoginPage />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("This account has been deactivated.");
  });

  it("[SPM-21][AC2] falls back to a general message when the server gives none", async () => {
    setRoute("/login");
    mockApi({ [ROUTE]: reply(500, {}) });
    render(<LoginPage />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not log in");
  });

  it("[SPM-21][AC2] shows a general error when the request fails without a reason", async () => {
    setRoute("/login");
    mockApi({ [ROUTE]: () => Promise.reject("offline") });
    render(<LoginPage />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("[SPM-21][AC2] reports a network failure", async () => {
    setRoute("/login");
    mockApi({ [ROUTE]: () => Promise.reject(new Error("Failed to fetch")) });
    render(<LoginPage />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("[SPM-21][AC2] clears the previous error when the form is submitted again", async () => {
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

  it("[SPM-21] disables the button while the request is in flight, so it cannot be sent twice", async () => {
    setRoute("/login");
    let finish: (value: unknown) => void = () => {};
    const api = mockApi({ [ROUTE]: () => new Promise((resolve) => (finish = resolve)) });
    render(<LoginPage />);

    await submit();

    expect(screen.getByRole("button", { name: "Logging in…" })).toBeDisabled();
    finish(success);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard"));
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

  it("[SPM-21] offers only the two roles a member of the public may register as", () => {
    mockApi();
    render(<RegisterPage />);

    const options = screen.getAllByRole("option").map((o) => o.textContent);

    expect(options).toEqual(["Event Organiser", "Attendee"]);
    expect(screen.getByLabelText(/Role/)).toHaveValue("organiser");
  });

  it("[SPM-21] creates the account and sends the user to log in", async () => {
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

  it("[SPM-21] says nothing about a field while it is being typed in", async () => {
    mockApi();
    render(<RegisterPage />);

    await userEvent.type(screen.getByLabelText(/Email/), "not-an-em");

    expect(screen.getByLabelText(/Email/)).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Enter a valid email address")).not.toBeInTheDocument();
  });

  it("[SPM-21] checks a field when the user leaves it", async () => {
    mockApi();
    render(<RegisterPage />);

    await userEvent.type(screen.getByLabelText(/Email/), "not-an-email");
    await userEvent.tab();

    expect(screen.getByLabelText(/Email/)).toBeInvalid();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    // Only the field that was left - the untouched ones stay quiet.
    expect(screen.getByLabelText(/Full name/)).toBeValid();
  });

  it("[SPM-21] clears a field's error as soon as the user starts fixing it", async () => {
    mockApi();
    render(<RegisterPage />);
    await userEvent.type(screen.getByLabelText(/Password/), "short");
    await userEvent.tab();
    expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Password/), "x");

    expect(screen.queryByText("Password must be at least 8 characters")).not.toBeInTheDocument();
  });

  it("[SPM-21] leaves a valid field unmarked when the user leaves it", async () => {
    mockApi();
    render(<RegisterPage />);

    await userEvent.type(screen.getByLabelText(/Full name/), "Rachel Ng");
    await userEvent.tab();

    expect(screen.getByLabelText(/Full name/)).toBeValid();
  });

  it("[SPM-21] on submit, marks every invalid field, focuses the first, and sends nothing", async () => {
    const api = mockApi();
    render(<RegisterPage />);

    await submit();

    expect(screen.getByLabelText(/Full name/)).toBeInvalid();
    expect(screen.getByLabelText(/Email/)).toBeInvalid();
    expect(screen.getByLabelText(/Password/)).toBeInvalid();
    expect(screen.getByLabelText(/Full name/)).toHaveFocus();
    expect(api.calls).toHaveLength(0);
  });

  it("[SPM-21] shows an account that already exists as a form error", async () => {
    mockApi({ [ROUTE]: reply(400, { error: "A user with this email already exists" }) });
    render(<RegisterPage />);

    await fill();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("A user with this email already exists");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("[SPM-21] maps the server's field errors back onto the fields", async () => {
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

  it("[SPM-21] falls back to a general message when the server gives none", async () => {
    mockApi({ [ROUTE]: reply(500, {}) });
    render(<RegisterPage />);

    await fill();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Registration failed");
  });

  it("[SPM-21] explains a network failure in plain words", async () => {
    mockApi({ [ROUTE]: () => Promise.reject(new Error("Failed to fetch")) });
    render(<RegisterPage />);

    await fill();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the server. Check your connection and try again."
    );
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("[SPM-21] links back to Log in", () => {
    mockApi();
    render(<RegisterPage />);

    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });
});

// "Screens that are specified but not built yet" lived here: one placeholder
// test per unbuilt sidebar screen. The last of them, Notifications (S-04), was
// built in SPM-71 (src/app/__tests__/notifications-page.test.tsx), after Browse
// Events and My Registrations (SPM-51) and Equipment (SPM-55). The placeholder
// itself, NotBuiltYet, keeps its own test in src/components/__tests__/shell.test.tsx.
