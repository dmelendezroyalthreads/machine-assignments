import React from "react";
import ReactDOM from "react-dom/client";
import { Activity, Check, CheckCircle2, ChevronDown, ChevronUp, Cloud, FileSpreadsheet, KeyRound, Loader2, Lock, MonitorCog, Plus, RefreshCw, RotateCcw, Save, ShieldCheck, Trash2, Upload, Wifi, WifiOff, X } from "lucide-react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { parseOrderFile, type ImportedOrder, type ImportSourceType } from "./orderImport";
import "./styles.css";

const categories = ["P2S", "Events", "Rush/MST", "FIFO", "Special Project", "Tour Player", "Held ZenDesk"] as const;
const locations = ["1st Shift", "2nd Shift", "3rd Shift"] as const;

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

type MachineOrder = ImportedOrder & {
  id: string;
  status: "pending" | "completed" | "removed";
  completed_at?: string | null;
};

const emptyDraft: Draft = {
  location: "1st Shift",
  machine: "",
  category: "P2S",
  category_detail: "",
  operator_name: "",
  quantity: 0,
};

const sampleAssignments: Assignment[] = [
  {
    id: "demo-1",
    location: "1st Shift",
    machine: "Tajima 1",
    category: "Rush/MST",
    category_detail: "AM wave",
    operator_name: "A. Rivera",
    quantity: 144,
  },
  {
    id: "demo-2",
    location: "2nd Shift",
    machine: "Barudan 2",
    category: "P2S",
    category_detail: "white polos",
    operator_name: "M. Jones",
    quantity: 216,
  },
  {
    id: "demo-3",
    location: "3rd Shift",
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
const skipAuthForLocalPreview = import.meta.env.DEV && import.meta.env.VITE_SKIP_AUTH === "true";

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
        () => {
          void loadAssignments();
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
  }, [loadAssignments]);

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
    await loadAssignments();
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
    await loadAssignments();
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
    else await loadAssignments();
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
  const [showImport, setShowImport] = React.useState(false);

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
    const categoryTotals = categories.map((category) => {
      const categoryAssignments = assignments.filter((assignment) => assignment.category === category);
      return {
        category,
        machines: categoryAssignments.length,
        units: categoryAssignments.reduce((sum, assignment) => sum + assignment.quantity, 0),
      };
    });
    return {
      machines: assignments.length,
      units: assignments.reduce((sum, assignment) => sum + assignment.quantity, 0),
      locationTotals,
      categoryTotals,
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
            <>
              <button className="secondary-action" type="button" onClick={() => setShowImport(true)}>
                <Upload size={17} />
                <span>Import orders</span>
              </button>
              <button className="lock-action" type="button" onClick={() => void onLock()} title="Lock this device">
                <Lock size={17} />
                <span>Lock</span>
              </button>
            </>
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

        <section className="category-metrics-band" aria-label="Category totals">
          {totals.categoryTotals.map((item) => (
            <Metric
              key={item.category}
              icon={<Activity size={20} />}
              label={item.category}
              value={`${item.units.toLocaleString()} units`}
              subvalue={`${item.machines} ${item.machines === 1 ? "machine" : "machines"}`}
            />
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
            <Field label="Shift">
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
                <th>Shift</th>
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
                    onOrdersChanged={loadAssignments}
                    onSave={updateAssignment}
                  />
                ))
              )}
            </tbody>
          </table>
        </section>
      </main>
      {showImport && (
        <ImportOrdersDialog
          assignments={assignments}
          onClose={() => setShowImport(false)}
          onImported={loadAssignments}
        />
      )}
    </div>
  );
}

function AccessGate() {
  const [authorized, setAuthorized] = React.useState(!supabase || skipAuthForLocalPreview);
  const [checking, setChecking] = React.useState(Boolean(supabase) && !skipAuthForLocalPreview);
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
      if (!supabase || skipAuthForLocalPreview) return;
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

function Metric({
  icon,
  label,
  subvalue,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  subvalue?: string;
  value: string;
}) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {subvalue && <small>{subvalue}</small>}
      </div>
    </div>
  );
}

function ImportOrdersDialog({
  assignments,
  onClose,
  onImported,
}: {
  assignments: Assignment[];
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const eligibleAssignments = assignments.filter((assignment) => {
    const machineNumber = Number(assignment.machine.match(/\d+/)?.[0] || 0);
    return machineNumber >= 1 && machineNumber <= 15;
  });
  const [assignmentId, setAssignmentId] = React.useState(eligibleAssignments[0]?.id || "");
  const [fileName, setFileName] = React.useState("");
  const [sourceType, setSourceType] = React.useState<ImportSourceType>("generic");
  const [orders, setOrders] = React.useState<ImportedOrder[]>([]);
  const [sourceFilter, setSourceFilter] = React.useState("");
  const [targetBy, setTargetBy] = React.useState<"machine" | "location">("machine");
  const [selectedOrderKeys, setSelectedOrderKeys] = React.useState<Set<string>>(new Set());
  const [mode, setMode] = React.useState<"replace" | "merge">("replace");
  const [confirmingReplace, setConfirmingReplace] = React.useState(false);
  const [error, setError] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  const durhamLocations = React.useMemo(
    () => [...new Set(orders
      .map((order) => order.source_location)
      .filter((location) => /^DUR(?:-|\b)/i.test(location)))].sort(),
    [orders]
  );
  const selectedAssignment = assignments.find((assignment) => assignment.id === assignmentId);
  const selectedMachineNumber = Number(selectedAssignment?.machine.match(/\d+/)?.[0] || 0);
  const isAllMachines = assignmentId === "all";
  const eligibleMachineNumbers = new Set(eligibleAssignments.map((assignment) => (
    Number(assignment.machine.match(/\d+/)?.[0] || 0)
  )));
  const filteredOrders = targetBy === "machine"
    ? orders.filter((order) => {
        const locationNumber = Number(order.source_location.match(/(\d+)$/)?.[1] || 0);
        return /^DUR(?:-|\b)/i.test(order.source_location)
          && (isAllMachines ? eligibleMachineNumbers.has(locationNumber) : locationNumber === selectedMachineNumber);
      })
    : orders.filter((order) => order.source_location === sourceFilter);
  const selectedOrders = filteredOrders.filter((order) => selectedOrderKeys.has(order.order_key));
  const totalUnits = selectedOrders.reduce((sum, order) => sum + order.units, 0);
  const ordersByAssignment = eligibleAssignments.map((assignment) => {
    const machineNumber = Number(assignment.machine.match(/\d+/)?.[0] || 0);
    const machineOrders = selectedOrders.filter((order) => (
      Number(order.source_location.match(/(\d+)$/)?.[1] || 0) === machineNumber
    ));
    return { assignment, orders: machineOrders };
  }).filter((group) => group.orders.length > 0);
  const overLimitMachines = ordersByAssignment.filter((group) => (
    group.orders.reduce((sum, order) => sum + order.units, 0) > 360
  ));

  function selectSource(nextFilter: string, nextOrders = orders, nextTargetBy = targetBy) {
    setSourceFilter(nextFilter);
    const machineNumber = Number(assignments.find((assignment) => assignment.id === assignmentId)?.machine.match(/\d+/)?.[0] || 0);
    const matchingOrders = nextTargetBy === "machine"
      ? nextOrders.filter((order) => {
          const locationNumber = Number(order.source_location.match(/(\d+)$/)?.[1] || 0);
          return /^DUR(?:-|\b)/i.test(order.source_location)
            && (assignmentId === "all" ? eligibleMachineNumbers.has(locationNumber) : locationNumber === machineNumber);
        })
      : nextOrders.filter((order) => order.source_location === nextFilter);
    setSelectedOrderKeys(new Set(matchingOrders.map((order) => order.order_key)));
    setConfirmingReplace(false);
  }

  function suggestedSourceFilter(nextOrders: ImportedOrder[], nextAssignmentId: string) {
    const machine = assignments.find((assignment) => assignment.id === nextAssignmentId)?.machine || "";
    const machineNumber = machine.match(/\d+/)?.[0]?.padStart(2, "0");
    if (!machineNumber) return "";
    return nextOrders.find((order) => order.source_location.match(/\d+$/)?.[0] === machineNumber)?.source_location
      || "";
  }

  function selectLocation(nextLocation: string) {
    const locationNumber = Number(nextLocation.match(/(\d+)$/)?.[1] || 0);
    const matchingAssignment = eligibleAssignments.find((assignment) => (
      Number(assignment.machine.match(/\d+/)?.[0] || 0) === locationNumber
    ));
    if (matchingAssignment) setAssignmentId(matchingAssignment.id);
    selectSource(nextLocation);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setOrders([]);
    try {
      const parsed = await parseOrderFile(file);
      setFileName(file.name);
      setSourceType(parsed.sourceType);
      setOrders(parsed.orders);
      const suggested = suggestedSourceFilter(parsed.orders, assignmentId);
      selectSource(suggested, parsed.orders, targetBy);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Could not read the file.");
    }
  }

  async function importOrders(confirmedReplace = false) {
    if (!supabase || !assignmentId || selectedOrders.length === 0) return;
    if (mode === "replace" && !confirmedReplace) {
      setConfirmingReplace(true);
      return;
    }
    setIsSaving(true);
    setError("");
    const request = isAllMachines
      ? supabase.rpc("import_all_durham_machine_orders", {
          p_file_name: fileName,
          p_source_type: sourceType,
          p_import_mode: mode,
          p_machine_groups: ordersByAssignment.map((group) => ({
            assignment_id: group.assignment.id,
            orders: group.orders,
          })),
          p_confirm_replace: confirmedReplace,
        })
      : supabase.rpc("import_machine_assignment_orders", {
          p_assignment_id: assignmentId,
          p_file_name: fileName,
          p_source_type: sourceType,
          p_import_mode: mode,
          p_orders: selectedOrders,
          p_confirm_replace: confirmedReplace,
        });
    const { error: importError } = await request;
    if (importError) {
      setError(importError.message);
      setIsSaving(false);
      return;
    }
    await onImported();
    setIsSaving(false);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Order import</p>
            <h2 id="import-title">Assign orders to a machine</h2>
          </div>
          <button className="icon-action" type="button" onClick={onClose} title="Close import">
            <X size={18} />
          </button>
        </header>

        <div className="import-controls">
          <Field label="Machine">
            <select
              value={assignmentId}
              onChange={(event) => {
                const nextAssignmentId = event.target.value;
                setAssignmentId(nextAssignmentId);
                const nextMachine = Number(assignments.find((assignment) => assignment.id === nextAssignmentId)?.machine.match(/\d+/)?.[0] || 0);
                if (nextAssignmentId === "all") setTargetBy("machine");
                const matchingOrders = nextAssignmentId === "all" || targetBy === "machine"
                  ? orders.filter((order) => {
                      const locationNumber = Number(order.source_location.match(/(\d+)$/)?.[1] || 0);
                      return /^DUR(?:-|\b)/i.test(order.source_location)
                        && (nextAssignmentId === "all" ? eligibleMachineNumbers.has(locationNumber) : locationNumber === nextMachine);
                    })
                  : orders.filter((order) => order.source_location === sourceFilter);
                setSelectedOrderKeys(new Set(matchingOrders.map((order) => order.order_key)));
                setConfirmingReplace(false);
              }}
            >
              <option value="all">All Durham machines 1-15</option>
              {eligibleAssignments.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.machine} · {assignment.location}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Update method">
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as "replace" | "merge");
                setConfirmingReplace(false);
              }}
            >
              <option value="replace">Replace active list</option>
              <option value="merge">Merge with active list</option>
            </select>
          </Field>
          <Field label="Pull orders by">
            <select
              value={targetBy}
              onChange={(event) => {
                const nextTargetBy = event.target.value as "machine" | "location";
                setTargetBy(nextTargetBy);
                const nextLocation = sourceFilter || durhamLocations[0] || "";
                selectSource(nextLocation, orders, nextTargetBy);
              }}
            >
              <option value="machine">Machine 1-15</option>
              <option value="location" disabled={isAllMachines}>LogistiView location</option>
            </select>
          </Field>
          {targetBy === "location" && durhamLocations.length > 0 && (
            <Field label="Durham location">
              <select value={sourceFilter} onChange={(event) => selectLocation(event.target.value)}>
                {durhamLocations.map((location) => (
                  <option key={location} value={location}>{location}</option>
                ))}
              </select>
            </Field>
          )}
          <label className="file-picker">
            <FileSpreadsheet size={18} />
            <span>{fileName || "Choose Excel or CSV"}</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.tsv"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
          </label>
        </div>

        {orders.length > 0 && (
          <div className="import-preview">
            <div className="preview-summary">
              <span>{sourceType}</span>
              <span>
                {targetBy === "machine"
                  ? (isAllMachines ? `${ordersByAssignment.length} Durham machines` : `Durham machine ${selectedMachineNumber}`)
                  : sourceFilter}
              </span>
              <strong>{selectedOrders.length} of {filteredOrders.length} orders</strong>
              <strong className={overLimitMachines.length > 0 ? "over-limit" : ""}>{totalUnits} units</strong>
            </div>
            <div className="preview-list">
              {filteredOrders.slice(0, 100).map((order) => (
                <label key={order.order_key}>
                  <input
                    type="checkbox"
                    checked={selectedOrderKeys.has(order.order_key)}
                    onChange={(event) => {
                      const next = new Set(selectedOrderKeys);
                      if (event.target.checked) next.add(order.order_key);
                      else next.delete(order.order_key);
                      setSelectedOrderKeys(next);
                    }}
                  />
                  <span>{order.order_key}</span>
                  <span>{order.customer_name || order.order_number || "No customer"}</span>
                  <strong>{order.units}</strong>
                </label>
              ))}
              {filteredOrders.length > 100 && <p>Showing the first 100 orders. Choose a source location to narrow the list.</p>}
            </div>
          </div>
        )}

        {error && <p className="access-error">{error}</p>}
        {!isAllMachines && totalUnits > 360 && <p className="access-error">This list exceeds the 360-unit machine limit.</p>}
        {isAllMachines && overLimitMachines.length > 0 && (
          <p className="access-error">
            Over 360 units: {overLimitMachines.map((group) => group.assignment.machine).join(", ")}.
          </p>
        )}
        {orders.length > 0 && filteredOrders.length === 0 && (
          <p className="access-error">No Durham orders matched this machine or location.</p>
        )}

        {confirmingReplace && (
          <div className="replace-confirmation" role="alert">
            <div>
              <strong>Replace {isAllMachines ? "all matched machines'" : "this machine's"} active orders?</strong>
              <span>Orders not included in this import will be removed from the affected active lists. Completed history will remain.</span>
            </div>
            <button className="danger-action" type="button" onClick={() => void importOrders(true)}>
              Confirm replace
            </button>
          </div>
        )}

        <footer className="dialog-actions">
          <button className="secondary-action" type="button" onClick={onClose}>Cancel</button>
          <button
            className="primary-action"
            disabled={isSaving || !assignmentId || selectedOrders.length === 0 || (!isAllMachines && totalUnits > 360) || overLimitMachines.length > 0}
            type="button"
            onClick={() => void importOrders(false)}
          >
            {isSaving ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
            <span>{isSaving ? "Importing" : "Import orders"}</span>
          </button>
        </footer>
      </section>
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
  onOrdersChanged,
  onSave,
}: {
  assignment: Assignment;
  onDelete: (id: string) => Promise<void>;
  onOrdersChanged: () => Promise<void>;
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
  const [expanded, setExpanded] = React.useState(false);

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
    <>
    <tr>
      <td>
        <select
          aria-label="Shift"
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
        <button className="icon-action" type="button" onClick={() => setExpanded(!expanded)} title="View imported orders">
          {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>
      </td>
    </tr>
    {expanded && (
      <tr className="orders-detail-row">
        <td colSpan={7}>
          <MachineOrders assignmentId={assignment.id} onChanged={onOrdersChanged} />
        </td>
      </tr>
    )}
    </>
  );
}

function MachineOrders({ assignmentId, onChanged }: { assignmentId: string; onChanged: () => Promise<void> }) {
  const [orders, setOrders] = React.useState<MachineOrder[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const loadOrders = React.useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("machine_assignment_orders")
      .select("*")
      .eq("assignment_id", assignmentId)
      .neq("status", "removed")
      .order("status", { ascending: false })
      .order("order_key", { ascending: true });
    if (loadError) setError(loadError.message);
    else setOrders((data || []) as MachineOrder[]);
    setLoading(false);
  }, [assignmentId]);

  React.useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  React.useEffect(() => {
    if (!supabase) return undefined;
    const channel = supabase
      .channel(`machine-orders-${assignmentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "machine_assignment_orders",
          filter: `assignment_id=eq.${assignmentId}`,
        },
        () => void loadOrders()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [assignmentId, loadOrders]);

  async function setStatus(order: MachineOrder) {
    if (!supabase) return;
    setError("");
    const nextStatus = order.status === "completed" ? "pending" : "completed";
    const { error: statusError } = await supabase.rpc("set_machine_assignment_order_status", {
      p_order_id: order.id,
      p_status: nextStatus,
    });
    if (statusError) {
      setError(statusError.message);
      return;
    }
    await Promise.all([loadOrders(), onChanged()]);
  }

  if (loading) return <div className="orders-empty"><Loader2 className="spin" size={18} /> Loading orders...</div>;
  if (error) return <div className="orders-empty error-text">{error}</div>;
  if (orders.length === 0) return <div className="orders-empty">No imported orders for this machine.</div>;

  return (
    <div className="machine-orders">
      <div className="orders-heading">
        <strong>Imported orders</strong>
        <span>{orders.filter((order) => order.status === "pending").length} open</span>
      </div>
      <div className="order-list">
        {orders.map((order) => (
          <details className={`order-item ${order.status}`} key={order.id}>
            <summary>
              <span className="order-status">{order.status === "completed" ? <CheckCircle2 size={17} /> : <span />}</span>
              <strong>{order.order_key}</strong>
              <span>{order.customer_name || order.order_number || "Order"}</span>
              <b>{order.units} units</b>
              <button
                className="order-status-action"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  void setStatus(order);
                }}
              >
                {order.status === "completed" ? <RotateCcw size={16} /> : <Check size={16} />}
                {order.status === "completed" ? "Reopen" : "Complete"}
              </button>
            </summary>
            <div className="order-meta">
              <span><small>Order</small>{order.order_number || "—"}</span>
              <span><small>Category</small>{order.category || "—"}</span>
              <span><small>Date</small>{order.due_date || "—"}</span>
              <span><small>Source location</small>{order.source_location || "—"}</span>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AccessGate />
  </React.StrictMode>
);
