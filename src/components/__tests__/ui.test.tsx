// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { act, render, screen, userEvent, within } from "@/test/ui";
import {
  Alert,
  Breadcrumb,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  CheckboxGroup,
  ConfirmDialog,
  DataState,
  DetailList,
  EmptyState,
  Field,
  Fieldset,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SkeletonRows,
  Spinner,
  StatusBadge,
  Table,
  Tabs,
  Textarea,
  type Column,
} from "@/components/ui";
import { cn } from "@/lib/cn";

describe("cn", () => {
  it("[SPM-7][AC3] joins class names and drops the falsy ones", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });
});

describe("Button", () => {
  it("[SPM-7][AC3] renders its label and calls onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save draft</Button>);

    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("[SPM-7][AC3] while loading, shows the pending label and cannot be clicked", async () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingText="Saving…" onClick={onClick}>
        Save draft
      </Button>
    );
    const button = screen.getByRole("button", { name: "Saving…" });

    await userEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("[SPM-7][AC3] falls back to 'Working…' when no pending label is given", () => {
    render(<Button loading>Save</Button>);

    expect(screen.getByRole("button", { name: "Working…" })).toBeInTheDocument();
  });

  it("[SPM-7][AC3] is not marked busy when idle", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");
  });

  it("[SPM-7][AC3] can be disabled without loading", () => {
    render(<Button disabled>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("ButtonLink", () => {
  it("[SPM-7][AC3] is a real link, so it can be opened in a new tab", () => {
    render(<ButtonLink href="/events/new">New event request</ButtonLink>);

    expect(screen.getByRole("link", { name: "New event request" })).toHaveAttribute("href", "/events/new");
  });
});

describe("Alert", () => {
  it.each(["error", "warning"] as const)("[SPM-7][AC3] announces a %s assertively", (variant) => {
    render(<Alert variant={variant}>Something needs attention</Alert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Something needs attention");
  });

  it.each(["info", "success"] as const)("[SPM-7][AC3] announces %s politely", (variant) => {
    render(<Alert variant={variant}>Saved</Alert>);

    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[SPM-7][AC3] is informational by default", () => {
    render(<Alert title="Heads up" />);

    expect(screen.getByRole("status")).toHaveTextContent("Heads up");
  });

  it("[SPM-7][AC3] shows its title, body and action together", () => {
    render(
      <Alert variant="error" title="Could not save" action={<button>Retry</button>}>
        The server did not respond.
      </Alert>
    );
    const alert = screen.getByRole("alert");

    expect(within(alert).getByText("Could not save")).toBeInTheDocument();
    expect(within(alert).getByText("The server did not respond.")).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it.each([
    ["under_review", "Under review"],
    ["confirmed", "Confirmed"],
    ["partially_fulfilled", "Partially fulfilled"],
  ])("[SPM-7][AC3] shows %s as a readable label", (status, label) => {
    render(<StatusBadge status={status} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("[SPM-7][AC3] still labels a status it has never heard of", () => {
    render(<StatusBadge status="awaiting_sign_off" />);

    expect(screen.getByText("Awaiting sign off")).toBeInTheDocument();
  });
});

describe("Tabs", () => {
  const items = [
    { key: "overview", label: "Overview", href: "/events/EVT-000007" },
    { key: "venue", label: "Venue", href: "/events/EVT-000007/venue", badge: 2 },
    { key: "equipment", label: "Equipment", href: "/events/EVT-000007/equipment", badge: 0 },
  ];

  it("[SPM-7][AC2] renders each tab as a link, marking only the active one as the current page", () => {
    render(<Tabs items={items} activeKey="venue" />);

    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/events/EVT-000007");
    expect(screen.getByRole("link", { name: /Venue/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("[SPM-7][AC2] shows a badge only when its count is above zero", () => {
    render(<Tabs items={items} activeKey="overview" />);

    expect(screen.getByRole("link", { name: /Venue/ })).toHaveTextContent("Venue2");
    expect(screen.getByRole("link", { name: "Equipment" })).toHaveTextContent(/^Equipment$/);
  });
});

describe("Card", () => {
  it("[SPM-7][AC3] lays out a header, body and footer", () => {
    render(
      <Card>
        <CardHeader title="Schedule" subtitle="Singapore time" aside={<span>3 sessions</span>} />
        <CardBody>Body text</CardBody>
        <CardFooter>Footer text</CardFooter>
      </Card>
    );

    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByText("Singapore time")).toBeInTheDocument();
    expect(screen.getByText("3 sessions")).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getByText("Footer text")).toBeInTheDocument();
  });

  it("[SPM-7][AC3] leaves out the subtitle and aside when they are not given", () => {
    const { container } = render(<CardHeader title="Schedule" />);

    expect(container.querySelector("p")).toBeNull();
  });
});

describe("DetailList", () => {
  it("[SPM-7][AC3] pairs each label with its value", () => {
    render(
      <DetailList
        columns={1}
        items={[
          { label: "Category", value: "Conference" },
          { label: "Attendance", value: 200 },
        ]}
      />
    );
    const terms = screen.getAllByRole("term").map((t) => t.textContent);
    const values = screen.getAllByRole("definition").map((d) => d.textContent);

    expect(terms).toEqual(["Category", "Attendance"]);
    expect(values).toEqual(["Conference", "200"]);
  });

  it("[SPM-7][AC3] shows rows that share a label without a duplicate-key warning", () => {
    // The Overview's Venue bookings card: two rooms booked for the whole event
    // (SPM-81) are both labelled "Whole event".
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <DetailList
        columns={1}
        items={[
          { label: "Whole event", value: "SPM67 Hall (SPM67-HAL)" },
          { label: "Whole event", value: "SPM67 Studio (SPM67-STU)" },
        ]}
      />
    );

    expect(screen.getAllByRole("definition").map((d) => d.textContent)).toEqual([
      "SPM67 Hall (SPM67-HAL)",
      "SPM67 Studio (SPM67-STU)",
    ]);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("Breadcrumb and PageHeader", () => {
  const crumbs = [{ label: "Events", href: "/events" }, { label: "EVT-000007", href: "/events/EVT-000007" }, { label: "Edit" }];

  it("[SPM-7][AC2] links every crumb except the last, which is the current page", () => {
    render(<Breadcrumb items={crumbs} />);

    expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute("href", "/events");
    expect(screen.getByRole("link", { name: "EVT-000007" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByText("Edit")).toHaveAttribute("aria-current", "page");
  });

  it("[SPM-7][AC2] does not link the last crumb even if it has an href", () => {
    render(<Breadcrumb items={[{ label: "Events", href: "/events" }]} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("[SPM-7][AC2] renders nothing for an empty trail", () => {
    const { container } = render(<Breadcrumb items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("[SPM-7][AC2] shows the title, subtitle, breadcrumbs, meta and actions of a page", () => {
    render(
      <PageHeader
        title="Gala Dinner"
        subtitle="Annual client event"
        breadcrumbs={crumbs}
        meta={<StatusBadge status="planning" />}
        actions={<Button>Edit</Button>}
      />
    );

    expect(screen.getByRole("heading", { level: 1, name: "Gala Dinner" })).toBeInTheDocument();
    expect(screen.getByText("Annual client event")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("[SPM-7][AC2] works with a title alone", () => {
    render(<PageHeader title="Dashboard" />);

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("Field and its controls", () => {
  it("[SPM-7][AC4] binds the label to the control", () => {
    render(
      <Field label="Event title">
        <Input defaultValue="Gala" />
      </Field>
    );

    expect(screen.getByLabelText("Event title")).toHaveValue("Gala");
  });

  it("[SPM-7][AC4] marks a required field for sighted users and screen readers", () => {
    render(
      <Field label="Event title" required>
        <Input />
      </Field>
    );

    // The asterisk is decoration (aria-hidden); the words are what is announced.
    expect(screen.getByRole("textbox", { name: /^Event title\s*\(required\)$/ })).toBeInTheDocument();
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });

  it("[SPM-7][AC4] describes the control by its hint", () => {
    render(
      <Field label="Capacity" hint="The most the room can hold">
        <Input />
      </Field>
    );
    const input = screen.getByLabelText("Capacity");

    expect(input).toHaveAccessibleDescription("The most the room can hold");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("[SPM-7][AC4][AC5] in error, marks the control invalid and shows the error instead of the hint", () => {
    render(
      <Field label="Capacity" hint="The most the room can hold" error="Enter a number above zero">
        <Input />
      </Field>
    );
    const input = screen.getByLabelText("Capacity");

    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription("Enter a number above zero");
    expect(screen.queryByText("The most the room can hold")).not.toBeInTheDocument();
  });

  it("[SPM-7][AC4] wires a textarea and a select the same way", () => {
    render(
      <>
        <Field label="Notes" error="Too long">
          <Textarea defaultValue="Hello" />
        </Field>
        <Field label="Layout" error="Choose one">
          <Select options={[{ value: "theatre", label: "Theatre" }]} defaultValue="theatre" />
        </Field>
      </>
    );

    expect(screen.getByLabelText("Notes")).toBeInvalid();
    expect(screen.getByLabelText("Notes")).toHaveAttribute("rows", "3");
    expect(screen.getByLabelText("Layout")).toBeInvalid();
    expect(screen.getByLabelText("Layout")).toHaveValue("theatre");
  });

  it("[SPM-7][AC4] renders a control outside a Field without the wiring", () => {
    render(<Input aria-label="Search" />);

    expect(screen.getByLabelText("Search")).not.toHaveAttribute("id");
    expect(screen.getByLabelText("Search")).toBeValid();
  });

  it("[SPM-7][AC4] shows a select's placeholder as a disabled first option", () => {
    render(
      <Select
        aria-label="Layout"
        placeholder="Choose a layout"
        defaultValue=""
        options={[
          { value: "theatre", label: "Theatre" },
          { value: "banquet", label: "Banquet" },
        ]}
      />
    );
    const options = screen.getAllByRole("option") as HTMLOptionElement[];

    expect(options.map((o) => o.textContent)).toEqual(["Choose a layout", "Theatre", "Banquet"]);
    expect(options[0]).toBeDisabled();
  });

  it("[SPM-7][AC4] omits the placeholder option when none is given", () => {
    render(<Select aria-label="Layout" options={[{ value: "theatre", label: "Theatre" }]} />);

    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});

describe("Checkbox", () => {
  it("[SPM-7][AC4] carries its own label and hint, and reports changes", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Enable registration" hint="Attendees can sign up" onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Enable registration" });

    await userEvent.click(box);

    expect(box).toHaveAccessibleDescription("Attendees can sign up");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("[SPM-7][AC4] has no description without a hint", () => {
    render(<Checkbox label="Enable registration" />);

    expect(screen.getByRole("checkbox")).not.toHaveAttribute("aria-describedby");
  });
});

describe("Fieldset", () => {
  it("[SPM-7][AC4] groups its fields under a legend and description", () => {
    render(
      <Fieldset legend="Schedule" description="When the event runs">
        <span>fields</span>
      </Fieldset>
    );

    expect(screen.getByRole("group", { name: "Schedule" })).toHaveTextContent("When the event runs");
  });

  it("[SPM-7][AC4] works without a description", () => {
    render(
      <Fieldset legend="Schedule">
        <span>fields</span>
      </Fieldset>
    );

    expect(screen.getByRole("group", { name: "Schedule" })).toHaveTextContent("fields");
  });
});

describe("CheckboxGroup", () => {
  const options = [
    { id: "f1", name: "Hearing loop" },
    { id: "f2", name: "Step-free access" },
  ];

  it("[SPM-7][AC4] ticks the selected options and reports which one was toggled", async () => {
    const onToggle = vi.fn();
    render(
      <CheckboxGroup legend="Accessibility" hint="Tick all that apply" options={options} selected={["f2"]} onToggle={onToggle} />
    );
    const group = screen.getByRole("group", { name: "Accessibility" });

    await userEvent.click(within(group).getByRole("checkbox", { name: "Hearing loop" }));

    expect(within(group).getByRole("checkbox", { name: "Step-free access" })).toBeChecked();
    expect(within(group).getByRole("checkbox", { name: "Hearing loop" })).not.toBeChecked();
    expect(screen.getByText("Tick all that apply")).toBeInTheDocument();
    expect(onToggle).toHaveBeenCalledWith("f1");
  });

  it("[SPM-7][AC4] shows placeholders, not an empty group, while its options load", () => {
    render(<CheckboxGroup legend="Accessibility" options={[]} selected={[]} onToggle={vi.fn()} loading />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("None available.")).not.toBeInTheDocument();
  });

  it("[SPM-7][AC4] says so when there are no options", () => {
    render(<CheckboxGroup legend="Accessibility" options={[]} selected={[]} onToggle={vi.fn()} />);

    expect(screen.getByText("None available.")).toBeInTheDocument();
  });
});

describe("loading and empty states", () => {
  it("[SPM-7][AC3] Spinner and SkeletonRows announce that something is loading", () => {
    render(
      <>
        <Spinner />
        <SkeletonRows rows={2} />
      </>
    );

    expect(screen.getAllByRole("status", { name: "Loading" })).toHaveLength(2);
  });

  it("[SPM-7][AC3] SkeletonRows defaults to three rows", () => {
    const { container } = render(<SkeletonRows />);

    expect(container.querySelectorAll("[role=status] > div")).toHaveLength(3);
  });

  it("[SPM-7][AC3] Skeleton is hidden from assistive technology", () => {
    const { container } = render(<Skeleton className="h-4" />);

    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("[SPM-7][AC3] EmptyState shows its title, description and action", () => {
    render(<EmptyState title="No events yet" description="Raise your first request." action={<button>New event</button>} />);

    expect(screen.getByText("No events yet")).toBeInTheDocument();
    expect(screen.getByText("Raise your first request.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New event" })).toBeInTheDocument();
  });

  it("[SPM-7][AC3] EmptyState works with a title alone", () => {
    const { container } = render(<EmptyState title="No events yet" />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});

describe("DataState", () => {
  const empty = { title: "Nothing here" };
  const children = (rows: string[]) => <ul>{rows.map((r) => <li key={r}>{r}</li>)}</ul>;

  it("[SPM-7][AC3] shows a skeleton while data is null", () => {
    render(<DataState data={null} empty={empty}>{children}</DataState>);

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("[SPM-7][AC3] shows the empty state for an empty list", () => {
    render(<DataState data={[]} empty={empty}>{children}</DataState>);

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("[SPM-7][AC3] renders the rows once loaded", () => {
    render(<DataState data={["Gala", "Summit"]} empty={empty}>{children}</DataState>);

    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Gala", "Summit"]);
  });

  it("[SPM-7][AC5] shows an error over everything else, with a Retry that calls back", async () => {
    const onRetry = vi.fn();
    render(<DataState data={null} error="The server did not respond" onRetry={onRetry} empty={empty}>{children}</DataState>);

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this");
    expect(screen.getByRole("alert")).toHaveTextContent("The server did not respond");
    expect(screen.queryByRole("status", { name: "Loading" })).not.toBeInTheDocument();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("[SPM-7][AC5] offers no Retry when there is nothing to retry", () => {
    render(<DataState data={["Gala"]} error="Failed" empty={empty}>{children}</DataState>);

    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});

describe("Table", () => {
  interface Row {
    id: string;
    title: string;
    status: string;
  }
  const rows: Row[] = [
    { id: "1", title: "Gala Dinner", status: "planning" },
    { id: "2", title: "Summit", status: "confirmed" },
  ];
  const columns: Column<Row>[] = [
    { key: "title", header: "Event", render: (r) => r.title, hideLabelOnMobile: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  it("[SPM-7][AC3] renders a header per column and a row per record, with a caption", () => {
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} caption="Your events" />);
    const table = screen.getByRole("table", { name: "Your events" });

    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Event", "Status"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("cell", { name: "Gala Dinner" })).toBeInTheDocument();
  });

  it("[SPM-7][AC3] also renders each record as a stacked card for small screens", () => {
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const cards = screen.getAllByRole("listitem");

    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Gala Dinner")).toBeInTheDocument();
    // "Event" is hidden on mobile; "Status" keeps its label.
    expect(within(cards[0]).queryByText("Event")).not.toBeInTheDocument();
    expect(within(cards[0]).getByText("Status")).toBeInTheDocument();
  });

  it("[SPM-7][AC3] calls onRowClick from a table row", async () => {
    const onRowClick = vi.fn();
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);

    await userEvent.click(within(screen.getByRole("table")).getByRole("cell", { name: "Summit" }));

    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("[SPM-7][AC3] makes each card a button reachable by click, Enter and Space", async () => {
    const onRowClick = vi.fn();
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    const [first, second] = screen.getAllByRole("button");

    await userEvent.click(first);
    second.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    await userEvent.keyboard("a");

    expect(onRowClick.mock.calls.map(([row]) => row.id)).toEqual(["1", "2", "2"]);
  });

  it("[SPM-7][AC3] has no clickable rows when no handler is given", () => {
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  function Harness({ loading = false, onConfirm = vi.fn(), onCancel = vi.fn() }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <button onClick={() => setOpen(false)}>Close from outside</button>
        <ConfirmDialog
          open={open}
          title="Retire Hall A?"
          confirmLabel="Retire venue"
          loading={loading}
          onConfirm={onConfirm}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        >
          Three approved bookings will be flagged for review.
        </ConfirmDialog>
      </>
    );
  }

  const dialog = () => screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;

  it("[SPM-7][AC3] stays closed until asked to open", () => {
    render(<Harness />);

    expect(dialog().open).toBe(false);
  });

  it("[SPM-7][AC3] opens with its title and the specific consequence", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(dialog().open).toBe(true);
    expect(within(dialog()).getByRole("heading", { name: "Retire Hall A?", hidden: true })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("Three approved bookings will be flagged for review.");
  });

  it("[SPM-7][AC3] confirms through its confirm button", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    await userEvent.click(within(dialog()).getByRole("button", { name: "Retire venue", hidden: true }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("[SPM-7][AC3] cancels through its Cancel button, and closes", async () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(false);
  });

  it("[SPM-7][AC3] treats Esc as Cancel", async () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("[SPM-7][AC3] treats being closed by the browser as Cancel, so its owner's state stays in step", async () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    act(() => dialog().close());

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("[SPM-7][AC3] closes when its owner sets open to false", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    await userEvent.click(screen.getByRole("button", { name: "Close from outside", hidden: true }));

    expect(dialog().open).toBe(false);
  });

  it("[SPM-7][AC3] cannot be cancelled while its action is in flight", async () => {
    const onCancel = vi.fn();
    render(<Harness loading onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));

    expect(within(dialog()).getByRole("button", { name: "Cancel", hidden: true })).toBeDisabled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
  });
});
