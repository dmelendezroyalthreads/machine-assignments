import React from "react";
import ReactDOM from "react-dom/client";
import { Activity, Check, Cloud, KeyRound, Loader2, Lock, MonitorCog, Plus, RefreshCw, Save, ShieldCheck, Trash2, Wifi, WifiOff } from "lucide-react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import "./styles.css";

const categories = ["P2S", "Events", "Rush/MST", "FIFO", "Special Project"] as const;
const locations = ["Location A", "Location B"] as const;

type Category = (typeof categories)[number];
type LocationName = (typeof locations)[number];

type Assignment = {
  id: string;
  location: string;
  machine: string;
  category: Category;
  category_detail: string;
  operator_name: string;
  quantity: number;
  created_at?: string;
  updated_at?: string;
};

type Draft = Omit<Assignment, "id" | "created_at" | "updated_at">;

const emptyDraft: Draft = {
  location: "Location A",
  machine: "",
  category: "P2S",
  category_detail: "",
  operator_name: "",
  quantity: 0,
};

const sampleAssignments: Assignment[] = [
  {
    id: "demo-1",
    location: "Location A",
    machine: "Tajima 1",
    category: "Rush/MST",
    category_detail: "AM wave",
    operator_name: "A. Rivera",
    quantity: 144,
  },
  {
    id: "demo-2",
    location: "Location A",
    machine: "Barudan 2",
    category: "P2S",
    category_detail: "white polos",
    operator_name: "M. Jones",
    quantity: 216,
  },
  {
    id: "demo-3",
    location: "Location B",
    machine: "Tajima 4",
    category: "Events",
    category_detail: "tournament",
    operator_name: "K. Lee",
    quantity: 88,
  },
];

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

const configuredForSupabase = Boolean(
  supabaseUrl &&
    supabaseKey &&
    !supabaseUrl.includes("your-project-ref") &&
    !supabaseKey.includes("your_key_here")
);

const supabase: SupabaseClient | null = configuredForSupabase
  ? createClient(supabaseUrl!, supabaseKey!, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;

function sortAssignments(rows: Assignment[]) {
  return [...rows].sort((a, b) => {
    const locationCompare = a.location.localeCompare(b.location);
    if (locationCompare !== 0) return locationCompare;
    return a.machine.localeCompare(b.machine, undefined, { numeric: true, sensitivity: "base" });
  });
}

function readDemoAssignments() {
  const saved = window.localStorage.getItem("machine-assignments-demo");
  if (!saved) return sampleAssignments;
  try {
    return JSON.parse(saved) as Assignment[];
  } catch {
    return sampleAssignments;
  }
}

function saveDemoAssignments(rows: Assignment[]) {
  window.localStorage.setItem("machine-assignments-demo", JSON.stringify(rows));
}

function normalizeQuantity(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(360, Math.round(value)));
}

function validateDraft(draft: Draft) {
  if (!draft.machine.trim()) return "Machine is required.";
  if (!categories.includes(draft.category)) return "Choose a valid category.";
  if (draft.category_detail.length > 20) return "Category detail must be 20 characters or fewer.";
  if (draft.quantity < 0 || draft.quantity > 360) return "Quantity must be between 0 and 360.";
  return "";
}

function useAssignments() {
  const [assignments, setAssignments] = React.useState<Assignment[]>([]);
  const [status, setStatus] = React.useState(supabase ? "Connecting" : "Demo mode");
  const [error, setError] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);

  const loadAssignments = React.useCallback(async () => {
    setIsLoading(true);
    setError("");
    if (!supabase) {
      const demo = sortAssignments(readDemoAssignments());
      setAssignments(demo);
      setIsLoading(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("machine_assignments")
      .select("*")
      .order("location", { ascending: true })
      .order("machine", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      setStatus("Needs database setup");
      setAssignments([]);
    } else {
      setAssignments(sortAssignments((data || []) as Assignment[]));
      setStatus("Connected");
    }
    setIsLoading(false);
  }, []);

  React.useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  React.useEffect(() => {
    if (!supabase) return undefined;

    let channel: RealtimeChannel | null = supabase
      .channel("machine-assignments-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "machine_assignments" },
        (payload) => {
          setAssignments((current) => {
            if (payload.eventType === "DELETE") {
              const oldRow = payload.old as Assignment;
              return sortAssignments(current.filter((row) => row.id !== oldRow.id));
            }

            const nextRow = payload.new as Assignment;
            const withoutExisting = current.filter((row) => row.id !== nextRow.id);
            return sortAssignments([...withoutExisting, nextRow]);
          });
        }
      )
      .subscribe((state) => {
        if (state === "SUBSCRIBED") setStatus("Live");
        if (state === "CHANNEL_ERROR") setStatus("Realtime unavailable");
        if (state === "TIMED_OUT") setStatus("Realtime timed out");
      });

    return () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, []);

  async function createAssignment(draft: Draft) {
    const issue = validateDraft(draft);
    if (issue) {
      setError(issue);
      return false;
    }
    setError("");
    const record = {
      ...draft,
      machine: draft.machine.trim(),
      category_detail: draft.category_detail.trim(),
      operator_name: draft.operator_name.trim(),
      quantity: normalizeQuantity(draft.quantity),
    };

    if (!supabase) {
      const next = sortAssignments([
        ...assignments,
        { id: crypto.randomUUID(), ...record },
      ]);
      setAssignments(next);
      saveDemoAssignments(next);
      return true;
    }

    const { error: insertError } = await supabase.from("machine_assignments").insert(record);
    if (insertError) {
      setError(insertError.message);
      return false;
    }
    return true;
  }

  async function updateAssignment(id: string, draft: Draft) {
    const issue = validateDraft(draft);
    if (issue) {
      setError(issue);
      return false;
    }
    setError("");
    const record = {
      ...draft,
      machine: draft.machine.trim(),
      category_detail: draft.category_detail.trim(),
      operator_name: draft.operator_name.trim(),
      quantity: normalizeQuantity(draft.quantity),
    };

    if (!supabase) {
      const next = sortAssignments(assignments.map((row) => (row.id === id ? { ...row, ...record } : row)));
      setAssignments(next);
      saveDemoAssignments(next);
      return true;
    }

    const { error: updateError } = await supabase.from("machine_assignments").update(record).eq("id", id);
    if (updateError) {
      setError(updateError.message);
      return false;
    }
    return true;
  }

  async function deleteAssignment(id: string) {
    setError("");
    if (!supabase) {
      const next = assignments.filter((row) => row.id !== id);
      setAssignments(next);
      saveDemoAssignments(next);
      return;
    }
    const { error: deleteError } = await supabase.from("machine_assignments").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
  }

  return {
    assignments,
    createAssignment,
    deleteAssignment,
    error,
    isLoading,
    loadAssignments,
    status,
    updateAssignment,
  };
}

function App({ onLock }: { onLock: () => Promise<void> }) {
  const {
    assignments,
    createAssignment,
    deleteAssignment,
    error,
    isLoading,
    loadAssignments,
    status,
    updateAssignment,
  } = useAssignments();
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [locationFilter, setLocationFilter] = React.useState<"All" | LocationName>("All");

  const filteredAssignments = locationFilter === "All"
    ? assignments
    : assignments.filter((assignment) => assignment.location === locationFilter);

  const totals = React.useMemo(() => {
    const locationTotals = locations.map((location) => ({
      location,
      units: assignments
        .filter((assignment) => assignment.location === location)
        .reduce((sum, assignment) => sum + assignment.quantity, 0),
    }));
    return {
      machines: assignments.length,
      units: assignments.reduce((sum, assignment) => sum + assignment.quantity, 0),
      locationTotals,
    };
  }, [assignments]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const created = await createAssignment(draft);
    if (created) setDraft(emptyDraft);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Production planning</p>
          <h1>Machine Assignments</h1>
        </div>
        <div className="topbar-actions">
          <div className={`connection ${supabase ? "live" : "demo"}`}>
            {supabase ? <Wifi size={18} /> : <WifiOff size={18} />}
            <span>{status}</span>
          </div>
          {supabase && (
            <button className="lock-action" type="button" onClick={() => void onLock()} title="Lock this device">
              <Lock size={17} />
              <span>Lock</span>
            </button>
          )}
        </div>
      </header>

      <main>
        <section className="metrics-band" aria-label="Assignment summary">
          <Metric icon={<MonitorCog size={20} />} label="Assigned Machines" value={totals.machines.toString()} />
          <Metric icon={<Activity size={20} />} label="Total Units" value={totals.units.toLocaleString()} />
          {totals.locationTotals.map((item) => (
            <Metric key={item.location} icon={<Cloud size={20} />} label={item.location} value={item.units.toLocaleString()} />
          ))}
        </section>

        {!supabase && (
          <section className="notice">
            <strong>Demo mode.</strong> Add Supabase environment variables to make this shared across both locations in real time.
          </section>
        )}

        {error && (
          <section className="notice error">
            <strong>Needs attention.</strong> {error}
          </section>
        )}

        <section className="entry-panel" aria-label="Add assignment">
          <form onSubmit={handleCreate} className="assignment-form">
            <Field label="Location">
              <select
                value={draft.location}
                onChange={(event) => setDraft({ ...draft, location: event.target.value })}
              >
                {locations.map((location) => (
                  <option key={location} value={location}>{location}</option>
                ))}
              </select>
            </Field>
            <Field label="Machine">
              <input
                value={draft.machine}
                maxLength={40}
                placeholder="Machine 1"
                onChange={(event) => setDraft({ ...draft, machine: event.target.value })}
              />
            </Field>
            <Field label="Category">
              <select
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value as Category })}
              >
                {categories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </Field>
            <Field label="Detail">
              <input
                value={draft.category_detail}
                maxLength={20}
                placeholder="20 chars max"
                onChange={(event) => setDraft({ ...draft, category_detail: event.target.value })}
              />
            </Field>
            <Field label="Operator">
              <input
                value={draft.operator_name}
                placeholder="Operator name"
                onChange={(event) => setDraft({ ...draft, operator_name: event.target.value })}
              />
            </Field>
            <Field label="Units">
              <input
                type="number"
                min={0}
                max={360}
                value={draft.quantity}
                onChange={(event) => setDraft({ ...draft, quantity: Number(event.target.value) })}
              />
            </Field>
            <button className="primary-action" type="submit" title="Add assignment">
              <Plus size={18} />
              <span>Add</span>
            </button>
          </form>
        </section>

        <section className="toolbar" aria-label="Filters">
          <div className="tabs">
            {(["All", ...locations] as const).map((item) => (
              <button
                key={item}
                className={locationFilter === item ? "active" : ""}
                type="button"
                onClick={() => setLocationFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <button className="icon-action" type="button" onClick={() => void loadAssignments()} title="Refresh">
            {isLoading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </section>

        <section className="table-wrap" aria-label="Machine assignment table">
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Machine</th>
                <th>Category</th>
                <th>Detail</th>
                <th>Operator</th>
                <th>Units</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && assignments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">Loading assignments...</td>
                </tr>
              ) : filteredAssignments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">No machine assignments for this view.</td>
                </tr>
              ) : (
                filteredAssignments.map((assignment) => (
                  <AssignmentRow
                    key={assignment.id}
                    assignment={assignment}
                    onDelete={deleteAssignment}
                    onSave={updateAssignment}
                  />
                ))
              )}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

function AccessGate() {
  const [authorized, setAuthorized] = React.useState(!supabase);
  const [checking, setChecking] = React.useState(Boolean(supabase));
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState("");

  const ensureAnonymousSession = React.useCallback(async () => {
    if (!supabase) return true;
    const { data } = await supabase.auth.getSession();
    if (data.session) return true;
    const { error: signInError } = await supabase.auth.signInAnonymously();
    if (signInError) {
      setError("Anonymous sign-in must be enabled in Supabase before this app can connect.");
      return false;
    }
    return true;
  }, []);

  React.useEffect(() => {
    async function checkAccess() {
      if (!supabase) return;
      const hasSession = await ensureAnonymousSession();
      if (hasSession) {
        const { data, error: accessError } = await supabase.rpc("has_machine_assignment_access");
        if (accessError) setError(accessError.message);
        setAuthorized(Boolean(data));
      }
      setChecking(false);
    }
    void checkAccess();
  }, [ensureAnonymousSession]);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setChecking(true);
    setError("");
    const hasSession = await ensureAnonymousSession();
    if (hasSession) {
      const { data, error: verifyError } = await supabase.rpc("verify_machine_assignment_pin", { pin_input: pin });
      if (verifyError) setError(verifyError.message);
      else if (!data) setError("That PIN is not correct.");
      else {
        setPin("");
        setAuthorized(true);
      }
    }
    setChecking(false);
  }

  async function lock() {
    if (!supabase) return;
    await supabase.rpc("revoke_machine_assignment_access");
    await supabase.auth.signOut();
    setAuthorized(false);
    setChecking(false);
  }

  if (authorized) return <App onLock={lock} />;

  return (
    <div className="access-shell">
      <section className="access-panel" aria-labelledby="access-title">
        <div className="access-icon"><ShieldCheck size={28} /></div>
        <p className="eyebrow">Production planning</p>
        <h1 id="access-title">Machine Assignments</h1>
        <p className="access-copy">Enter the team PIN to open the live assignment board.</p>
        <form className="pin-form" onSubmit={unlock}>
          <label className="field">
            <span>Team PIN</span>
            <div className="pin-input-wrap">
              <KeyRound size={18} />
              <input
                autoComplete="one-time-code"
                autoFocus
                inputMode="numeric"
                maxLength={8}
                pattern="[0-9]*"
                type="password"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              />
            </div>
          </label>
          <button className="primary-action unlock-action" disabled={checking || pin.length < 4} type="submit">
            {checking ? <Loader2 className="spin" size={18} /> : <Lock size={18} />}
            <span>{checking ? "Checking" : "Unlock"}</span>
          </button>
        </form>
        {error && <p className="access-error">{error}</p>}
        <p className="access-note">Access stays unlocked on this device for 12 hours.</p>
      </section>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function AssignmentRow({
  assignment,
  onDelete,
  onSave,
}: {
  assignment: Assignment;
  onDelete: (id: string) => Promise<void>;
  onSave: (id: string, draft: Draft) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState<Draft>({
    location: assignment.location,
    machine: assignment.machine,
    category: assignment.category,
    category_detail: assignment.category_detail,
    operator_name: assignment.operator_name,
    quantity: assignment.quantity,
  });
  const [isSaving, setIsSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    setDraft({
      location: assignment.location,
      machine: assignment.machine,
      category: assignment.category,
      category_detail: assignment.category_detail,
      operator_name: assignment.operator_name,
      quantity: assignment.quantity,
    });
  }, [assignment]);

  async function handleSave() {
    setIsSaving(true);
    const ok = await onSave(assignment.id, draft);
    setIsSaving(false);
    if (ok) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
    }
  }

  return (
    <tr>
      <td>
        <select
          aria-label="Location"
          value={draft.location}
          onChange={(event) => setDraft({ ...draft, location: event.target.value })}
        >
          {locations.map((location) => (
            <option key={location} value={location}>{location}</option>
          ))}
        </select>
      </td>
      <td>
        <input
          aria-label="Machine"
          value={draft.machine}
          maxLength={40}
          onChange={(event) => setDraft({ ...draft, machine: event.target.value })}
        />
      </td>
      <td>
        <select
          aria-label="Category"
          value={draft.category}
          onChange={(event) => setDraft({ ...draft, category: event.target.value as Category })}
        >
          {categories.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
      </td>
      <td>
        <input
          aria-label="Category detail"
          value={draft.category_detail}
          maxLength={20}
          onChange={(event) => setDraft({ ...draft, category_detail: event.target.value })}
        />
      </td>
      <td>
        <input
          aria-label="Operator"
          value={draft.operator_name}
          onChange={(event) => setDraft({ ...draft, operator_name: event.target.value })}
        />
      </td>
      <td>
        <input
          aria-label="Quantity"
          className="units-input"
          type="number"
          min={0}
          max={360}
          value={draft.quantity}
          onChange={(event) => setDraft({ ...draft, quantity: Number(event.target.value) })}
        />
      </td>
      <td className="actions-cell">
        <button className="icon-action" type="button" onClick={handleSave} title="Save row">
          {isSaving ? <Loader2 className="spin" size={17} /> : saved ? <Check size={17} /> : <Save size={17} />}
        </button>
        <button className="icon-action danger" type="button" onClick={() => void onDelete(assignment.id)} title="Delete row">
          <Trash2 size={17} />
        </button>
      </td>
    </tr>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AccessGate />
  </React.StrictMode>
);
