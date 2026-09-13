import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LayoutDashboard, Users, Truck, NotebookPen, BookOpen, FileBarChart,
  Settings as SettingsIcon, Plus, Trash2, Pencil, X, ChevronDown, ChevronUp, ChevronsUp, ChevronsDown,
  ArrowUpRight, ArrowDownRight, ArrowUpDown, Search, Download, AlertTriangle,
  Menu, Milk, Droplets, Wallet, TrendingUp, Check, Receipt, PieChart,
  Upload, FileSpreadsheet, Folder, RefreshCw, GripVertical, ChevronLeft, ChevronRight, Calendar
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend
} from "recharts";

/* ---------------------------------------------------------------------- */
/* Constants & helpers                                                    */
/* ---------------------------------------------------------------------- */

const STORAGE_KEY = "dairy_ledger_state_v1";

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const todayStr = () => new Date().toISOString().slice(0, 10);

const fmtDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtMoney = (n, currency = "Rs") =>
  `${currency} ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const fmtNum = (n, dp = 1) =>
  Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: 0 });

const litreFromMun = (mun, munKg, density) => (Number(mun) || 0) * munKg / density;

const supplyValue = (s) => {
  const mun = Number(s.mun) || 0;
  if (mun > 0 || s.mode === "mun") {
    return mun * (Number(s.rate) || 0);
  }
  return (Number(s.litre) || 0) * (Number(s.rate) || 0);
};

const deliveryValue = (d) => (Number(d.litre) || 0) * (Number(d.rate) || 0);

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthKey = (dateStr) => dateStr.slice(0, 7); // YYYY-MM
const fmtMonth = (key) => { const [y, m] = key.split("-"); return `${MONTHS[Number(m) - 1]} ${y}`; };

function seedState() {
  return {
    areas: [],
    suppliers: [],
    customers: [],
    supplies: [],
    deliveries: [],
    expenses: [],
    expenseCategories: ["Transport / Fuel", "Labor", "Packaging", "Maintenance", "Rent", "Ice / Cooling", "Other"],
    settings: { currency: "Rs", munKg: 40, density: 1.03, alertThreshold: 5000 },
  };
}

/* running balance calc: entries -> [{...entry, value/amount, balance}] sorted chronologically */
function withRunningBalance(entries, opening, kind) {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  let bal = opening || 0;
  return sorted.map((e) => {
    let gross, paidField;
    if (kind === "supply") {
      gross = supplyValue(e);
      paidField = e.paid;
    } else {
      gross = deliveryValue(e);
      paidField = e.received;
    }
    bal += gross - (Number(paidField) || 0);
    return { ...e, gross, balanceAfter: bal };
  });
}

/* ---------------------------------------------------------------------- */
/* Small UI primitives                                                    */
/* ---------------------------------------------------------------------- */

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "entry", label: "Daily Entry", icon: NotebookPen },
  { id: "expenses", label: "Expenses", icon: Receipt },
  { id: "customers", label: "Customers", icon: Users },
  { id: "suppliers", label: "Suppliers", icon: Truck },
  { id: "ledger", label: "Ledger", icon: BookOpen },
  { id: "pnl", label: "Profit & Loss", icon: PieChart },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium mb-1" style={{ color: "var(--ink-soft)" }}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] mt-1" style={{ color: "var(--muted)" }}>{hint}</span>}
    </label>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border px-3 py-2 text-[14px] bg-white outline-none transition-colors ${props.className || ""}`}
      style={{ borderColor: "var(--border)", color: "var(--ink)", ...(props.style || {}) }}
      onFocus={(e) => { e.target.style.borderColor = "var(--accent)"; props.onFocus && props.onFocus(e); }}
      onBlur={(e) => { e.target.style.borderColor = "var(--border)"; props.onBlur && props.onBlur(e); }}
    />
  );
}

function Select({ children, ...props }) {
  return (
    <div className="relative">
      <select
        {...props}
        className="w-full appearance-none rounded-md border px-3 py-2 pr-8 text-[14px] bg-white outline-none"
        style={{ borderColor: "var(--border)", color: "var(--ink)" }}
      >
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
    </div>
  );
}

function SearchableSelect({ items = [], value, onChange, placeholder = "Select...", className = "" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const containerRef = useRef(null);

  const selectedItem = items.find((x) => x.id === value);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!filterText.trim()) return items;
    const q = filterText.toLowerCase();
    return items.filter(
      (item) =>
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.area && item.area.toLowerCase().includes(q)) ||
        (item.phone && item.phone.toLowerCase().includes(q))
    );
  }, [items, filterText]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setFilterText("");
        }}
        className="w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-[14px] bg-white text-left outline-none transition-colors"
        style={{ borderColor: isOpen ? "var(--accent)" : "var(--border)", color: "var(--ink)" }}
        title="Click to search or select"
      >
        <div className="flex items-center gap-1.5 truncate">
          <Search size={13} style={{ color: "var(--muted)" }} />
          <span className="truncate">{selectedItem ? selectedItem.name : placeholder}</span>
        </div>
        <ChevronDown size={14} className="shrink-0" style={{ color: "var(--muted)" }} />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full mt-1 w-full min-w-[250px] z-50 rounded-md border bg-white shadow-xl overflow-hidden"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="p-2 border-b" style={{ borderColor: "var(--border)", background: "var(--cream)" }}>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
              <input
                type="text"
                autoFocus
                placeholder="Type to search..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setIsOpen(false);
                  if (e.key === "Enter" && filtered.length > 0) {
                    onChange(filtered[0].id);
                    setIsOpen(false);
                  }
                }}
                className="w-full rounded border pl-8 pr-2 py-1.5 text-[13px] bg-white outline-none"
                style={{ borderColor: "var(--border)" }}
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-[12.5px] text-center" style={{ color: "var(--muted)" }}>
                No matching results
              </div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onChange(item.id);
                    setIsOpen(false);
                    setFilterText("");
                  }}
                  className="w-full px-3 py-2 text-left text-[13px] flex items-center justify-between hover:bg-[var(--cream)] transition-colors"
                  style={{
                    background: item.id === value ? "rgba(217, 162, 59, 0.12)" : "transparent",
                    fontWeight: item.id === value ? 600 : 400,
                    color: "var(--ink)",
                  }}
                >
                  <span className="truncate">{item.name}</span>
                  {item.area && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded ml-2 shrink-0" style={{ background: "rgba(0,0,0,0.05)", color: "var(--muted)" }}>
                      {item.area}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Btn({ children, variant = "primary", className = "", ...props }) {
  const styles = {
    primary: { background: "var(--accent)", color: "#231A06" },
    ghost: { background: "transparent", color: "var(--ink)", border: "1px solid var(--border)" },
    danger: { background: "transparent", color: "var(--danger)", border: "1px solid var(--danger)" },
    dark: { background: "var(--sidebar)", color: "var(--cream)" },
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium transition-opacity hover:opacity-85 active:opacity-70 disabled:opacity-40 ${className}`}
      style={styles[variant]}
    >
      {children}
    </button>
  );
}

function Card({ children, className = "", style = {} }) {
  return (
    <div className={`rounded-lg bg-white border ${className}`} style={{ borderColor: "var(--border)", ...style }}>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(27,23,15,0.45)" }} onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-lg bg-white shadow-xl max-h-[88vh] overflow-y-auto`}
        style={{ border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-[16px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:opacity-60"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Badge({ children, tone = "muted" }) {
  const tones = {
    muted: { background: "#EFE9D8", color: "#6B6355" },
    good: { background: "#E4EFE7", color: "#2F6F4E" },
    bad: { background: "#F3E3DD", color: "#A13D2B" },
  };
  return <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium" style={tones[tone]}>{children}</span>;
}

function EmptyState({ icon: Icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <Icon size={28} style={{ color: "var(--muted)" }} />
      <p className="mt-3 text-[14px] font-medium" style={{ color: "var(--ink)" }}>{title}</p>
      {sub && <p className="text-[13px] mt-1" style={{ color: "var(--muted)" }}>{sub}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Main App                                                                */
/* ---------------------------------------------------------------------- */

export default function DairyLedgerApp() {
  const [state, setState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setState({
            expenses: [],
            expenseCategories: ["Transport / Fuel", "Labor", "Packaging", "Maintenance", "Rent", "Ice / Cooling", "Other"],
            ...parsed,
          });
        } else setState(seedState());
      } catch {
        setState(seedState());
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded || !state) return;
    const t = setTimeout(async () => {
      try { await window.storage.set(STORAGE_KEY, JSON.stringify(state), false); } catch {}
    }, 350);
    return () => clearTimeout(t);
  }, [state, loaded]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  if (!loaded || !state) {
    return (
      <div className="w-full h-full min-h-[500px] flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="flex items-center gap-2 text-[14px]" style={{ color: "var(--muted)" }}>
          <Milk size={18} className="animate-pulse" /> Loading ledger…
        </div>
      </div>
    );
  }

  const ctx = { state, setState, showToast };

  return (
    <div className="w-full min-h-[640px] flex" style={{ background: "var(--bg)", fontFamily: "var(--font-body)" }}>
      <style>{`
        :root{
          --bg:#FBF8F1; --cream:#F3EBD8; --sidebar:#17332D; --sidebar-soft:#264B42;
          --ink:#221F19; --ink-soft:#453F32; --muted:#7A7261; --border:#E4DCC7;
          --accent:#D9A441; --accent-soft:#F3E3B8; --good:#2F6F4E; --danger:#A13D2B;
          --font-display:'Fraunces',ui-serif,Georgia,serif; --font-body:'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif;
        }
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        .tnum{ font-variant-numeric: tabular-nums; }
        ::-webkit-scrollbar{ width:9px; height:9px; }
        ::-webkit-scrollbar-thumb{ background:#DCD2B8; border-radius:6px; }
      `}</style>

      {/* Sidebar */}
      <aside
        className={`fixed lg:static z-40 top-0 left-0 h-full lg:h-auto w-[230px] flex-shrink-0 flex flex-col transition-transform duration-200 ${navOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
        style={{ background: "var(--sidebar)" }}
      >
        <div className="px-5 pt-6 pb-5 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--accent)" }}>
            <Milk size={16} color="#221F19" />
          </div>
          <div>
            <p className="text-[15px] font-semibold leading-tight" style={{ fontFamily: "var(--font-display)", color: "#F3EBD8" }}>Doodh Khata</p>
            <p className="text-[11px]" style={{ color: "#9CB3A9" }}>Milk supply ledger</p>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-0.5">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = tab === n.id;
            return (
              <button
                key={n.id}
                onClick={() => { setTab(n.id); setNavOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-[13.5px] font-medium transition-colors"
                style={{
                  background: active ? "var(--sidebar-soft)" : "transparent",
                  color: active ? "#FBF8F1" : "#B9C6BF",
                }}
              >
                <Icon size={16} />{n.label}
              </button>
            );
          })}
        </nav>
        <div className="px-5 py-4 text-[11px]" style={{ color: "#7C9188" }}>
          {state.customers.length} customers · {state.suppliers.length} suppliers
          <div className="mt-1" style={{ color: "#5a7a6e", fontSize: "10px" }}>Powered By: IntegroOne Solutions</div>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setNavOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center justify-between px-4 lg:px-8 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-1.5 rounded border" style={{ borderColor: "var(--border)" }} onClick={() => setNavOpen(true)}>
              <Menu size={17} />
            </button>
            <h1 className="text-[19px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
              {NAV.find((n) => n.id === tab)?.label}
            </h1>
          </div>
          <span className="text-[12.5px] hidden sm:block" style={{ color: "var(--muted)" }}>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </span>
        </header>

        <main className="flex-1 px-4 lg:px-8 py-6 overflow-x-hidden">
          {tab === "dashboard" && <Dashboard {...ctx} goTo={setTab} />}
          {tab === "entry" && <DailyEntry {...ctx} />}
          {tab === "expenses" && <ExpensesPage {...ctx} />}
          {tab === "customers" && <CustomersPage {...ctx} />}
          {tab === "suppliers" && <SuppliersPage {...ctx} />}
          {tab === "ledger" && <LedgerPage {...ctx} />}
          {tab === "pnl" && <PnLPage {...ctx} />}
          {tab === "reports" && <ReportsPage {...ctx} />}
          {tab === "settings" && <SettingsPage {...ctx} />}
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-md shadow-lg text-[13px] font-medium flex items-center gap-2" style={{ background: "var(--sidebar)", color: "#F3EBD8" }}>
          <Check size={15} style={{ color: "var(--accent)" }} /> {toast}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Dashboard                                                               */
/* ---------------------------------------------------------------------- */

function Dashboard({ state, goTo }) {
  const { customers, suppliers, supplies, deliveries, expenses, settings } = state;
  const t = todayStr();

  const todaySupplies = supplies.filter((s) => s.date === t);
  const todayDeliveries = deliveries.filter((d) => d.date === t);
  const todayExpenses = (expenses || []).filter((e) => e.date === t);

  const litreSourced = todaySupplies.reduce((a, s) => a + Number(s.litre || 0), 0);
  const munSourced = todaySupplies.reduce((a, s) => {
    if (s.mun != null && Number(s.mun) > 0) return a + Number(s.mun);
    if (s.litre && settings.munKg && settings.density) {
      return a + (Number(s.litre) * settings.density) / settings.munKg;
    }
    return a;
  }, 0);
  const litreDelivered = todayDeliveries.reduce((a, d) => a + Number(d.litre || 0), 0);
  const costToday = todaySupplies.reduce((a, s) => a + supplyValue(s), 0);
  const revenueToday = todayDeliveries.reduce((a, d) => a + deliveryValue(d), 0);
  const expenseToday = todayExpenses.reduce((a, e) => a + Number(e.amount || 0), 0);
  const grossMarginToday = revenueToday - costToday;
  const marginToday = grossMarginToday - expenseToday;
  const lossLitres = litreSourced - litreDelivered;
  const lossPct = litreSourced > 0 ? (lossLitres / litreSourced) * 100 : 0;

  const custBalances = customers.map((c) => {
    const rows = withRunningBalance(deliveries.filter((d) => d.customerId === c.id), c.openingBalance, "delivery");
    return { ...c, balance: rows.length ? rows[rows.length - 1].balanceAfter : c.openingBalance };
  });
  const supBalances = suppliers.map((s) => {
    const rows = withRunningBalance(supplies.filter((sp) => sp.supplierId === s.id), s.openingBalance, "supply");
    return { ...s, balance: rows.length ? rows[rows.length - 1].balanceAfter : s.openingBalance };
  });

  const totalReceivable = custBalances.reduce((a, c) => a + c.balance, 0);
  const totalPayable = supBalances.reduce((a, s) => a + s.balance, 0);

  const overdueCustomers = custBalances.filter((c) => c.balance >= settings.alertThreshold).sort((a, b) => b.balance - a.balance);
  const duePayables = supBalances.filter((s) => s.balance >= settings.alertThreshold).sort((a, b) => b.balance - a.balance);

  // last 7 days trend
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const trend = days.map((day) => ({
    day: fmtDate(day).slice(0, 6),
    sourced: Math.round(supplies.filter((s) => s.date === day).reduce((a, s) => a + Number(s.litre || 0), 0)),
    delivered: Math.round(deliveries.filter((d) => d.date === day).reduce((a, d) => a + Number(d.litre || 0), 0)),
  }));

  const recent = [
    ...supplies.map((s) => ({ ...s, kind: "Sourced", who: suppliers.find((x) => x.id === s.supplierId)?.name || "—" })),
    ...deliveries.map((d) => ({ ...d, kind: "Delivered", who: customers.find((x) => x.id === d.customerId)?.name || "—" })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 8);

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 lg:col-span-1 lg:row-span-2 flex flex-col justify-between" style={{ background: "var(--sidebar)", borderColor: "var(--sidebar)" }}>
          <div>
            <p className="text-[12px]" style={{ color: "#9CB3A9" }}>Today's net profit</p>
            <p className="tnum mt-2 text-[30px] font-semibold" style={{ fontFamily: "var(--font-display)", color: marginToday >= 0 ? "#F3EBD8" : "#E3A392" }}>
              {fmtMoney(marginToday, settings.currency)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] mt-4 flex-wrap" style={{ color: "#B9C6BF" }}>
            <TrendingUp size={14} /> Revenue {fmtMoney(revenueToday, settings.currency)} · Cost {fmtMoney(costToday, settings.currency)} · Expenses {fmtMoney(expenseToday, settings.currency)}
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-[12px] flex items-center gap-1.5" style={{ color: "var(--muted)" }}><Droplets size={13} /> Sourced today</p>
          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
            <span className="tnum text-[22px] font-semibold" style={{ color: "var(--ink)" }}>{fmtNum(litreSourced)} L</span>
            <span className="tnum text-[14px] font-medium" style={{ color: "var(--muted)" }}>({fmtNum(munSourced, 2)} Mun)</span>
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] flex items-center gap-1.5" style={{ color: "var(--muted)" }}><Milk size={13} /> Delivered today</p>
          <p className="tnum mt-2 text-[22px] font-semibold" style={{ color: "var(--ink)" }}>{fmtNum(litreDelivered)} L</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>Loss / shrinkage</p>
          <p className="tnum mt-2 text-[22px] font-semibold" style={{ color: lossLitres > 0 ? "var(--danger)" : "var(--good)" }}>
            {fmtNum(lossLitres)} L <span className="text-[13px] font-normal">({fmtNum(lossPct)}%)</span>
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] flex items-center gap-1.5" style={{ color: "var(--muted)" }}><Wallet size={13} /> Receivables</p>
          <p className="tnum mt-2 text-[22px] font-semibold" style={{ color: "var(--ink)" }}>{fmtMoney(totalReceivable, settings.currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] flex items-center gap-1.5" style={{ color: "var(--muted)" }}><Wallet size={13} /> Payables</p>
          <p className="tnum mt-2 text-[22px] font-semibold" style={{ color: "var(--ink)" }}>{fmtMoney(totalPayable, settings.currency)}</p>
        </Card>
      </div>

      {/* Trend + alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <p className="text-[13px] font-semibold mb-3" style={{ color: "var(--ink)" }}>Litres — last 7 days</p>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ left: -18, right: 8, top: 6 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D9A441" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#D9A441" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2F6F4E" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#2F6F4E" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4DCC7" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#7A7261" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#7A7261" }} axisLine={false} tickLine={false} width={36} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#E4DCC7" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="sourced" name="Sourced" stroke="#D9A441" fill="url(#g1)" strokeWidth={2} />
                <Area type="monotone" dataKey="delivered" name="Delivered" stroke="#2F6F4E" fill="url(#g2)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-[13px] font-semibold mb-3 flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
            <AlertTriangle size={14} style={{ color: "var(--danger)" }} /> Balances to watch
          </p>
          <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
            {overdueCustomers.length === 0 && duePayables.length === 0 && (
              <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>No balances above your alert threshold.</p>
            )}
            {overdueCustomers.map((c) => (
              <button key={c.id} onClick={() => goTo("ledger")} className="w-full flex items-center justify-between text-left">
                <span className="text-[13px]" style={{ color: "var(--ink)" }}>{c.name} <span className="text-[11px]" style={{ color: "var(--muted)" }}>· owes</span></span>
                <span className="tnum text-[13px] font-semibold" style={{ color: "var(--danger)" }}>{fmtMoney(c.balance, "Rs")}</span>
              </button>
            ))}
            {duePayables.map((s) => (
              <button key={s.id} onClick={() => goTo("ledger")} className="w-full flex items-center justify-between text-left">
                <span className="text-[13px]" style={{ color: "var(--ink)" }}>{s.name} <span className="text-[11px]" style={{ color: "var(--muted)" }}>· to pay</span></span>
                <span className="tnum text-[13px] font-semibold" style={{ color: "var(--danger)" }}>{fmtMoney(s.balance, "Rs")}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Recent activity */}
      <Card className="p-4">
        <p className="text-[13px] font-semibold mb-3" style={{ color: "var(--ink)" }}>Recent activity</p>
        {recent.length === 0 ? <EmptyState icon={NotebookPen} title="No entries yet" sub="Add a supply or delivery from Daily Entry." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <th className="py-2 font-medium">Date</th><th className="font-medium">Type</th><th className="font-medium">Party</th>
                  <th className="font-medium">Shift</th><th className="font-medium text-right">Qty</th><th className="font-medium text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2 tnum">{fmtDate(r.date)}</td>
                    <td><Badge tone={r.kind === "Sourced" ? "good" : "muted"}>{r.kind}</Badge></td>
                    <td>{r.who}</td>
                    <td style={{ color: "var(--muted)" }}>{r.shift}</td>
                    <td className="tnum text-right">{r.kind === "Sourced" && r.mun ? `${fmtNum(r.mun, 2)} Mun (${fmtNum(r.litre)} L)` : `${fmtNum(r.litre)} L`}</td>
                    <td className="tnum text-right">{fmtMoney(r.kind === "Sourced" ? supplyValue(r) : deliveryValue(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Daily Entry                                                             */
/* ---------------------------------------------------------------------- */

function DailyEntry({ state, setState, showToast }) {
  const [mode, setMode] = useState("delivery"); // delivery | supply
  const { customers, suppliers, settings, areas } = state;

  return (
    <div>
      <div className="flex gap-2 mb-5">
        <Btn variant={mode === "delivery" ? "primary" : "ghost"} onClick={() => setMode("delivery")}><Milk size={14} /> Delivery to customers</Btn>
        <Btn variant={mode === "supply" ? "primary" : "ghost"} onClick={() => setMode("supply")}><Truck size={14} /> Supply from vendors</Btn>
      </div>
      {mode === "delivery" ? <BatchDelivery state={state} setState={setState} showToast={showToast} /> : <BatchSupply state={state} setState={setState} showToast={showToast} />}
    </div>
  );
}

function BatchDelivery({ state, setState, showToast }) {
  const { customers, areas, settings, deliveries } = state;
  const [subView, setSubView] = useState("entry"); // "entry" | "log"
  const [date, setDate] = useState(todayStr());
  const [shift, setShift] = useState("Morning");
  const [area, setArea] = useState(areas[0] || "");
  const filtered = customers.filter((c) => (area ? c.area === area : true));
  const [rows, setRows] = useState({});

  useEffect(() => {
    const init = {};
    filtered.forEach((c) => {
      const existing = deliveries.find((d) => d.date === date && d.shift === shift && d.customerId === c.id);
      init[c.id] = existing ? { litre: existing.litre, rate: existing.rate, received: existing.received, entryId: existing.id } : { litre: "", rate: c.rate, received: "", entryId: null };
    });
    setRows(init);
    // eslint-disable-next-line
  }, [date, shift, area, customers.length]);

  const updateRow = (id, field, val) => setRows((r) => ({ ...r, [id]: { ...r[id], [field]: val } }));

  const saveAll = () => {
    setState((prev) => {
      let list = [...prev.deliveries];
      let count = 0;
      Object.entries(rows).forEach(([customerId, row]) => {
        if (!row.litre && !row.entryId) return;
        if (row.entryId) {
          list = list.map((d) => d.id === row.entryId ? { ...d, litre: Number(row.litre) || 0, rate: Number(row.rate) || 0, received: Number(row.received) || 0 } : d);
        } else if (row.litre) {
          list.push({ id: uid(), date, customerId, shift, litre: Number(row.litre) || 0, rate: Number(row.rate) || 0, received: Number(row.received) || 0 });
        }
        count++;
      });
      return { ...prev, deliveries: list };
    });

    // Refresh the fields (Litre and Received)
    const reset = {};
    filtered.forEach((c) => {
      reset[c.id] = { litre: "", rate: c.rate, received: "", entryId: null };
    });
    setRows(reset);

    showToast("Delivery entries saved");
  };

  const totalLitre = Object.values(rows).reduce((a, r) => a + (Number(r.litre) || 0), 0);
  const totalAmt = Object.entries(rows).reduce((a, [_, r]) => a + (Number(r.litre) || 0) * (Number(r.rate) || 0), 0);

  return (
    <div className="space-y-4">
      {/* Sub-view Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSubView("entry")}
            className={`px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${
              subView === "entry" ? "bg-[var(--accent)] text-[#231A06] shadow-sm font-semibold" : "bg-white border text-[var(--ink)] hover:bg-neutral-50"
            }`}
            style={{ borderColor: "var(--border)" }}
          >
            <NotebookPen size={14} /> Daily Entry Sheet
          </button>
          <button
            type="button"
            onClick={() => setSubView("log")}
            className={`px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${
              subView === "log" ? "bg-[var(--accent)] text-[#231A06] shadow-sm font-semibold" : "bg-white border text-[var(--ink)] hover:bg-neutral-50"
            }`}
            style={{ borderColor: "var(--border)" }}
          >
            <FileSpreadsheet size={14} /> Daily Log & Register
          </button>
        </div>
      </div>

      {subView === "entry" ? (
        <Card className="p-4">
          <div className="flex flex-wrap gap-3 mb-4">
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Shift">
              <Select value={shift} onChange={(e) => setShift(e.target.value)}>
                <option>Morning</option><option>Evening</option>
              </Select>
            </Field>
            <Field label="Area / Route">
              <Select value={area} onChange={(e) => setArea(e.target.value)}>
                {areas.map((a) => <option key={a}>{a}</option>)}
              </Select>
            </Field>
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={Users} title="No customers in this area" sub="Add customers from the Customers tab first." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                      <th className="py-2 pl-3 pr-2 font-medium w-14 text-center">S.No</th>
                      <th className="py-2 px-3 font-medium">Customer</th>
                      <th className="font-medium px-2 w-28">Litre</th>
                      <th className="font-medium px-2 w-28">Rate</th>
                      <th className="font-medium text-right px-6 w-32">Amount</th>
                      <th className="font-medium pl-6 pr-3 w-32">Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c, idx) => {
                      const row = rows[c.id] || {};
                      const amt = (Number(row.litre) || 0) * (Number(row.rate) || 0);
                      return (
                        <tr key={c.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                          <td className="py-2.5 pl-3 pr-2 text-center font-mono text-[12.5px]" style={{ color: "var(--muted)" }}>{idx + 1}</td>
                          <td className="py-2.5 px-3 font-medium" style={{ color: "var(--ink)" }}>{c.name}</td>
                          <td className="px-2"><Input type="number" value={row.litre} onChange={(e) => updateRow(c.id, "litre", e.target.value)} placeholder="0" /></td>
                          <td className="px-2"><Input type="number" value={row.rate} onChange={(e) => updateRow(c.id, "rate", e.target.value)} /></td>
                          <td className="tnum text-right px-6 font-medium" style={{ color: "var(--ink)" }}>{fmtMoney(amt, "")}</td>
                          <td className="pl-6 pr-3"><Input type="number" value={row.received} onChange={(e) => updateRow(c.id, "received", e.target.value)} placeholder="0" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-4">
                <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                  Total: <span className="tnum font-medium" style={{ color: "var(--ink)" }}>{fmtNum(totalLitre)} L</span> · {fmtMoney(totalAmt, settings.currency)}
                </p>
                <Btn onClick={saveAll}><Plus size={14} /> Save entries</Btn>
              </div>
            </>
          )}
        </Card>
      ) : (
        <DailyCustomerLog
          state={state}
          setState={setState}
          showToast={showToast}
          date={date}
          setDate={setDate}
          area={area}
          setArea={setArea}
        />
      )}
    </div>
  );
}

function DailyLogEditModal({ customer, date, morningEntry, eveningEntry, onSave, onClose, settings }) {
  const [morningLitres, setMorningLitres] = useState(morningEntry ? morningEntry.litre : "");
  const [eveningLitres, setEveningLitres] = useState(eveningEntry ? eveningEntry.litre : "");
  const [rate, setRate] = useState(morningEntry?.rate ?? eveningEntry?.rate ?? customer.rate ?? 240);
  const [received, setReceived] = useState((morningEntry?.received || 0) + (eveningEntry?.received || 0) || "");

  const totalLitres = (Number(morningLitres) || 0) + (Number(eveningLitres) || 0);
  const totalAmount = totalLitres * (Number(rate) || 0);

  const handleSave = () => {
    onSave({
      customerId: customer.id,
      date,
      morningLitres: Number(morningLitres) || 0,
      eveningLitres: Number(eveningLitres) || 0,
      rate: Number(rate) || 0,
      received: Number(received) || 0,
    });
    onClose();
  };

  return (
    <Modal title={`Edit Daily Log — ${customer.name}`} onClose={onClose}>
      <div className="space-y-3.5">
        <div className="flex items-center justify-between p-2 rounded bg-neutral-50 border text-[12.5px]" style={{ borderColor: "var(--border)" }}>
          <span style={{ color: "var(--muted)" }}>Date: <strong style={{ color: "var(--ink)" }}>{fmtDate(date)}</strong></span>
          {customer.area && <Badge>{customer.area}</Badge>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Morning (Litres)">
            <Input
              type="number"
              value={morningLitres}
              onChange={(e) => setMorningLitres(e.target.value)}
              placeholder="0"
              autoFocus
            />
          </Field>
          <Field label="Evening (Litres)">
            <Input
              type="number"
              value={eveningLitres}
              onChange={(e) => setEveningLitres(e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate (per Litre)">
            <Input
              type="number"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          <Field label="Amount Received">
            <Input
              type="number"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>

        <div className="p-3 rounded-lg border bg-neutral-50/70 space-y-1.5" style={{ borderColor: "var(--border)" }}>
          <div className="flex justify-between text-[13px]">
            <span style={{ color: "var(--muted)" }}>Total Litres:</span>
            <span className="font-semibold" style={{ color: "var(--ink)" }}>{fmtNum(totalLitres)} L</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span style={{ color: "var(--muted)" }}>Total Amount:</span>
            <span className="font-semibold text-[14px]" style={{ color: "var(--accent)" }}>{fmtMoney(totalAmount, settings.currency)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSave}><Check size={14} /> Save Changes</Btn>
        </div>
      </div>
    </Modal>
  );
}

function DailyCustomerLog({ state, setState, showToast, date, setDate, area, setArea }) {
  const { customers, areas, deliveries, settings } = state;
  const activeDate = date || todayStr();
  const activeArea = area || "";
  const [editingRow, setEditingRow] = useState(null);
  const [showOnlyActive, setShowOnlyActive] = useState(false);

  const changeDate = (days) => {
    const [y, m, d] = activeDate.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    setDate(dt.toISOString().slice(0, 10));
  };

  const areaCustomers = useMemo(() => {
    return customers.filter((c) => (activeArea ? c.area === activeArea : true));
  }, [customers, activeArea]);

  const logRows = useMemo(() => {
    return areaCustomers
      .map((c) => {
        const morning = deliveries.find((d) => d.date === activeDate && d.shift === "Morning" && d.customerId === c.id);
        const evening = deliveries.find((d) => d.date === activeDate && d.shift === "Evening" && d.customerId === c.id);
        const morningLitres = Number(morning?.litre) || 0;
        const eveningLitres = Number(evening?.litre) || 0;
        const totalLitres = morningLitres + eveningLitres;
        const rate = Number(morning?.rate ?? evening?.rate ?? c.rate) || 0;
        const amount = totalLitres * rate;
        const received = (Number(morning?.received) || 0) + (Number(evening?.received) || 0);
        const hasEntry = !!(morning || evening || totalLitres > 0 || received > 0);

        return {
          customer: c,
          name: c.name,
          area: c.area,
          morning,
          evening,
          morningLitres,
          eveningLitres,
          totalLitres,
          rate,
          amount,
          received,
          hasEntry,
        };
      })
      .filter((r) => (!showOnlyActive ? true : r.hasEntry));
  }, [areaCustomers, deliveries, activeDate, showOnlyActive]);

  const totalMorning = logRows.reduce((a, r) => a + r.morningLitres, 0);
  const totalEvening = logRows.reduce((a, r) => a + r.eveningLitres, 0);
  const grandTotalLitres = logRows.reduce((a, r) => a + r.totalLitres, 0);
  const grandTotalAmount = logRows.reduce((a, r) => a + r.amount, 0);
  const grandTotalReceived = logRows.reduce((a, r) => a + r.received, 0);

  const saveLogEdit = ({ customerId, date: entryDate, morningLitres, eveningLitres, rate, received }) => {
    setState((prev) => {
      const otherDeliveries = prev.deliveries.filter(
        (d) => !(d.date === entryDate && d.customerId === customerId)
      );
      const newEntries = [];
      const mQty = Number(morningLitres) || 0;
      const eQty = Number(eveningLitres) || 0;
      const rAmt = Number(received) || 0;
      const rRate = Number(rate) || 0;

      if (mQty > 0 || (eQty === 0 && rAmt > 0)) {
        newEntries.push({
          id: uid(),
          date: entryDate,
          customerId,
          shift: "Morning",
          litre: mQty,
          rate: rRate,
          received: rAmt,
        });
      }
      if (eQty > 0) {
        newEntries.push({
          id: uid(),
          date: entryDate,
          customerId,
          shift: "Evening",
          litre: eQty,
          rate: rRate,
          received: mQty > 0 ? 0 : rAmt,
        });
      }
      return { ...prev, deliveries: [...otherDeliveries, ...newEntries] };
    });
    showToast("Daily log entry updated");
  };

  const deleteEntry = (customerId) => {
    if (!window.confirm("Remove delivery records for this customer on this date?")) return;
    setState((prev) => ({
      ...prev,
      deliveries: prev.deliveries.filter((d) => !(d.date === activeDate && d.customerId === customerId)),
    }));
    showToast("Daily log entry removed");
  };

  const handleExport = () => {
    const excelRows = logRows.map((r, idx) => ({
      "S No": idx + 1,
      "Customer": r.name,
      "Morning": r.morningLitres || 0,
      "Evening": r.eveningLitres || 0,
      "Total Litres": r.totalLitres || 0,
      "Rate": r.rate || 0,
      "Amount": r.amount || 0,
      "Received": r.received || 0,
    }));

    excelRows.push({
      "S No": "",
      "Customer": "TOTAL",
      "Morning": totalMorning,
      "Evening": totalEvening,
      "Total Litres": grandTotalLitres,
      "Rate": "",
      "Amount": grandTotalAmount,
      "Received": grandTotalReceived,
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelRows);
    XLSX.utils.book_append_sheet(wb, ws, `Daily Log ${activeDate}`);
    const fileName = `Daily_Log_${activeDate}${activeArea ? `_${activeArea}` : ""}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast(`Exported ${fileName}`);
  };

  return (
    <div className="space-y-4">
      {/* Top Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border bg-white" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => changeDate(-1)}
              className="p-1.5 rounded hover:bg-neutral-100 border text-[12px] flex items-center"
              style={{ borderColor: "var(--border)" }}
              title="Previous Day"
            >
              <ChevronLeft size={15} />
            </button>
            <Input
              type="date"
              value={activeDate}
              onChange={(e) => setDate(e.target.value)}
              className="py-1 px-2 text-[13px] w-36"
            />
            <button
              type="button"
              onClick={() => changeDate(1)}
              className="p-1.5 rounded hover:bg-neutral-100 border text-[12px] flex items-center"
              style={{ borderColor: "var(--border)" }}
              title="Next Day"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setDate(todayStr())}
            className="px-2.5 py-1 text-[12px] rounded border hover:bg-neutral-100 transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--ink)" }}
          >
            Today
          </button>

          <div className="w-44 ml-2">
            <Select value={activeArea} onChange={(e) => setArea(e.target.value)}>
              <option value="">All Areas / Routes</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </div>

          <label className="flex items-center gap-1.5 text-[12.5px] cursor-pointer ml-2" style={{ color: "var(--ink-soft)" }}>
            <input
              type="checkbox"
              checked={showOnlyActive}
              onChange={(e) => setShowOnlyActive(e.target.checked)}
              className="rounded"
            />
            <span>Only with entries</span>
          </label>
        </div>

        <Btn variant="ghost" onClick={handleExport} className="shrink-0" title="Export this date log to Excel (.xlsx)">
          <FileSpreadsheet size={14} className="text-emerald-700" /> Export Excel (.xlsx)
        </Btn>
      </div>

      {/* Summary Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <div className="p-2.5 rounded-lg border bg-white" style={{ borderColor: "var(--border)" }}>
          <span className="text-[11px] block" style={{ color: "var(--muted)" }}>Morning Shift</span>
          <span className="text-[15px] font-bold tnum" style={{ color: "var(--ink)" }}>{fmtNum(totalMorning)} L</span>
        </div>
        <div className="p-2.5 rounded-lg border bg-white" style={{ borderColor: "var(--border)" }}>
          <span className="text-[11px] block" style={{ color: "var(--muted)" }}>Evening Shift</span>
          <span className="text-[15px] font-bold tnum" style={{ color: "var(--ink)" }}>{fmtNum(totalEvening)} L</span>
        </div>
        <div className="p-2.5 rounded-lg border bg-amber-50/50" style={{ borderColor: "rgba(217, 162, 59, 0.4)" }}>
          <span className="text-[11px] block" style={{ color: "var(--muted)" }}>Total Litres</span>
          <span className="text-[15px] font-bold tnum" style={{ color: "var(--accent)" }}>{fmtNum(grandTotalLitres)} L</span>
        </div>
        <div className="p-2.5 rounded-lg border bg-white" style={{ borderColor: "var(--border)" }}>
          <span className="text-[11px] block" style={{ color: "var(--muted)" }}>Total Amount</span>
          <span className="text-[15px] font-bold tnum" style={{ color: "var(--ink)" }}>{fmtMoney(grandTotalAmount, settings.currency)}</span>
        </div>
        <div className="p-2.5 rounded-lg border bg-emerald-50/50" style={{ borderColor: "rgba(46, 111, 78, 0.3)" }}>
          <span className="text-[11px] block text-emerald-800">Total Received</span>
          <span className="text-[15px] font-bold tnum text-emerald-800">{fmtMoney(grandTotalReceived, settings.currency)}</span>
        </div>
      </div>

      {/* Main Excel Format Table */}
      <Card className="overflow-hidden">
        {logRows.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="No entries found for this date" sub="Select another date or add delivery entries above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)", background: "rgba(0,0,0,0.01)" }}>
                  <th className="py-2.5 pl-3 pr-2 font-medium w-14 text-center">S No</th>
                  <th className="py-2.5 px-3 font-medium min-w-[150px]">Customer</th>
                  <th className="py-2.5 px-3 font-medium text-right w-24">Morning</th>
                  <th className="py-2.5 px-3 font-medium text-right w-24">Evening</th>
                  <th className="py-2.5 px-3 font-medium text-right w-28 font-semibold" style={{ color: "var(--ink)" }}>Total Litres</th>
                  <th className="py-2.5 px-3 font-medium text-right w-20">Rate</th>
                  <th className="py-2.5 px-4 font-medium text-right w-28">Amount</th>
                  <th className="py-2.5 px-4 font-medium text-right w-28">Received</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((r, idx) => (
                  <tr
                    key={r.customer.id}
                    className={`border-b last:border-0 hover:bg-neutral-50/60 transition-colors ${!r.hasEntry ? "opacity-45" : ""}`}
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="py-2 pl-3 pr-2 text-center font-mono text-[12px]" style={{ color: "var(--muted)" }}>
                      {idx + 1}
                    </td>
                    <td className="py-2 px-3 font-medium" style={{ color: "var(--ink)" }}>
                      <div className="flex items-center gap-1.5">
                        <span>{r.name}</span>
                        {r.area && <Badge className="text-[10px] py-0 px-1">{r.area}</Badge>}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right tnum font-mono">
                      {r.morningLitres > 0 ? `${fmtNum(r.morningLitres)}` : "—"}
                    </td>
                    <td className="py-2 px-3 text-right tnum font-mono">
                      {r.eveningLitres > 0 ? `${fmtNum(r.eveningLitres)}` : "—"}
                    </td>
                    <td className="py-2 px-3 text-right tnum font-semibold font-mono" style={{ color: r.totalLitres > 0 ? "var(--ink)" : "var(--muted)" }}>
                      {r.totalLitres > 0 ? `${fmtNum(r.totalLitres)} L` : "0 L"}
                    </td>
                    <td className="py-2 px-3 text-right tnum font-mono">
                      {r.rate || "—"}
                    </td>
                    <td className="py-2 px-4 text-right tnum font-medium font-mono" style={{ color: r.amount > 0 ? "var(--ink)" : "var(--muted)" }}>
                      {r.amount > 0 ? fmtMoney(r.amount, "") : "0"}
                    </td>
                    <td className="py-2 px-4 text-right tnum font-medium font-mono" style={{ color: r.received > 0 ? "var(--good)" : "var(--muted)" }}>
                      {r.received > 0 ? fmtMoney(r.received, "") : "0"}
                    </td>
                    <td className="px-2">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => setEditingRow(r)}
                          className="p-1.5 rounded hover:bg-neutral-100 text-gray-600 transition-colors"
                          title="Edit log entry"
                        >
                          <Pencil size={13} />
                        </button>
                        {r.hasEntry && (
                          <button
                            onClick={() => deleteEntry(r.customer.id)}
                            className="p-1.5 rounded hover:bg-neutral-100 transition-colors"
                            style={{ color: "var(--danger)" }}
                            title="Delete log entry"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-bold text-[13.5px]" style={{ borderColor: "var(--border)", background: "var(--cream)" }}>
                  <td className="py-2.5 pl-3 pr-2 text-center"></td>
                  <td className="py-2.5 px-3">TOTAL</td>
                  <td className="py-2.5 px-3 text-right tnum">{fmtNum(totalMorning)} L</td>
                  <td className="py-2.5 px-3 text-right tnum">{fmtNum(totalEvening)} L</td>
                  <td className="py-2.5 px-3 text-right tnum text-[14px]" style={{ color: "var(--accent)" }}>{fmtNum(grandTotalLitres)} L</td>
                  <td className="py-2.5 px-3 text-right"></td>
                  <td className="py-2.5 px-4 text-right tnum">{fmtMoney(grandTotalAmount, "")}</td>
                  <td className="py-2.5 px-4 text-right tnum text-emerald-800">{fmtMoney(grandTotalReceived, "")}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Edit Modal */}
      {editingRow && (
        <DailyLogEditModal
          customer={editingRow.customer}
          date={activeDate}
          morningEntry={editingRow.morning}
          eveningEntry={editingRow.evening}
          onSave={saveLogEdit}
          onClose={() => setEditingRow(null)}
          settings={settings}
        />
      )}
    </div>
  );
}

function BatchSupply({ state, setState, showToast }) {
  const { suppliers, settings, supplies } = state;
  const [date, setDate] = useState(todayStr());
  const [shift, setShift] = useState("Morning");
  const [mode, setMode] = useState("mun"); // mun | litre
  const [rows, setRows] = useState({});

  useEffect(() => {
    const init = {};
    suppliers.forEach((s) => {
      const existing = supplies.find((sp) => sp.date === date && sp.shift === shift && sp.supplierId === s.id);
      init[s.id] = existing
        ? { mun: existing.mun ?? "", litre: existing.litre, rate: existing.rate, paid: existing.paid, entryId: existing.id }
        : { mun: "", litre: "", rate: s.rate, paid: "", entryId: null };
    });
    setRows(init);
    // eslint-disable-next-line
  }, [date, shift, suppliers.length]);

  const updateRow = (id, field, val) => {
    setRows((r) => {
      const row = { ...r[id], [field]: val };
      if (mode === "mun" && field === "mun") {
        row.litre = litreFromMun(val, settings.munKg, settings.density);
      }
      return { ...r, [id]: row };
    });
  };

  const saveAll = () => {
    setState((prev) => {
      let list = [...prev.supplies];
      Object.entries(rows).forEach(([supplierId, row]) => {
        const litre = mode === "mun" ? litreFromMun(row.mun, settings.munKg, settings.density) : Number(row.litre) || 0;
        if (!litre && !row.entryId) return;
        if (row.entryId) {
          list = list.map((s) => s.id === row.entryId ? { ...s, mode, mun: mode === "mun" ? Number(row.mun) || 0 : null, litre, rate: Number(row.rate) || 0, paid: Number(row.paid) || 0 } : s);
        } else if (litre) {
          list.push({ id: uid(), date, supplierId, shift, mode, mun: mode === "mun" ? Number(row.mun) || 0 : null, litre, rate: Number(row.rate) || 0, paid: Number(row.paid) || 0 });
        }
      });
      return { ...prev, supplies: list };
    });

    // Refresh the fields
    const reset = {};
    suppliers.forEach((s) => {
      reset[s.id] = { mun: "", litre: "", rate: s.rate, paid: "", entryId: null };
    });
    setRows(reset);

    showToast("Supply entries saved");
  };

  const totalLitre = Object.values(rows).reduce((a, r) => a + (mode === "mun" ? litreFromMun(r.mun, settings.munKg, settings.density) : Number(r.litre) || 0), 0);
  const totalVal = Object.values(rows).reduce((a, r) => {
    const qty = mode === "mun" ? (Number(r.mun) || 0) : Number(r.litre) || 0;
    return a + qty * (Number(r.rate) || 0);
  }, 0);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Shift">
          <Select value={shift} onChange={(e) => setShift(e.target.value)}>
            <option>Morning</option><option>Evening</option>
          </Select>
        </Field>
        <Field label="Quantity by">
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="mun">Maund (weight)</option>
            <option value="litre">Litres (direct)</option>
          </Select>
        </Field>
        {mode === "mun" && <p className="text-[11.5px] pb-2" style={{ color: "var(--muted)" }}>1 mun = {settings.munKg}kg ÷ {settings.density} density → auto litres</p>}
      </div>

      {suppliers.length === 0 ? (
        <EmptyState icon={Truck} title="No suppliers yet" sub="Add suppliers from the Suppliers tab first." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <th className="py-2 pl-3 pr-2 font-medium w-14 text-center">S.No</th>
                  <th className="py-2 px-3 font-medium">Supplier</th>
                  {mode === "mun" ? <th className="font-medium w-24">Mun</th> : null}
                  {mode !== "mun" && <th className="font-medium w-28">Litre</th>}
                  <th className="font-medium px-2 w-24">{mode === "mun" ? "Rate / mun" : "Rate / L"}</th>
                  <th className="font-medium text-right px-6 w-32">Value</th>
                  <th className="font-medium pl-6 pr-3 w-32">Paid</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s, idx) => {
                  const row = rows[s.id] || {};
                  const litre = mode === "mun" ? litreFromMun(row.mun, settings.munKg, settings.density) : Number(row.litre) || 0;
                  const munQty = Number(row.mun) || 0;
                  const val = mode === "mun" ? munQty * (Number(row.rate) || 0) : litre * (Number(row.rate) || 0);
                  return (
                    <tr key={s.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <td className="py-2.5 pl-3 pr-2 text-center font-mono text-[12.5px]" style={{ color: "var(--muted)" }}>{idx + 1}</td>
                      <td className="py-2.5 px-3 font-medium" style={{ color: "var(--ink)" }}>{s.name}</td>
                      {mode === "mun" && <td className="px-2"><Input type="number" value={row.mun} onChange={(e) => updateRow(s.id, "mun", e.target.value)} placeholder="0" /></td>}
                      {mode !== "mun" && (
                        <td className="px-2">
                          <Input type="number" value={row.litre} onChange={(e) => updateRow(s.id, "litre", e.target.value)} placeholder="0" />
                        </td>
                      )}
                      <td className="px-2"><Input type="number" value={row.rate} onChange={(e) => updateRow(s.id, "rate", e.target.value)} /></td>
                      <td className="tnum text-right px-6 font-medium" style={{ color: "var(--ink)" }}>{fmtMoney(val, "")}</td>
                      <td className="pl-6 pr-3"><Input type="number" value={row.paid} onChange={(e) => updateRow(s.id, "paid", e.target.value)} placeholder="0" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4">
            <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
              Total: <span className="tnum font-medium" style={{ color: "var(--ink)" }}>{fmtNum(totalLitre)} L</span> · {fmtMoney(totalVal, settings.currency)}
            </p>
            <Btn onClick={saveAll}><Plus size={14} /> Save entries</Btn>
          </div>
        </>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Expenses                                                                */
/* ---------------------------------------------------------------------- */

function ExpensesPage({ state, setState, showToast }) {
  const { expenses = [], expenseCategories = [], settings } = state;
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayStr());
  const [editing, setEditing] = useState(null);

  const filtered = expenses.filter((e) => e.date >= from && e.date <= to).sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = filtered.reduce((a, e) => a + Number(e.amount || 0), 0);

  const byCategory = expenseCategories.map((cat) => ({
    cat, total: filtered.filter((e) => e.category === cat).reduce((a, e) => a + Number(e.amount || 0), 0),
  })).filter((c) => c.total > 0);

  const save = (data) => {
    setState((prev) => {
      const list = prev.expenses || [];
      if (data.id) return { ...prev, expenses: list.map((e) => e.id === data.id ? data : e) };
      return { ...prev, expenses: [...list, { ...data, id: uid() }] };
    });
    setEditing(null);
    showToast("Expense saved");
  };
  const remove = (id) => {
    setState((prev) => ({ ...prev, expenses: (prev.expenses || []).filter((e) => e.id !== id) }));
    showToast("Expense removed");
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Btn onClick={() => setEditing("new")} className="ml-auto"><Plus size={14} /> Add expense</Btn>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card className="p-4">
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>Total in range</p>
          <p className="tnum text-[20px] font-semibold mt-1" style={{ color: "var(--ink)" }}>{fmtMoney(total, settings.currency)}</p>
        </Card>
        <Card className="p-4 sm:col-span-2">
          <p className="text-[12px] mb-2" style={{ color: "var(--muted)" }}>By category</p>
          <div className="flex flex-wrap gap-2">
            {byCategory.length === 0 && <span className="text-[12.5px]" style={{ color: "var(--muted)" }}>No expenses in this range.</span>}
            {byCategory.map((c) => (
              <span key={c.cat} className="text-[12px] px-2 py-1 rounded" style={{ background: "var(--cream)", color: "var(--ink)" }}>
                {c.cat}: <span className="tnum font-medium">{fmtMoney(c.total, "")}</span>
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <EmptyState icon={Receipt} title="No expenses logged" sub="Add fuel, labor, packaging or other costs." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <th className="py-2.5 px-4 font-medium">Date</th><th className="font-medium">Category</th>
                  <th className="font-medium">Note</th><th className="font-medium text-right">Amount</th><th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 px-4 tnum">{fmtDate(e.date)}</td>
                    <td><Badge>{e.category}</Badge></td>
                    <td style={{ color: "var(--muted)" }}>{e.note || "—"}</td>
                    <td className="tnum text-right font-medium" style={{ color: "var(--ink)" }}>{fmtMoney(e.amount, settings.currency)}</td>
                    <td className="px-3">
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => setEditing(e)} className="p-1.5 rounded hover:opacity-60"><Pencil size={14} /></button>
                        <button onClick={() => remove(e.id)} className="p-1.5 rounded hover:opacity-60"><Trash2 size={14} style={{ color: "var(--danger)" }} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <ExpenseModal categories={expenseCategories} data={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ExpenseModal({ data, categories, onSave, onClose }) {
  const [f, setF] = useState(data || { date: todayStr(), category: categories[0] || "Other", note: "", amount: "" });
  return (
    <Modal title={data ? "Edit expense" : "Add expense"} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Category">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Note (optional)"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Bike fuel, ice blocks…" /></Field>
        <Field label="Amount"><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => f.amount && onSave({ ...f, amount: Number(f.amount) })}>Save</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* Customers                                                               */
/* ---------------------------------------------------------------------- */

function CustomersPage({ state, setState, showToast }) {
  const { customers, deliveries, areas, settings } = state;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // null | 'new' | customer obj
  const [reorderOpen, setReorderOpen] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const balances = useMemo(() => {
    const map = {};
    customers.forEach((c) => {
      const rows = withRunningBalance(deliveries.filter((d) => d.customerId === c.id), c.openingBalance, "delivery");
      map[c.id] = rows.length ? rows[rows.length - 1].balanceAfter : c.openingBalance;
    });
    return map;
  }, [customers, deliveries]);

  const filtered = customers.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.area.toLowerCase().includes(query.toLowerCase()));

  const save = (data) => {
    setState((prev) => {
      if (data.id) return { ...prev, customers: prev.customers.map((c) => c.id === data.id ? data : c) };
      return { ...prev, customers: [...prev.customers, { ...data, id: uid() }] };
    });
    setEditing(null);
    showToast("Customer saved");
  };
  const remove = (id) => {
    setState((prev) => ({ ...prev, customers: prev.customers.filter((c) => c.id !== id), deliveries: prev.deliveries.filter((d) => d.customerId !== id) }));
    showToast("Customer removed");
  };

  const reorderCustomers = (newList) => {
    setState((prev) => ({ ...prev, customers: newList }));
    showToast("Customer order saved");
  };

  const moveCustomerRelative = (c, direction) => {
    const curFilteredIdx = filtered.findIndex((x) => x.id === c.id);
    if (curFilteredIdx === -1) return;
    const targetFilteredIdx = curFilteredIdx + direction;
    if (targetFilteredIdx < 0 || targetFilteredIdx >= filtered.length) return;

    const targetCust = filtered[targetFilteredIdx];
    const fromIdx = customers.findIndex((x) => x.id === c.id);
    const toIdx = customers.findIndex((x) => x.id === targetCust.id);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

    const updated = [...customers];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    reorderCustomers(updated);
  };

  const handleDrop = (targetId) => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const fromIdx = customers.findIndex((x) => x.id === draggedId);
    const toIdx = customers.findIndex((x) => x.id === targetId);
    if (fromIdx !== -1 && toIdx !== -1) {
      const updated = [...customers];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, moved);
      reorderCustomers(updated);
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
          <Input placeholder="Search customers or areas…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <Btn variant="ghost" onClick={() => setReorderOpen(true)} title="Reorder the full customer sequence">
          <ArrowUpDown size={14} /> Reorder customers
        </Btn>
        <Btn onClick={() => setEditing("new")}><Plus size={14} /> Add customer</Btn>
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <EmptyState icon={Users} title="No customers found" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <th className="py-2.5 pl-3 pr-1 font-medium w-24">S.No</th>
                  <th className="py-2.5 px-3 font-medium">Name</th>
                  <th className="font-medium">Area</th>
                  <th className="font-medium">Default shift</th>
                  <th className="font-medium text-right">Rate</th>
                  <th className="font-medium text-right">Balance</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => {
                  const orderNum = customers.findIndex((x) => x.id === c.id) + 1;
                  const isDragging = draggedId === c.id;
                  const isDragOver = dragOverId === c.id;

                  return (
                    <tr
                      key={c.id}
                      draggable={true}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        setDraggedId(c.id);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverId !== c.id) setDragOverId(c.id);
                      }}
                      onDragLeave={() => {
                        if (dragOverId === c.id) setDragOverId(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDrop(c.id);
                      }}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setDragOverId(null);
                      }}
                      className={`border-b last:border-0 transition-all ${isDragging ? "opacity-35" : ""}`}
                      style={{
                        borderColor: isDragOver ? "var(--accent)" : "var(--border)",
                        background: isDragOver ? "rgba(217, 162, 59, 0.08)" : undefined,
                      }}
                    >
                      <td className="py-2 pl-3 pr-1">
                        <div className="flex items-center gap-1">
                          <span
                            className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-700 p-0.5"
                            title="Drag row to reorder"
                          >
                            <GripVertical size={14} />
                          </span>
                          <span className="text-[12px] font-mono text-gray-400 font-medium w-5 text-center shrink-0">
                            {orderNum}
                          </span>
                          <div className="flex flex-col ml-0.5">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={(e) => { e.stopPropagation(); moveCustomerRelative(c, -1); }}
                              className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed text-gray-600"
                              title="Move up"
                            >
                              <ChevronUp size={11} />
                            </button>
                            <button
                              type="button"
                              disabled={idx === filtered.length - 1}
                              onClick={(e) => { e.stopPropagation(); moveCustomerRelative(c, 1); }}
                              className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed text-gray-600"
                              title="Move down"
                            >
                              <ChevronDown size={11} />
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-medium" style={{ color: "var(--ink)" }}>{c.name}</td>
                      <td><Badge>{c.area}</Badge></td>
                      <td style={{ color: "var(--muted)" }}>{c.shift}</td>
                      <td className="tnum text-right">{fmtMoney(c.rate, "")}</td>
                      <td className="tnum text-right font-medium" style={{ color: balances[c.id] > 0 ? "var(--danger)" : "var(--good)" }}>{fmtMoney(balances[c.id], settings.currency)}</td>
                      <td className="px-3">
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => setEditing(c)} className="p-1.5 rounded hover:opacity-60" title="Edit customer"><Pencil size={14} /></button>
                          <button onClick={() => remove(c.id)} className="p-1.5 rounded hover:opacity-60" title="Delete customer"><Trash2 size={14} style={{ color: "var(--danger)" }} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <CustomerModal areas={areas} data={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
      {reorderOpen && (
        <CustomerReorderModal
          customers={customers}
          onSave={reorderCustomers}
          onClose={() => setReorderOpen(false)}
        />
      )}
    </div>
  );
}

function CustomerModal({ data, areas, onSave, onClose }) {
  const [f, setF] = useState(data || { name: "", area: areas[0] || "", shift: "Morning", rate: 240, phone: "", openingBalance: 0 });
  return (
    <Modal title={data ? "Edit customer" : "Add customer"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Area / Route">
            <Select value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>
              {areas.map((a) => <option key={a}>{a}</option>)}
            </Select>
          </Field>
          <Field label="Default shift">
            <Select value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })}>
              <option>Morning</option><option>Evening</option><option>Both</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default rate (per litre)"><Input type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: Number(e.target.value) })} /></Field>
          <Field label="Phone (optional)"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <Field label="Opening balance" hint="Any dues carried over before using this app"><Input type="number" value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: Number(e.target.value) })} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => f.name.trim() && onSave(f)}>Save</Btn>
        </div>
      </div>
    </Modal>
  );
}

function CustomerReorderModal({ customers, onSave, onClose }) {
  const [list, setList] = useState([...customers]);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const sortAlphabetical = () => {
    setList((prev) => [...prev].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const sortByArea = () => {
    setList((prev) =>
      [...prev].sort((a, b) => (a.area || "").localeCompare(b.area || "") || a.name.localeCompare(b.name))
    );
  };

  const moveItem = (index, delta) => {
    const newIdx = index + delta;
    if (newIdx < 0 || newIdx >= list.length) return;
    const updated = [...list];
    const [item] = updated.splice(index, 1);
    updated.splice(newIdx, 0, item);
    setList(updated);
  };

  const moveToEdge = (index, toTop) => {
    const updated = [...list];
    const [item] = updated.splice(index, 1);
    if (toTop) updated.unshift(item);
    else updated.push(item);
    setList(updated);
  };

  const handleDrop = (targetId) => {
    if (!draggedId || draggedId === targetId) return;
    const fromIdx = list.findIndex((c) => c.id === draggedId);
    const toIdx = list.findIndex((c) => c.id === targetId);
    if (fromIdx !== -1 && toIdx !== -1) {
      const updated = [...list];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, moved);
      setList(updated);
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <Modal title="Reorder Customers List" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          Set your preferred order for customers (such as your daily milk delivery route).
          This sequence determines how customers appear in <strong>Daily Entry</strong> and <strong>Customer</strong> lists.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border bg-neutral-50/50" style={{ borderColor: "var(--border)" }}>
          <span className="text-[12px] font-medium" style={{ color: "var(--ink-soft)" }}>Quick Organize:</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={sortAlphabetical}
              className="text-[12px] px-2.5 py-1 rounded border bg-white hover:bg-neutral-100 transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--ink)" }}
            >
              Alphabetical (A → Z)
            </button>
            <button
              type="button"
              onClick={sortByArea}
              className="text-[12px] px-2.5 py-1 rounded border bg-white hover:bg-neutral-100 transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--ink)" }}
            >
              Group by Area / Route
            </button>
          </div>
        </div>

        <div className="max-h-[52vh] overflow-y-auto space-y-1.5 pr-1">
          {list.map((c, idx) => (
            <div
              key={c.id}
              draggable={true}
              onDragStart={() => setDraggedId(c.id)}
              onDragOver={(e) => { e.preventDefault(); if (dragOverId !== c.id) setDragOverId(c.id); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(c.id); }}
              onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
              className={`flex items-center justify-between gap-3 p-2.5 rounded-md border transition-all ${
                draggedId === c.id ? "opacity-30" : ""
              } ${dragOverId === c.id ? "border-amber-500 bg-amber-50/60" : "bg-white"}`}
              style={{ borderColor: dragOverId === c.id ? "var(--accent)" : "var(--border)" }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-700">
                  <GripVertical size={16} />
                </span>
                <span className="text-[12px] font-mono font-medium text-gray-400 w-7 text-center shrink-0">
                  #{idx + 1}
                </span>
                <span className="font-medium text-[13.5px] truncate" style={{ color: "var(--ink)" }}>
                  {c.name}
                </span>
                {c.area && (
                  <Badge className="shrink-0">{c.area}</Badge>
                )}
                {c.shift && (
                  <span className="text-[11px] text-gray-400 shrink-0">({c.shift})</span>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveToEdge(idx, true)}
                  title="Move to top"
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed text-gray-600"
                >
                  <ChevronsUp size={14} />
                </button>
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveItem(idx, -1)}
                  title="Move up 1 position"
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed text-gray-600"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  disabled={idx === list.length - 1}
                  onClick={() => moveItem(idx, 1)}
                  title="Move down 1 position"
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed text-gray-600"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  disabled={idx === list.length - 1}
                  onClick={() => moveToEdge(idx, false)}
                  title="Move to bottom"
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed text-gray-600"
                >
                  <ChevronsDown size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <span className="text-[12px] text-gray-500">{list.length} customers</span>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn onClick={() => { onSave(list); onClose(); }}>
              <Check size={14} /> Save New Order
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* Suppliers                                                               */
/* ---------------------------------------------------------------------- */

function SuppliersPage({ state, setState, showToast }) {
  const { suppliers, supplies, settings } = state;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);

  const balances = useMemo(() => {
    const map = {};
    suppliers.forEach((s) => {
      const rows = withRunningBalance(supplies.filter((sp) => sp.supplierId === s.id), s.openingBalance, "supply");
      map[s.id] = rows.length ? rows[rows.length - 1].balanceAfter : s.openingBalance;
    });
    return map;
  }, [suppliers, supplies]);

  const filtered = suppliers.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));

  const save = (data) => {
    setState((prev) => {
      if (data.id) return { ...prev, suppliers: prev.suppliers.map((s) => s.id === data.id ? data : s) };
      return { ...prev, suppliers: [...prev.suppliers, { ...data, id: uid() }] };
    });
    setEditing(null);
    showToast("Supplier saved");
  };
  const remove = (id) => {
    setState((prev) => ({ ...prev, suppliers: prev.suppliers.filter((s) => s.id !== id), supplies: prev.supplies.filter((sp) => sp.supplierId !== id) }));
    showToast("Supplier removed");
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
          <Input placeholder="Search suppliers…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <Btn onClick={() => setEditing("new")}><Plus size={14} /> Add supplier</Btn>
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <EmptyState icon={Truck} title="No suppliers found" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <th className="py-2.5 px-4 font-medium">Name</th><th className="font-medium text-right">Rate (per mun)</th>
                  <th className="font-medium text-right">Balance</th><th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 px-4 font-medium" style={{ color: "var(--ink)" }}>{s.name}</td>
                    <td className="tnum text-right">{fmtMoney(s.rate, "")}</td>
                    <td className="tnum text-right font-medium" style={{ color: balances[s.id] > 0 ? "var(--danger)" : "var(--good)" }}>{fmtMoney(balances[s.id], settings.currency)}</td>
                    <td className="px-3">
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => setEditing(s)} className="p-1.5 rounded hover:opacity-60"><Pencil size={14} /></button>
                        <button onClick={() => remove(s.id)} className="p-1.5 rounded hover:opacity-60"><Trash2 size={14} style={{ color: "var(--danger)" }} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <SupplierModal data={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SupplierModal({ data, onSave, onClose }) {
  const [f, setF] = useState(data || { name: "", rate: 240, phone: "", openingBalance: 0 });
  return (
    <Modal title={data ? "Edit supplier" : "Add supplier"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default rate (per mun)"><Input type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: Number(e.target.value) })} /></Field>
          <Field label="Phone (optional)"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <Field label="Opening balance" hint="Any dues carried over before using this app"><Input type="number" value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: Number(e.target.value) })} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => f.name.trim() && onSave(f)}>Save</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* Ledger                                                                  */
/* ---------------------------------------------------------------------- */

function LedgerPage({ state, setState, showToast }) {
  const { customers, suppliers, deliveries, supplies, settings, areas = [] } = state;
  const [kind, setKind] = useState("customer");
  const [viewMode, setViewMode] = useState("individual"); // individual | route | total
  const list = kind === "customer" ? customers : suppliers;
  const [selectedId, setSelectedId] = useState(list[0]?.id || "");
  const [selectedRoute, setSelectedRoute] = useState(areas[0] || "");
  const [payOpen, setPayOpen] = useState(false);

  const [indivSearch, setIndivSearch] = useState("");
  const [routeSearch, setRouteSearch] = useState("");
  const [totalSearch, setTotalSearch] = useState("");

  useEffect(() => { setSelectedId(list[0]?.id || ""); }, [kind]);
  useEffect(() => { if (areas.length) setSelectedRoute(areas[0]); }, [areas]);
  useEffect(() => { setIndivSearch(""); }, [selectedId, kind]);

  // ── Individual helpers ───────────────────────────────────────────────
  const entity = list.find((x) => x.id === selectedId);
  const indivRows = entity
    ? withRunningBalance(
        kind === "customer"
          ? deliveries.filter((d) => d.customerId === entity.id)
          : supplies.filter((s) => s.supplierId === entity.id),
        entity.openingBalance,
        kind === "customer" ? "delivery" : "supply"
      )
    : [];
  const indivBalance = indivRows.length ? indivRows[indivRows.length - 1].balanceAfter : (entity?.openingBalance || 0);

  const filteredIndivRows = useMemo(() => {
    if (!indivSearch.trim()) return indivRows;
    const q = indivSearch.toLowerCase().trim();
    return indivRows.filter((r) => {
      const d = (r.date || "").toLowerCase();
      const formattedDate = fmtDate(r.date).toLowerCase();
      const shift = (r.shift || "").toLowerCase();
      const qty = String(r.mun || r.litre || "");
      const rate = String(r.rate || "");
      const gross = String(r.gross || "");
      const paidRec = String(kind === "customer" ? r.received : r.paid);
      const bal = String(r.balanceAfter || "");
      return (
        d.includes(q) ||
        formattedDate.includes(q) ||
        shift.includes(q) ||
        qty.includes(q) ||
        rate.includes(q) ||
        gross.includes(q) ||
        paidRec.includes(q) ||
        bal.includes(q)
      );
    });
  }, [indivRows, indivSearch, kind]);

  const recordPayment = (amount, date) => {
    setState((prev) => {
      if (kind === "customer") {
        return { ...prev, deliveries: [...prev.deliveries, { id: uid(), date, customerId: entity.id, shift: "-", litre: 0, rate: 0, received: Number(amount) }] };
      }
      return { ...prev, supplies: [...prev.supplies, { id: uid(), date, supplierId: entity.id, shift: "-", mode: "litre", mun: null, litre: 0, rate: 0, paid: Number(amount) }] };
    });
    setPayOpen(false);
    showToast("Payment recorded");
  };

  const removeEntry = (id) => {
    setState((prev) => kind === "customer"
      ? { ...prev, deliveries: prev.deliveries.filter((d) => d.id !== id) }
      : { ...prev, supplies: prev.supplies.filter((s) => s.id !== id) });
  };

  // ── Route helpers ────────────────────────────────────────────────────
  const routeCustomers = customers.filter((c) => c.area === selectedRoute);
  const routeSummaries = routeCustomers.map((c) => {
    const cRows = withRunningBalance(deliveries.filter((d) => d.customerId === c.id), c.openingBalance, "delivery");
    const bal = cRows.length ? cRows[cRows.length - 1].balanceAfter : (c.openingBalance || 0);
    return {
      ...c,
      bal,
      totalLitre: cRows.reduce((a, r) => a + (r.litre || 0), 0),
      totalGross: cRows.reduce((a, r) => a + (r.gross || 0), 0),
      totalReceived: cRows.reduce((a, r) => a + (Number(r.received) || 0), 0),
      txCount: cRows.length,
    };
  });
  const filteredRouteSummaries = useMemo(() => {
    if (!routeSearch.trim()) return routeSummaries;
    const q = routeSearch.toLowerCase().trim();
    return routeSummaries.filter((s) => (s.name || "").toLowerCase().includes(q) || (s.phone || "").toLowerCase().includes(q));
  }, [routeSummaries, routeSearch]);

  const displayRouteSummaries = routeSearch.trim() ? filteredRouteSummaries : routeSummaries;
  const displayRouteBal = displayRouteSummaries.reduce((a, s) => a + s.bal, 0);
  const displayRouteLitre = displayRouteSummaries.reduce((a, s) => a + s.totalLitre, 0);
  const displayRouteGross = displayRouteSummaries.reduce((a, s) => a + s.totalGross, 0);
  const displayRouteReceived = displayRouteSummaries.reduce((a, s) => a + s.totalReceived, 0);

  const routeTotalBal = routeSummaries.reduce((a, s) => a + s.bal, 0);
  const routeTotalLitre = routeSummaries.reduce((a, s) => a + s.totalLitre, 0);

  // ── Total helpers ────────────────────────────────────────────────────
  const totalSummaries = list.map((x) => {
    const xRows = withRunningBalance(
      kind === "customer" ? deliveries.filter((d) => d.customerId === x.id) : supplies.filter((s) => s.supplierId === x.id),
      x.openingBalance,
      kind === "customer" ? "delivery" : "supply"
    );
    const bal = xRows.length ? xRows[xRows.length - 1].balanceAfter : (x.openingBalance || 0);
    return {
      ...x,
      bal,
      totalLitre: xRows.reduce((a, r) => a + (r.litre || 0), 0),
      totalMun: xRows.reduce((a, r) => a + (r.mun || 0), 0),
      totalGross: xRows.reduce((a, r) => a + (r.gross || 0), 0),
      totalPaidReceived: xRows.reduce((a, r) => a + (Number(kind === "customer" ? r.received : r.paid) || 0), 0),
    };
  });
  const filteredTotalSummaries = useMemo(() => {
    if (!totalSearch.trim()) return totalSummaries;
    const q = totalSearch.toLowerCase().trim();
    return totalSummaries.filter((s) => {
      const name = (s.name || "").toLowerCase();
      const area = (s.area || "").toLowerCase();
      const phone = (s.phone || "").toLowerCase();
      return name.includes(q) || area.includes(q) || phone.includes(q);
    });
  }, [totalSummaries, totalSearch]);

  const displayTotalSummaries = totalSearch.trim() ? filteredTotalSummaries : totalSummaries;
  const displayBal = displayTotalSummaries.reduce((a, s) => a + s.bal, 0);
  const displayLitre = displayTotalSummaries.reduce((a, s) => a + s.totalLitre, 0);
  const displayMun = displayTotalSummaries.reduce((a, s) => a + (s.totalMun || 0), 0);
  const displayGross = displayTotalSummaries.reduce((a, s) => a + s.totalGross, 0);
  const displayPaidReceived = displayTotalSummaries.reduce((a, s) => a + s.totalPaidReceived, 0);

  const grandBal = totalSummaries.reduce((a, s) => a + s.bal, 0);
  const grandLitre = totalSummaries.reduce((a, s) => a + s.totalLitre, 0);

  const VIEW_TABS = [
    { id: "individual", label: "Individual" },
    { id: "route", label: "By Route" },
    { id: "total", label: "Total" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex gap-1.5">
          <Btn variant={kind === "customer" ? "primary" : "ghost"} onClick={() => setKind("customer")}><Users size={14} /> Customers</Btn>
          <Btn variant={kind === "supplier" ? "primary" : "ghost"} onClick={() => setKind("supplier")}><Truck size={14} /> Suppliers</Btn>
        </div>

        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {VIEW_TABS.map((vt, i) => (
            <button
              key={vt.id}
              onClick={() => setViewMode(vt.id)}
              className={`px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${i > 0 ? "border-l" : ""}`}
              style={{
                borderColor: "var(--border)",
                background: viewMode === vt.id ? "var(--sidebar)" : "transparent",
                color: viewMode === vt.id ? "#F3EBD8" : "var(--ink-soft)",
              }}
            >
              {vt.label}
            </button>
          ))}
        </div>

        {viewMode === "individual" && (
          <>
            <SearchableSelect
              items={list}
              value={selectedId}
              onChange={(id) => setSelectedId(id)}
              placeholder={kind === "customer" ? "Search customer…" : "Search supplier…"}
              className="min-w-[220px] max-w-[280px]"
            />
            {entity && <Btn variant="dark" onClick={() => setPayOpen(true)}><Wallet size={14} /> Record payment</Btn>}
          </>
        )}
        {viewMode === "route" && kind === "customer" && (
          <Select value={selectedRoute} onChange={(e) => setSelectedRoute(e.target.value)} className="max-w-[200px]">
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        )}
      </div>

      {viewMode === "individual" && (
        !entity ? <EmptyState icon={BookOpen} title={`No ${kind}s yet`} /> : (
          <>
            <Card className="p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[16px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>{entity.name}</p>
                <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>{kind === "customer" ? entity.area : "Supplier"} · rate {fmtMoney(entity.rate, settings.currency)}{kind === "customer" ? "/L" : "/mun"}</p>
              </div>
              <div className="text-right">
                <p className="text-[12px]" style={{ color: "var(--muted)" }}>{kind === "customer" ? "Outstanding to receive" : "Outstanding to pay"}</p>
                <p className="tnum text-[22px] font-semibold" style={{ color: indivBalance > 0 ? "var(--danger)" : "var(--good)" }}>{fmtMoney(indivBalance, settings.currency)}</p>
              </div>
            </Card>

            {indivRows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
                  <Input
                    placeholder="Search entries (date, shift, amount...)"
                    value={indivSearch}
                    onChange={(e) => setIndivSearch(e.target.value)}
                    className="pl-8 text-[13px]"
                  />
                  {indivSearch && (
                    <button
                      type="button"
                      onClick={() => setIndivSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:opacity-70"
                      style={{ color: "var(--muted)" }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                {indivSearch && (
                  <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                    Showing {filteredIndivRows.length} of {indivRows.length} entries
                  </span>
                )}
              </div>
            )}

            <Card className="overflow-hidden">
              {indivRows.length === 0 ? (
                <EmptyState icon={BookOpen} title="No transactions yet" />
              ) : filteredIndivRows.length === 0 ? (
                <EmptyState icon={Search} title="No matching entries" sub={`No entries match "${indivSearch}"`} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13.5px]">
                    <thead>
                      <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                        <th className="py-2.5 px-4 font-medium">Date</th>
                        <th className="font-medium">Shift</th>
                        <th className="font-medium text-right">{kind === "customer" ? "Litre" : "Mun"}</th>
                        <th className="font-medium text-right">{kind === "customer" ? "Rate / L" : "Rate / mun"}</th>
                        <th className="font-medium text-right">{kind === "customer" ? "Amount" : "Value"}</th>
                        <th className="font-medium text-right">{kind === "customer" ? "Received" : "Paid"}</th>
                        <th className="font-medium text-right">Balance</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredIndivRows.slice().reverse().map((r) => (
                        <tr key={r.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                          <td className="py-2 px-4 tnum">{fmtDate(r.date)}</td>
                          <td style={{ color: "var(--muted)" }}>{r.shift}</td>
                          <td className="tnum text-right">{kind === "customer" ? (r.litre ? fmtNum(r.litre) : "—") : (r.mun ? fmtNum(r.mun) : (r.litre ? fmtNum(r.litre) : "—"))}</td>
                          <td className="tnum text-right">{r.rate ? fmtMoney(r.rate, "") : "—"}</td>
                          <td className="tnum text-right">{fmtMoney(r.gross, "")}</td>
                          <td className="tnum text-right">{fmtMoney(kind === "customer" ? r.received : r.paid, "")}</td>
                          <td className="tnum text-right font-medium" style={{ color: r.balanceAfter > 0 ? "var(--danger)" : "var(--good)" }}>{fmtMoney(r.balanceAfter, "")}</td>
                          <td className="px-2"><button onClick={() => removeEntry(r.id)}><Trash2 size={13} style={{ color: "var(--danger)" }} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )
      )}

      {viewMode === "route" && kind === "customer" && (
        <>
          <Card className="p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[16px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>Route: {selectedRoute}</p>
              <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                {routeCustomers.length} customer{routeCustomers.length !== 1 ? "s" : ""} · {fmtNum(routeTotalLitre)} L delivered
              </p>
            </div>
            <div className="text-right">
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>Route outstanding</p>
              <p className="tnum text-[22px] font-semibold" style={{ color: routeTotalBal > 0 ? "var(--danger)" : "var(--good)" }}>{fmtMoney(routeTotalBal, settings.currency)}</p>
            </div>
          </Card>

          {routeSummaries.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
                <Input
                  placeholder="Search customers in this route…"
                  value={routeSearch}
                  onChange={(e) => setRouteSearch(e.target.value)}
                  className="pl-8 text-[13px]"
                />
                {routeSearch && (
                  <button
                    type="button"
                    onClick={() => setRouteSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:opacity-70"
                    style={{ color: "var(--muted)" }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              {routeSearch && (
                <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                  Showing {filteredRouteSummaries.length} of {routeSummaries.length} customers
                </span>
              )}
            </div>
          )}

          {routeSummaries.length === 0 ? (
            <EmptyState icon={Users} title="No customers in this route" sub="Add customers with this area in the Customers page." />
          ) : filteredRouteSummaries.length === 0 ? (
            <EmptyState icon={Search} title="No matching customers" sub={`No customers in this route match "${routeSearch}"`} />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                      <th className="py-2.5 px-4 font-medium">Customer</th>
                      <th className="font-medium text-right pr-4">Litres</th>
                      <th className="font-medium text-right pr-4">Gross Amount</th>
                      <th className="font-medium text-right pr-4">Received</th>
                      <th className="font-medium text-right pr-4">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRouteSummaries.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => { setSelectedId(s.id); setViewMode("individual"); }}
                        className="border-b hover:bg-[var(--cream)] transition-colors cursor-pointer"
                        title="Click to view individual ledger"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <td className="py-3 px-4">
                          <p className="font-medium" style={{ color: "var(--ink)" }}>{s.name}</p>
                          <p className="text-[11.5px]" style={{ color: "var(--muted)" }}>Rate {fmtMoney(s.rate, settings.currency)}/L · {s.txCount} entries</p>
                        </td>
                        <td className="tnum text-right pr-4">{fmtNum(s.totalLitre)} L</td>
                        <td className="tnum text-right pr-4">{fmtMoney(s.totalGross, settings.currency)}</td>
                        <td className="tnum text-right pr-4">{fmtMoney(s.totalReceived, settings.currency)}</td>
                        <td className="tnum text-right pr-4 font-semibold" style={{ color: s.bal > 0 ? "var(--danger)" : "var(--good)" }}>{fmtMoney(s.bal, settings.currency)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "var(--cream)", borderTop: "2px solid var(--border)" }}>
                      <td className="py-3 px-4 font-bold text-[13.5px]" style={{ color: "var(--ink)" }}>{routeSearch.trim() ? "Filtered Total" : "Route Total"}</td>
                      <td className="tnum text-right pr-4 font-bold">{fmtNum(displayRouteLitre)} L</td>
                      <td className="tnum text-right pr-4 font-bold">{fmtMoney(displayRouteGross, settings.currency)}</td>
                      <td className="tnum text-right pr-4 font-bold">{fmtMoney(displayRouteReceived, settings.currency)}</td>
                      <td className="tnum text-right pr-4 font-bold text-[15px]" style={{ color: displayRouteBal > 0 ? "var(--danger)" : "var(--good)" }}>{fmtMoney(displayRouteBal, settings.currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
      {viewMode === "route" && kind === "supplier" && (
        <Card className="p-6"><EmptyState icon={Truck} title="Route view is for customers only" sub="Suppliers are not grouped by route. Use Individual or Total view." /></Card>
      )}

      {viewMode === "total" && (
        <>
          <Card className="p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[16px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
                All {kind === "customer" ? "Customers" : "Suppliers"}
              </p>
              <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                {list.length} {kind}{list.length !== 1 ? "s" : ""} · {fmtNum(grandLitre)} L {kind === "customer" ? "delivered" : "received"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>{kind === "customer" ? "Total outstanding to receive" : "Total outstanding to pay"}</p>
              <p className="tnum text-[22px] font-semibold" style={{ color: grandBal > 0 ? "var(--danger)" : "var(--good)" }}>{fmtMoney(grandBal, settings.currency)}</p>
            </div>
          </Card>

          {totalSummaries.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
                <Input
                  placeholder={`Search ${kind === "customer" ? "customers or areas" : "suppliers"}…`}
                  value={totalSearch}
                  onChange={(e) => setTotalSearch(e.target.value)}
                  className="pl-8 text-[13px]"
                />
                {totalSearch && (
                  <button
                    type="button"
                    onClick={() => setTotalSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:opacity-70"
                    style={{ color: "var(--muted)" }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              {totalSearch && (
                <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                  Showing {filteredTotalSummaries.length} of {totalSummaries.length} {kind}s
                </span>
              )}
            </div>
          )}

          {totalSummaries.length === 0 ? (
            <EmptyState icon={BookOpen} title={`No ${kind}s yet`} />
          ) : filteredTotalSummaries.length === 0 ? (
            <EmptyState icon={Search} title="No results found" sub={`No ${kind}s match "${totalSearch}"`} />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                      <th className="py-2.5 px-4 font-medium">{kind === "customer" ? "Customer" : "Supplier"}</th>
                      {kind === "customer" && <th className="font-medium pr-4">Route</th>}
                      <th className="font-medium text-right pr-4">{kind === "customer" ? "Litres" : "Mun"}</th>
                      <th className="font-medium text-right pr-4">Gross Amount</th>
                      <th className="font-medium text-right pr-4">{kind === "customer" ? "Received" : "Paid"}</th>
                      <th className="font-medium text-right pr-4">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTotalSummaries.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => { setSelectedId(s.id); setViewMode("individual"); }}
                        className="border-b hover:bg-[var(--cream)] transition-colors cursor-pointer"
                        title="Click to view individual ledger"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <td className="py-3 px-4">
                          <p className="font-medium" style={{ color: "var(--ink)" }}>{s.name}</p>
                          <p className="text-[11.5px]" style={{ color: "var(--muted)" }}>Rate {fmtMoney(s.rate, settings.currency)}{kind === "customer" ? "/L" : "/mun"}</p>
                        </td>
                        {kind === "customer" && <td className="pr-4" style={{ color: "var(--muted)" }}>{s.area}</td>}
                        <td className="tnum text-right pr-4">{kind === "customer" ? `${fmtNum(s.totalLitre)} L` : `${fmtNum(s.totalMun || s.totalLitre)} Mun`}</td>
                        <td className="tnum text-right pr-4">{fmtMoney(s.totalGross, settings.currency)}</td>
                        <td className="tnum text-right pr-4">{fmtMoney(s.totalPaidReceived, settings.currency)}</td>
                        <td className="tnum text-right pr-4 font-semibold" style={{ color: s.bal > 0 ? "var(--danger)" : "var(--good)" }}>{fmtMoney(s.bal, settings.currency)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "var(--cream)", borderTop: "2px solid var(--border)" }}>
                      <td className="py-3 px-4 font-bold text-[13.5px]" style={{ color: "var(--ink)" }} colSpan={kind === "customer" ? 2 : 1}>{totalSearch.trim() ? "Filtered Total" : "Grand Total"}</td>
                      <td className="tnum text-right pr-4 font-bold">{kind === "customer" ? `${fmtNum(displayLitre)} L` : `${fmtNum(displayMun || displayLitre)} Mun`}</td>
                      <td className="tnum text-right pr-4 font-bold">{fmtMoney(displayGross, settings.currency)}</td>
                      <td className="tnum text-right pr-4 font-bold">{fmtMoney(displayPaidReceived, settings.currency)}</td>
                      <td className="tnum text-right pr-4 font-bold text-[15px]" style={{ color: displayBal > 0 ? "var(--danger)" : "var(--good)" }}>{fmtMoney(displayBal, settings.currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {payOpen && entity && <PaymentModal name={entity.name} kind={kind} onSave={recordPayment} onClose={() => setPayOpen(false)} />}
    </div>
  );
}

function PaymentModal({ name, kind, onSave, onClose }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  return (
    <Modal title={`Record payment · ${name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={kind === "customer" ? "Amount received" : "Amount paid"}>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => amount && onSave(Number(amount), date)}>Save</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* Profit & Loss                                                           */
/* ---------------------------------------------------------------------- */

function PnLRow({ label, value, currency, bold, indent, tone }) {
  return (
    <div className={`flex items-center justify-between py-2 ${bold ? "border-t mt-1 pt-2.5" : ""}`} style={bold ? { borderColor: "var(--border)" } : {}}>
      <span className={`text-[13.5px] ${indent ? "pl-3" : ""}`} style={{ color: bold ? "var(--ink)" : "var(--ink-soft)", fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span
        className="tnum text-[13.5px]"
        style={{ color: tone === "bad" ? "var(--danger)" : tone === "good" ? "var(--good)" : "var(--ink)", fontWeight: bold ? 700 : 500 }}
      >
        {value < 0 ? "-" : ""}{fmtMoney(Math.abs(value), currency)}
      </span>
    </div>
  );
}

function PnLPage({ state }) {
  const { deliveries, supplies, expenses = [], settings } = state;
  const [view, setView] = useState("daily"); // daily | monthly
  const [date, setDate] = useState(todayStr());
  const [month, setMonth] = useState(monthKey(todayStr()));

  const inScope = (d) => (view === "daily" ? d.date === date : monthKey(d.date) === month);

  const delR = deliveries.filter(inScope);
  const supR = supplies.filter(inScope);
  const expR = expenses.filter(inScope);

  const revenue = delR.reduce((a, r) => a + deliveryValue(r), 0);
  const cogs = supR.reduce((a, r) => a + supplyValue(r), 0);
  const grossProfit = revenue - cogs;
  const expenseByCat = {};
  expR.forEach((e) => { expenseByCat[e.category] = (expenseByCat[e.category] || 0) + Number(e.amount || 0); });
  const totalExpenses = expR.reduce((a, e) => a + Number(e.amount || 0), 0);
  const netProfit = grossProfit - totalExpenses;
  const litreSold = delR.reduce((a, r) => a + r.litre, 0);
  const litreSourced = supR.reduce((a, r) => a + r.litre, 0);
  const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  // daily breakdown table for monthly view
  const daysInMonth = useMemo(() => {
    if (view !== "monthly") return [];
    const [y, m] = month.split("-").map(Number);
    const count = new Date(y, m, 0).getDate();
    return Array.from({ length: count }).map((_, i) => {
      const d = `${month}-${String(i + 1).padStart(2, "0")}`;
      const rev = deliveries.filter((x) => x.date === d).reduce((a, r) => a + deliveryValue(r), 0);
      const cost = supplies.filter((x) => x.date === d).reduce((a, r) => a + supplyValue(r), 0);
      const exp = expenses.filter((x) => x.date === d).reduce((a, e) => a + Number(e.amount || 0), 0);
      return { date: d, rev, cost, exp, net: rev - cost - exp };
    }).filter((r) => r.rev || r.cost || r.exp);
  }, [view, month, deliveries, supplies, expenses]);

  // recent months for the dropdown
  const monthOptions = useMemo(() => {
    const set = new Set([monthKey(todayStr())]);
    [...deliveries, ...supplies, ...expenses].forEach((r) => set.add(monthKey(r.date)));
    return Array.from(set).sort().reverse();
  }, [deliveries, supplies, expenses]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="flex gap-1.5">
          <Btn variant={view === "daily" ? "primary" : "ghost"} onClick={() => setView("daily")}>Daily</Btn>
          <Btn variant={view === "monthly" ? "primary" : "ghost"} onClick={() => setView("monthly")}>Monthly</Btn>
        </div>
        {view === "daily" ? (
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        ) : (
          <Field label="Month">
            <Select value={month} onChange={(e) => setMonth(e.target.value)}>
              {monthOptions.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
            </Select>
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-1">
          <p className="text-[13px] font-semibold mb-1" style={{ color: "var(--ink)" }}>
            {view === "daily" ? fmtDate(date) : fmtMonth(month)}
          </p>
          <p className="text-[11.5px] mb-3" style={{ color: "var(--muted)" }}>{fmtNum(litreSold)} L sold · {fmtNum(litreSourced)} L sourced</p>

          <PnLRow label="Revenue (delivered)" value={revenue} currency={settings.currency} />
          <PnLRow label="Cost of milk (sourced)" value={-cogs} currency={settings.currency} indent />
          <PnLRow label="Gross profit" value={grossProfit} currency={settings.currency} bold tone={grossProfit >= 0 ? "good" : "bad"} />

          {Object.entries(expenseByCat).map(([cat, amt]) => (
            <PnLRow key={cat} label={cat} value={-amt} currency={settings.currency} indent />
          ))}
          {Object.keys(expenseByCat).length === 0 && (
            <p className="text-[12px] pl-3 py-1" style={{ color: "var(--muted)" }}>No expenses recorded</p>
          )}
          <PnLRow label="Total expenses" value={-totalExpenses} currency={settings.currency} />

          <PnLRow label="Net profit" value={netProfit} currency={settings.currency} bold tone={netProfit >= 0 ? "good" : "bad"} />
          <p className="text-[11.5px] mt-2" style={{ color: "var(--muted)" }}>Net margin: <span className="tnum font-medium" style={{ color: "var(--ink)" }}>{fmtNum(margin)}%</span> of revenue</p>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <p className="text-[13px] font-semibold mb-3" style={{ color: "var(--ink)" }}>
            {view === "daily" ? "How the day breaks down" : "Day-by-day this month"}
          </p>
          {view === "daily" ? (
            <div style={{ width: "100%", height: 230 }}>
              <ResponsiveContainer>
                <BarChart data={[{ name: "Today", Revenue: revenue, Cost: cogs, Expenses: totalExpenses, "Net profit": netProfit }]} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4DCC7" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#7A7261" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" hide />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Revenue" fill="#D9A441" radius={[0, 4, 4, 0]} barSize={26} />
                  <Bar dataKey="Cost" fill="#A13D2B" radius={[0, 4, 4, 0]} barSize={26} />
                  <Bar dataKey="Expenses" fill="#7A7261" radius={[0, 4, 4, 0]} barSize={26} />
                  <Bar dataKey="Net profit" fill="#2F6F4E" radius={[0, 4, 4, 0]} barSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : daysInMonth.length === 0 ? (
            <EmptyState icon={PieChart} title="No activity this month" />
          ) : (
            <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                    <th className="py-2 font-medium">Date</th><th className="font-medium text-right">Revenue</th>
                    <th className="font-medium text-right">Cost</th><th className="font-medium text-right">Expenses</th><th className="font-medium text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {daysInMonth.map((r) => (
                    <tr key={r.date} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <td className="py-1.5 tnum">{fmtDate(r.date)}</td>
                      <td className="tnum text-right">{fmtMoney(r.rev, "")}</td>
                      <td className="tnum text-right">{fmtMoney(r.cost, "")}</td>
                      <td className="tnum text-right">{fmtMoney(r.exp, "")}</td>
                      <td className="tnum text-right font-medium" style={{ color: r.net >= 0 ? "var(--good)" : "var(--danger)" }}>{fmtMoney(r.net, "")}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2">Total</td>
                    <td className="tnum text-right">{fmtMoney(revenue, "")}</td>
                    <td className="tnum text-right">{fmtMoney(cogs, "")}</td>
                    <td className="tnum text-right">{fmtMoney(totalExpenses, "")}</td>
                    <td className="tnum text-right" style={{ color: netProfit >= 0 ? "var(--good)" : "var(--danger)" }}>{fmtMoney(netProfit, "")}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Reports                                                                 */
/* ---------------------------------------------------------------------- */

function ReportsPage({ state }) {
  const { customers, suppliers, deliveries, supplies, areas, settings } = state;
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayStr());

  const inRange = (d) => d.date >= from && d.date <= to;
  const delR = deliveries.filter(inRange);
  const supR = supplies.filter(inRange);

  const byArea = areas.map((a) => {
    const rows = delR.filter((d) => customers.find((c) => c.id === d.customerId)?.area === a);
    return { area: a, litre: rows.reduce((s, r) => s + r.litre, 0), revenue: rows.reduce((s, r) => s + deliveryValue(r), 0) };
  });
  const bySupplier = suppliers.map((s) => {
    const rows = supR.filter((r) => r.supplierId === s.id);
    return { name: s.name, litre: rows.reduce((s2, r) => s2 + r.litre, 0), cost: rows.reduce((s2, r) => s2 + supplyValue(r), 0) };
  });

  const totalRevenue = delR.reduce((s, r) => s + deliveryValue(r), 0);
  const totalCost = supR.reduce((s, r) => s + supplyValue(r), 0);
  const totalDelivered = delR.reduce((s, r) => s + r.litre, 0);
  const totalSourced = supR.reduce((s, r) => s + r.litre, 0);

  const exportCsv = () => {
    const lines = [["Type", "Date", "Party", "Shift", "Qty", "Rate", "Value"].join(",")];
    delR.forEach((r) => lines.push(["Delivery", r.date, customers.find((c) => c.id === r.customerId)?.name || "", r.shift, r.litre, r.rate, deliveryValue(r)].join(",")));
    supR.forEach((r) => lines.push(["Supply", r.date, suppliers.find((s) => s.id === r.supplierId)?.name || "", r.shift, r.mun || r.litre, r.rate, supplyValue(r)].join(",")));
    (state.expenses || []).filter(inRange).forEach((e) => lines.push(["Expense", e.date, e.category, "-", "", "", e.amount].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `milk-report-${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Btn variant="ghost" onClick={exportCsv} className="ml-auto"><Download size={14} /> Export CSV</Btn>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4"><p className="text-[12px]" style={{ color: "var(--muted)" }}>Sourced</p><p className="tnum text-[19px] font-semibold mt-1">{fmtNum(totalSourced)} L</p></Card>
        <Card className="p-4"><p className="text-[12px]" style={{ color: "var(--muted)" }}>Delivered</p><p className="tnum text-[19px] font-semibold mt-1">{fmtNum(totalDelivered)} L</p></Card>
        <Card className="p-4"><p className="text-[12px]" style={{ color: "var(--muted)" }}>Revenue</p><p className="tnum text-[19px] font-semibold mt-1">{fmtMoney(totalRevenue, settings.currency)}</p></Card>
        <Card className="p-4"><p className="text-[12px]" style={{ color: "var(--muted)" }}>Margin</p><p className="tnum text-[19px] font-semibold mt-1" style={{ color: totalRevenue - totalCost >= 0 ? "var(--good)" : "var(--danger)" }}>{fmtMoney(totalRevenue - totalCost, settings.currency)}</p></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-[13px] font-semibold mb-3">By area / route</p>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={byArea}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4DCC7" vertical={false} />
                <XAxis dataKey="area" tick={{ fontSize: 11, fill: "#7A7261" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#7A7261" }} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="litre" fill="#D9A441" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-[13px] font-semibold mb-3">By supplier</p>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={bySupplier}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4DCC7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#7A7261" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#7A7261" }} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="litre" fill="#2F6F4E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Settings                                                                */
/* ---------------------------------------------------------------------- */

function SettingsPage({ state, setState, showToast }) {
  const { settings, areas, expenseCategories = [] } = state;
  const [local, setLocal] = useState(settings);
  const [newArea, setNewArea] = useState("");
  const [newCat, setNewCat] = useState("");
  const [machineId, setMachineId] = useState("");
  const [copiedMid, setCopiedMid] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (window.electronAPI?.getMachineId) {
      window.electronAPI.getMachineId().then(setMachineId).catch(() => {});
    } else {
      setMachineId("DEMO-7A8B-9C0D-1E2F");
    }
  }, []);

  const copyMachineId = () => {
    if (!machineId) return;
    navigator.clipboard.writeText(machineId).then(() => {
      setCopiedMid(true);
      setTimeout(() => setCopiedMid(false), 2000);
    });
  };

  const save = () => {
    setState((prev) => ({ ...prev, settings: local }));
    showToast("Settings saved");
  };
  const addArea = () => {
    if (!newArea.trim()) return;
    setState((prev) => ({ ...prev, areas: [...prev.areas, newArea.trim()] }));
    setNewArea("");
  };
  const removeArea = (a) => setState((prev) => ({ ...prev, areas: prev.areas.filter((x) => x !== a) }));
  const addCat = () => {
    if (!newCat.trim()) return;
    setState((prev) => ({ ...prev, expenseCategories: [...(prev.expenseCategories || []), newCat.trim()] }));
    setNewCat("");
  };
  const removeCat = (c) => setState((prev) => ({ ...prev, expenseCategories: (prev.expenseCategories || []).filter((x) => x !== c) }));

  const backup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `dairy-ledger-backup-${todayStr()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const backupExcel = () => {
    const { customers, suppliers, deliveries, supplies, expenses, settings, areas, expenseCategories } = state;
    const wb = XLSX.utils.book_new();

    // 1. Summary Sheet
    const totalDeliveryLitre = deliveries.reduce((a, r) => a + (r.litre || 0), 0);
    const totalDeliveryValue = deliveries.reduce((a, r) => a + (r.litre || 0) * (r.rate || 0), 0);
    const totalReceived      = deliveries.reduce((a, r) => a + (r.received || 0), 0);
    const customerBalanceDue = totalDeliveryValue - totalReceived;

    const totalSupplyMun   = supplies.reduce((a, r) => a + (r.mun || 0), 0);
    const totalSupplyLitre = supplies.reduce((a, r) => a + (r.litre || 0), 0);
    const totalSupplyValue = supplies.reduce((a, r) => {
      const qty = r.mun || r.litre || 0;
      return a + qty * (r.rate || 0);
    }, 0);
    const totalPaid        = supplies.reduce((a, r) => a + (r.paid || 0), 0);
    const supplierPayable  = totalSupplyValue - totalPaid;

    const totalExpenses = expenses.reduce((a, e) => a + (e.amount || 0), 0);
    const netProfit     = totalDeliveryValue - totalSupplyValue - totalExpenses;

    const summaryData = [
      { "Metric": "Export Date", "Value": todayStr() },
      { "Metric": "Total Registered Customers", "Value": customers.length },
      { "Metric": "Total Registered Suppliers", "Value": suppliers.length },
      { "Metric": "--- CUSTOMER SALES ---", "Value": "" },
      { "Metric": "Total Deliveries (Entries)", "Value": deliveries.length },
      { "Metric": "Total Milk Delivered (Litre)", "Value": totalDeliveryLitre },
      { "Metric": `Total Billed Sales (${settings.currency})`, "Value": totalDeliveryValue },
      { "Metric": `Total Cash Received (${settings.currency})`, "Value": totalReceived },
      { "Metric": `Customer Outstanding Due (${settings.currency})`, "Value": customerBalanceDue },
      { "Metric": "--- SUPPLIER PROCUREMENT ---", "Value": "" },
      { "Metric": "Total Supply Entries", "Value": supplies.length },
      { "Metric": "Total Milk Supplied (Mun)", "Value": totalSupplyMun },
      { "Metric": "Total Milk Supplied (Litre)", "Value": totalSupplyLitre },
      { "Metric": `Total Supply Cost (${settings.currency})`, "Value": totalSupplyValue },
      { "Metric": `Total Amount Paid to Suppliers (${settings.currency})`, "Value": totalPaid },
      { "Metric": `Supplier Outstanding Payable (${settings.currency})`, "Value": supplierPayable },
      { "Metric": "--- EXPENSES & MARGIN ---", "Value": "" },
      { "Metric": `Total Operating Expenses (${settings.currency})`, "Value": totalExpenses },
      { "Metric": `Estimated Gross Margin (${settings.currency})`, "Value": totalDeliveryValue - totalSupplyValue },
      { "Metric": `Estimated Net Profit (${settings.currency})`, "Value": netProfit },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary["!cols"] = [{ wch: 35 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    // 2. Deliveries (Customer Ledger)
    const deliveriesData = [...deliveries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => {
        const cust = customers.find((c) => c.id === r.customerId);
        const val = (r.litre || 0) * (r.rate || 0);
        return {
          "Date": r.date,
          "Customer Name": cust?.name || "Unknown",
          "Area / Route": cust?.area || "",
          "Shift": r.shift || "",
          "Litre": r.litre || 0,
          "Rate": r.rate || 0,
          "Total Value": val,
          "Amount Received": r.received || 0,
          "Balance": val - (r.received || 0),
        };
      });
    const wsDeliveries = XLSX.utils.json_to_sheet(deliveriesData.length ? deliveriesData : [{ "Date": "", "Customer Name": "No records" }]);
    wsDeliveries["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsDeliveries, "Customer Ledger");

    // 3. Supplies (Supplier Ledger)
    const suppliesData = [...supplies]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => {
        const supp = suppliers.find((s) => s.id === r.supplierId);
        const mun = r.mun || 0;
        const litre = r.litre || 0;
        const val = mun ? mun * (r.rate || 0) : litre * (r.rate || 0);
        return {
          "Date": r.date,
          "Supplier Name": supp?.name || "Unknown",
          "Shift": r.shift || "",
          "Mun": mun,
          "Litre": litre,
          "Rate (per mun)": r.rate || 0,
          "Total Value": val,
          "Amount Paid": r.paid || 0,
          "Balance": val - (r.paid || 0),
        };
      });
    const wsSupplies = XLSX.utils.json_to_sheet(suppliesData.length ? suppliesData : [{ "Date": "", "Supplier Name": "No records" }]);
    wsSupplies["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsSupplies, "Supplier Ledger");

    // 4. Customers Sheet
    const customersData = customers.map((c) => {
      const custDeliveries = deliveries.filter((d) => d.customerId === c.id);
      const totalLitre = custDeliveries.reduce((a, d) => a + (d.litre || 0), 0);
      const totalBilled = custDeliveries.reduce((a, d) => a + (d.litre || 0) * (d.rate || 0), 0);
      const totalRecv = custDeliveries.reduce((a, d) => a + (d.received || 0), 0);
      const balance = (c.openingBalance || 0) + totalBilled - totalRecv;
      return {
        "Name": c.name,
        "Area / Route": c.area || "",
        "Shift": c.shift || "",
        "Agreed Rate": c.rate || 0,
        "Phone": c.phone || "",
        "Opening Balance": c.openingBalance || 0,
        "Total Delivered (L)": totalLitre,
        "Total Billed": totalBilled,
        "Total Received": totalRecv,
        "Current Balance Due": balance,
      };
    });
    const wsCustomers = XLSX.utils.json_to_sheet(customersData.length ? customersData : [{ "Name": "No customers" }]);
    wsCustomers["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsCustomers, "Customers");

    // 5. Suppliers Sheet
    const suppliersData = suppliers.map((s) => {
      const suppSupplies = supplies.filter((x) => x.supplierId === s.id);
      const totalMun = suppSupplies.reduce((a, x) => a + (x.mun || 0), 0);
      const totalLitre = suppSupplies.reduce((a, x) => a + (x.litre || 0), 0);
      const totalBilled = suppSupplies.reduce((a, x) => {
        const qty = x.mun || x.litre || 0;
        return a + qty * (x.rate || 0);
      }, 0);
      const totalPaidSupp = suppSupplies.reduce((a, x) => a + (x.paid || 0), 0);
      const balance = (s.openingBalance || 0) + totalBilled - totalPaidSupp;
      return {
        "Name": s.name,
        "Agreed Rate (per mun)": s.rate || 0,
        "Phone": s.phone || "",
        "Opening Balance": s.openingBalance || 0,
        "Total Supplied (Mun)": totalMun,
        "Total Supplied (L)": totalLitre,
        "Total Billed": totalBilled,
        "Total Paid": totalPaidSupp,
        "Current Payable Balance": balance,
      };
    });
    const wsSuppliers = XLSX.utils.json_to_sheet(suppliersData.length ? suppliersData : [{ "Name": "No suppliers" }]);
    wsSuppliers["!cols"] = [{ wch: 22 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsSuppliers, "Suppliers");

    // 6. Expenses Sheet
    const expensesData = [...expenses]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({
        "Date": e.date,
        "Category": e.category,
        "Notes / Remarks": e.note || "",
        "Amount": e.amount || 0,
      }));
    const wsExpenses = XLSX.utils.json_to_sheet(expensesData.length ? expensesData : [{ "Date": "", "Category": "No expenses" }]);
    wsExpenses["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 30 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsExpenses, "Expenses");

    // 7. Settings Sheet
    const settingsData = [
      { "Setting": "Currency Symbol", "Value": settings.currency },
      { "Setting": "1 Mun in kg", "Value": settings.munKg },
      { "Setting": "Milk Density (kg/L)", "Value": settings.density },
      { "Setting": "Balance Alert Threshold", "Value": settings.alertThreshold },
      { "Setting": "Registered Areas", "Value": (areas || []).join(", ") },
      { "Setting": "Expense Categories", "Value": (expenseCategories || []).join(", ") },
    ];
    const wsSettings = XLSX.utils.json_to_sheet(settingsData);
    wsSettings["!cols"] = [{ wch: 25 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsSettings, "Settings");

    // Write file
    XLSX.writeFile(wb, `doodh-khata-export-${todayStr()}.xlsx`);
  };

  const backupCSV = () => {
    const { customers, suppliers, deliveries, supplies, expenses, settings, areas, expenseCategories } = state;
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [];

    // ── Section: Business Settings ──────────────────────────────────────────
    lines.push("SECTION: BUSINESS SETTINGS");
    lines.push(["Currency", "1 Mun (kg)", "Milk Density", "Alert Threshold"].join(","));
    lines.push([
      esc(settings.currency),
      settings.munKg,
      settings.density,
      settings.alertThreshold,
    ].join(","));
    lines.push("");

    // ── Section: Areas / Routes ─────────────────────────────────────────────
    lines.push("SECTION: AREAS / ROUTES");
    lines.push("Area Name");
    (areas || []).forEach((a) => lines.push(esc(a)));
    lines.push("");

    // ── Section: Customers ──────────────────────────────────────────────────
    lines.push("SECTION: CUSTOMERS");
    lines.push(["Name", "Area", "Shift", "Rate", "Phone", "Opening Balance"].join(","));
    customers.forEach((c) => lines.push([
      esc(c.name), esc(c.area), esc(c.shift),
      c.rate || 0, esc(c.phone), c.openingBalance || 0,
    ].join(",")));
    lines.push("");

    // ── Section: Suppliers ──────────────────────────────────────────────────
    lines.push("SECTION: SUPPLIERS");
    lines.push(["Name", "Rate (per mun)", "Phone", "Opening Balance"].join(","));
    suppliers.forEach((s) => lines.push([
      esc(s.name), s.rate || 0, esc(s.phone), s.openingBalance || 0,
    ].join(",")));
    lines.push("");

    // ── Section: Deliveries (Customer Ledger) ───────────────────────────────
    lines.push("SECTION: DELIVERIES (CUSTOMER LEDGER)");
    lines.push(["Date", "Customer", "Area", "Shift", "Litre", "Rate", "Value", "Received"].join(","));
    [...deliveries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((r) => {
        const cust = customers.find((c) => c.id === r.customerId);
        const value = (r.litre || 0) * (r.rate || 0);
        lines.push([
          r.date, esc(cust?.name || "Unknown"),
          esc(cust?.area || ""), esc(r.shift || ""),
          r.litre || 0, r.rate || 0, value, r.received || 0,
        ].join(","));
      });
    lines.push("");

    // ── Section: Supplies (Supplier Ledger) ─────────────────────────────────
    lines.push("SECTION: SUPPLIES (SUPPLIER LEDGER)");
    lines.push(["Date", "Supplier", "Shift", "Mun", "Rate (per mun)", "Value", "Paid"].join(","));
    [...supplies]
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((r) => {
        const supp = suppliers.find((s) => s.id === r.supplierId);
        const mun = r.mun || 0;
        const litre = r.litre || 0;
        const value = mun ? mun * (r.rate || 0) : litre * (r.rate || 0);
        lines.push([
          r.date, esc(supp?.name || "Unknown"),
          esc(r.shift || ""), mun,
          r.rate || 0, value, r.paid || 0,
        ].join(","));
      });
    lines.push("");

    // ── Section: Expenses ───────────────────────────────────────────────────
    lines.push("SECTION: EXPENSES");
    lines.push(["Date", "Category", "Note", "Amount"].join(","));
    [...expenses]
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((e) => lines.push([
        e.date, esc(e.category), esc(e.note || ""), e.amount || 0,
      ].join(",")));
    lines.push("");

    // ── Section: Expense Categories ─────────────────────────────────────────
    lines.push("SECTION: EXPENSE CATEGORIES");
    lines.push("Category Name");
    (expenseCategories || []).forEach((c) => lines.push(esc(c)));
    lines.push("");

    // ── Summary ─────────────────────────────────────────────────────────────
    const totalDeliveryValue = deliveries.reduce((a, r) => a + (r.litre || 0) * (r.rate || 0), 0);
    const totalReceived      = deliveries.reduce((a, r) => a + (r.received || 0), 0);
    const totalSupplyValue   = supplies.reduce((a, r) => {
      const qty = r.mun || r.litre || 0;
      return a + qty * (r.rate || 0);
    }, 0);
    const totalPaid          = supplies.reduce((a, r) => a + (r.paid || 0), 0);
    const totalExpenses      = expenses.reduce((a, e) => a + (e.amount || 0), 0);
    lines.push("SECTION: SUMMARY");
    lines.push(["Metric", "Value"].join(","));
    lines.push(["Total Customers", customers.length].join(","));
    lines.push(["Total Suppliers", suppliers.length].join(","));
    lines.push(["Total Delivery Transactions", deliveries.length].join(","));
    lines.push(["Total Delivery Value", totalDeliveryValue].join(","));
    lines.push(["Total Received from Customers", totalReceived].join(","));
    lines.push(["Total Supply Transactions", supplies.length].join(","));
    lines.push(["Total Supply Value", totalSupplyValue].join(","));
    lines.push(["Total Paid to Suppliers", totalPaid].join(","));
    lines.push(["Total Expenses", totalExpenses].join(","));
    lines.push(["Export Date", todayStr()].join(","));

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `doodh-khata-full-export-${todayStr()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const restoreBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed.customers && parsed.suppliers) {
          setState({
            expenses: [],
            expenseCategories: ["Transport / Fuel", "Labor", "Packaging", "Maintenance", "Rent", "Ice / Cooling", "Other"],
            ...parsed,
          });
          showToast("Data restored successfully!");
        } else {
          alert("Invalid backup file: Missing customer/supplier data.");
        }
      } catch (err) {
        alert("Failed to load backup file: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const openInstalledBackupFolder = async () => {
    if (window.electronAPI?.openBackupFolder) {
      await window.electronAPI.openBackupFolder();
    }
  };

  const checkInstalledBackup = async () => {
    if (window.electronAPI?.checkBackupImport) {
      const res = await window.electronAPI.checkBackupImport();
      if (res && res.success) {
        if (res.state) {
          setState({
            expenses: [],
            expenseCategories: ["Transport / Fuel", "Labor", "Packaging", "Maintenance", "Rent", "Ice / Cooling", "Other"],
            ...res.state,
          });
        }
        showToast(`Loaded backup: ${res.file}`);
      } else if (res && res.error) {
        alert("Failed to load backup: " + res.error);
      } else {
        alert("No new .json backup file found in the backup folder. Paste your backup file into the folder and click this button again.");
      }
    }
  };

  return (
    <div className="max-w-xl space-y-5">
      <Card className="p-5">
        <p className="text-[14px] font-semibold mb-4" style={{ color: "var(--ink)" }}>Business settings</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency symbol"><Input value={local.currency} onChange={(e) => setLocal({ ...local, currency: e.target.value })} /></Field>
            <Field label="Balance alert threshold"><Input type="number" value={local.alertThreshold} onChange={(e) => setLocal({ ...local, alertThreshold: Number(e.target.value) })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="1 Mun = (kg)" hint="Traditional maund weight"><Input type="number" value={local.munKg} onChange={(e) => setLocal({ ...local, munKg: Number(e.target.value) })} /></Field>
            <Field label="Milk density (kg/L)" hint="Used to convert weight → litres"><Input type="number" step="0.01" value={local.density} onChange={(e) => setLocal({ ...local, density: Number(e.target.value) })} /></Field>
          </div>
        </div>
        <div className="flex justify-end mt-4"><Btn onClick={save}>Save settings</Btn></div>
      </Card>

      <Card className="p-5">
        <p className="text-[14px] font-semibold mb-4" style={{ color: "var(--ink)" }}>Areas / routes</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {areas.map((a) => (
            <span key={a} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12.5px]" style={{ background: "var(--cream)", color: "var(--ink)" }}>
              {a} <button onClick={() => removeArea(a)}><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="New area name" />
          <Btn variant="ghost" onClick={addArea}><Plus size={14} /> Add</Btn>
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-[14px] font-semibold mb-4" style={{ color: "var(--ink)" }}>Expense categories</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {expenseCategories.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12.5px]" style={{ background: "var(--cream)", color: "var(--ink)" }}>
              {c} <button onClick={() => removeCat(c)}><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" />
          <Btn variant="ghost" onClick={addCat}><Plus size={14} /> Add</Btn>
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-[14px] font-semibold mb-2" style={{ color: "var(--ink)" }}>Backup & Data</p>
        <p className="text-[12.5px] mb-3" style={{ color: "var(--muted)" }}>Export multi-sheet Excel reports, JSON backups, or restore previous data.</p>
        <div className="flex flex-wrap gap-2">
          <Btn variant="ghost" onClick={backupExcel}><FileSpreadsheet size={14} /> Download Excel (.xlsx)</Btn>
          <Btn variant="ghost" onClick={backup}><Download size={14} /> Download backup (.json)</Btn>
          <Btn variant="ghost" onClick={backupCSV}><Download size={14} /> Download as CSV</Btn>
          <Btn variant="ghost" onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Restore from backup (.json)</Btn>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={restoreBackup} />
          {typeof window !== "undefined" && window.electronAPI && (
            <>
              <Btn variant="ghost" onClick={openInstalledBackupFolder} title="Open the backup folder in application install directory">
                <Folder size={14} /> Open Installed Backup Folder
              </Btn>
              <Btn variant="ghost" onClick={checkInstalledBackup} title="Load backup file placed in application backup folder">
                <RefreshCw size={14} /> Load from Backup Folder
              </Btn>
            </>
          )}
        </div>
        <div className="mt-3 p-2.5 rounded text-[12px] border" style={{ background: "var(--cream)", borderColor: "var(--border)", color: "var(--ink)" }}>
          💡 <strong>Offline Restore:</strong> You can paste any <code>.json</code> backup file into the application's <code>backup</code> folder in the installed path. When Doodh Khata starts, it will automatically detect and load it!
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--ink)" }}>License & Activation</p>
        <p className="text-[12.5px] mb-3" style={{ color: "var(--muted)" }}>Powered by <strong>IntegroOne Solutions</strong>. For full license activation, provide your Machine ID.</p>
        <div className="flex items-center justify-between p-3 rounded-lg border" style={{ background: "var(--cream)", borderColor: "var(--border)" }}>
          <div>
            <span className="text-[11px] block font-semibold text-gray-500 uppercase tracking-wider">Device Machine ID</span>
            <span className="font-mono text-[14px] font-bold tracking-wider" style={{ color: "var(--ink)" }}>{machineId || "Checking..."}</span>
          </div>
          <Btn variant="ghost" onClick={copyMachineId}>
            {copiedMid ? "Copied!" : "Copy Machine ID"}
          </Btn>
        </div>
      </Card>
    </div>
  );
}
