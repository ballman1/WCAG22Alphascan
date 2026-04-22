import { useState, useEffect, useCallback } from "react";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ── Config — replace with your Supabase project values ──────────────────────
const SUPABASE_URL     = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  navy:    "#0F1B35",
  teal:    "#0A7EA4",
  tealLt:  "#1AA3CC",
  green:   "#14B870",
  amber:   "#F59E0B",
  red:     "#EF4444",
  redLt:   "#FEE2E2",
  slate:   "#1E293B",
  slateMd: "#334155",
  slateL:  "#475569",
  border:  "#1E3A5F",
  bg:      "#060D1F",
  card:    "#0D1A30",
  cardHov: "#112240",
  white:   "#F0F6FF",
  dim:     "#64748B",
};

const IMPACT_COLORS = {
  critical: { bg: "#3B0A0A", border: "#EF4444", text: "#FCA5A5" },
  high:     { bg: "#2D1B00", border: "#F59E0B", text: "#FCD34D" },
  medium:   { bg: "#0C2340", border: "#3B82F6", text: "#93C5FD" },
  low:      { bg: "#0A2218", border: "#14B870", text: "#6EE7B7" },
};

const CERT_COLORS = {
  certified:     { bg: "#0A2218", border: "#14B870", text: "#6EE7B7", label: "CERTIFIED" },
  not_certified: { bg: "#3B0A0A", border: "#EF4444", text: "#FCA5A5", label: "NOT CERTIFIED" },
  conditional:   { bg: "#2D1B00", border: "#F59E0B", text: "#FCD34D", label: "CONDITIONAL" },
};

// ── Demo data (shown when Supabase not configured) ───────────────────────────
const DEMO = {
  clients: [
    { id: "1", name: "City of Springfield", domain: "springfield.gov", tier: "tier3", status: "active" },
    { id: "2", name: "Riverside Unified School District", domain: "rsd.edu", tier: "tier2", status: "active" },
    { id: "3", name: "Harbor Transit Authority", domain: "harbortransit.org", tier: "tier1", status: "active" },
  ],
  scans: [
    { id: "s1", client_id: "1", url: "https://springfield.gov", violations_count: 4, passes_count: 72, status: "complete", completed_at: "2026-04-18T10:22:00Z", duration_ms: 4210 },
    { id: "s2", client_id: "1", url: "https://springfield.gov/services", violations_count: 2, passes_count: 68, status: "complete", completed_at: "2026-04-18T10:24:00Z", duration_ms: 3980 },
    { id: "s3", client_id: "2", url: "https://rsd.edu", violations_count: 11, passes_count: 55, status: "complete", completed_at: "2026-04-17T14:05:00Z", duration_ms: 5100 },
    { id: "s4", client_id: "3", url: "https://harbortransit.org", violations_count: 0, passes_count: 84, status: "complete", completed_at: "2026-04-19T09:10:00Z", duration_ms: 3620 },
  ],
  violations: [
    { id: "v1", scan_id: "s1", client_id: "1", rule_id: "color-contrast", help: "Elements must meet minimum color contrast", impact: "critical", wcag_sc: "1.4.3", element_target: ".hero-banner h1", human_verified: false },
    { id: "v2", scan_id: "s1", client_id: "1", rule_id: "image-alt", help: "Images must have alternate text", impact: "critical", wcag_sc: "1.1.1", element_target: "img.agency-logo", human_verified: true },
    { id: "v3", scan_id: "s1", client_id: "1", rule_id: "label", help: "Form elements must have labels", impact: "high", wcag_sc: "1.3.1", element_target: "input#search", human_verified: false },
    { id: "v4", scan_id: "s2", client_id: "1", rule_id: "link-name", help: "Links must have discernible text", impact: "medium", wcag_sc: "2.4.4", element_target: "a.btn-more", human_verified: false },
    { id: "v5", scan_id: "s3", client_id: "2", rule_id: "color-contrast", help: "Elements must meet minimum color contrast", impact: "critical", wcag_sc: "1.4.3", element_target: "nav.main-nav a", human_verified: false },
    { id: "v6", scan_id: "s3", client_id: "2", rule_id: "heading-order", help: "Heading levels should only increase by one", impact: "medium", wcag_sc: "1.3.1", element_target: "h4.section-title", human_verified: false },
  ],
  certifications: [
    { id: "c1", client_id: "1", status: "not_certified", critical_count: 2, high_count: 1, medium_count: 1, low_count: 0, pages_tested: 2, issued_at: "2026-04-18T11:00:00Z", seal_token: "abc123demo" },
    { id: "c2", client_id: "2", status: "not_certified", critical_count: 5, high_count: 3, medium_count: 3, low_count: 0, pages_tested: 1, issued_at: "2026-04-17T15:00:00Z" },
    { id: "c3", client_id: "3", status: "certified",     critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, pages_tested: 1, issued_at: "2026-04-19T10:00:00Z", expires_at: "2027-04-19T10:00:00Z", seal_token: "xyz789demo" },
  ],
  deltaAlerts: [
    { id: "d1", client_id: "1", rule_id: "color-contrast", impact: "critical", url: "https://springfield.gov/news", element_target: "p.news-excerpt", resolved: false, created_at: "2026-04-20T08:00:00Z" },
  ],
};

const isDemoMode = SUPABASE_URL.includes("YOUR_PROJECT_REF");

// ── Hooks ────────────────────────────────────────────────────────────────────
function useData() {
  const [clients, setClients]   = useState([]);
  const [scans, setScans]       = useState([]);
  const [violations, setViolations] = useState([]);
  const [certs, setCerts]       = useState([]);
  const [deltas, setDeltas]     = useState([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    if (isDemoMode) {
      setClients(DEMO.clients);
      setScans(DEMO.scans);
      setViolations(DEMO.violations);
      setCerts(DEMO.certifications);
      setDeltas(DEMO.deltaAlerts);
      setLoading(false);
      return;
    }
    const [c, s, v, cert, d] = await Promise.all([
      supabase.from("clients").select("*").order("name"),
      supabase.from("scans").select("*").order("completed_at", { ascending: false }).limit(100),
      supabase.from("violations").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("certifications").select("*").order("issued_at", { ascending: false }),
      supabase.from("delta_alerts").select("*").eq("resolved", false).order("created_at", { ascending: false }),
    ]);
    setClients(c.data || []);
    setScans(s.data || []);
    setViolations(v.data || []);
    setCerts(cert.data || []);
    setDeltas(d.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return { clients, scans, violations, certs, deltas, loading, reload: load };
}

// ── Micro components ─────────────────────────────────────────────────────────
const Badge = ({ label, color }) => (
  <span style={{
    display: "inline-flex", alignItems: "center",
    padding: "2px 10px", borderRadius: 4,
    fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
    background: color.bg, border: `1px solid ${color.border}`,
    color: color.text, textTransform: "uppercase",
  }}>{label}</span>
);

const ImpactBadge = ({ impact }) => {
  const col = IMPACT_COLORS[impact] || IMPACT_COLORS.low;
  return <Badge label={impact} color={col} />;
};

const TierBadge = ({ tier }) => {
  const map = { tier1: { bg: "#0C2340", border: "#3B82F6", text: "#93C5FD" },
                tier2: { bg: "#1B1040", border: "#8B5CF6", text: "#C4B5FD" },
                tier3: { bg: "#0A2218", border: "#14B870", text: "#6EE7B7" } };
  return <Badge label={tier.replace("tier", "T")} color={map[tier] || map.tier1} />;
};

const Stat = ({ label, value, sub, accent }) => (
  <div style={{ flex: 1, padding: "18px 20px", background: C.card,
    border: `1px solid ${C.border}`, borderRadius: 8,
    borderTop: `3px solid ${accent || C.teal}` }}>
    <div style={{ fontSize: 28, fontWeight: 800, color: accent || C.white,
      fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 12, color: C.dim, marginTop: 4, textTransform: "uppercase",
      letterSpacing: "0.07em", fontWeight: 600 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: C.slateL, marginTop: 2 }}>{sub}</div>}
  </div>
);

// ── Views ────────────────────────────────────────────────────────────────────
function Overview({ clients, scans, violations, certs, deltas }) {
  const totalCritical = violations.filter(v => v.impact === "critical").length;
  const certified     = certs.filter(c => c.status === "certified").length;
  const unresolved    = deltas.filter(d => !d.resolved).length;

  const recentScans = scans.slice(0, 8);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <Stat label="Clients" value={clients.length} accent={C.teal} />
        <Stat label="Scans Run" value={scans.length} accent={C.tealLt} />
        <Stat label="Critical Issues" value={totalCritical} accent={C.red} />
        <Stat label="Certified" value={certified} sub={`of ${clients.length} clients`} accent={C.green} />
        <Stat label="Δ Alerts" value={unresolved} sub="unresolved" accent={unresolved > 0 ? C.amber : C.green} />
      </div>

      <SectionHead>Recent Scans</SectionHead>
      <Table headers={["URL", "Violations", "Passes", "Status", "Completed"]}>
        {recentScans.map(s => (
          <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}` }}>
            <Td><span style={{ color: C.tealLt, fontFamily: "monospace", fontSize: 12 }}>{s.url}</span></Td>
            <Td><span style={{ color: s.violations_count > 0 ? C.red : C.green, fontWeight: 700 }}>{s.violations_count}</span></Td>
            <Td><span style={{ color: C.green }}>{s.passes_count}</span></Td>
            <Td><StatusDot status={s.status} /></Td>
            <Td style={{ color: C.dim, fontSize: 12 }}>{s.completed_at ? new Date(s.completed_at).toLocaleString() : "—"}</Td>
          </tr>
        ))}
      </Table>

      {unresolved > 0 && (
        <>
          <SectionHead style={{ marginTop: 28 }}>⚠ Unresolved Delta Alerts (Tier 3)</SectionHead>
          <Table headers={["URL", "Rule", "Impact", "Detected"]}>
            {deltas.filter(d => !d.resolved).map(d => (
              <tr key={d.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <Td><span style={{ fontFamily: "monospace", fontSize: 12, color: C.tealLt }}>{d.url}</span></Td>
                <Td><code style={{ background: "#1E293B", padding: "2px 6px", borderRadius: 3, fontSize: 11 }}>{d.rule_id}</code></Td>
                <Td><ImpactBadge impact={d.impact} /></Td>
                <Td style={{ color: C.dim, fontSize: 12 }}>{new Date(d.created_at).toLocaleDateString()}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}

function ClientList({ clients, certs, violations, onSelect }) {
  return (
    <div>
      <SectionHead>Client Portfolio</SectionHead>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {clients.map(c => {
          const cert = certs.find(x => x.client_id === c.id);
          const clientViolations = violations.filter(v => v.client_id === c.id);
          const critical = clientViolations.filter(v => v.impact === "critical").length;
          const certCol  = cert ? CERT_COLORS[cert.status] : null;

          return (
            <div key={c.id}
              onClick={() => onSelect(c)}
              style={{ padding: "16px 20px", background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 8, cursor: "pointer", transition: "all 0.15s",
                display: "flex", alignItems: "center", justifyContent: "space-between" }}
              onMouseEnter={e => e.currentTarget.style.background = C.cardHov}
              onMouseLeave={e => e.currentTarget.style.background = C.card}>
              <div>
                <div style={{ fontWeight: 700, color: C.white, fontSize: 15 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{c.domain}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {critical > 0 && (
                  <span style={{ fontSize: 12, color: C.red, fontWeight: 700 }}>
                    {critical} critical
                  </span>
                )}
                <TierBadge tier={c.tier} />
                {cert && certCol && (
                  <Badge label={certCol.label} color={certCol} />
                )}
                <span style={{ color: C.slateL, fontSize: 18 }}>›</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClientDetail({ client, scans, violations, certs, deltas, onBack }) {
  const clientScans      = scans.filter(s => s.client_id === client.id);
  const clientViolations = violations.filter(v => v.client_id === client.id);
  const clientCert       = certs.find(c => c.client_id === client.id);
  const clientDeltas     = deltas.filter(d => d.client_id === client.id && !d.resolved);

  const byImpact = { critical: 0, high: 0, medium: 0, low: 0 };
  clientViolations.forEach(v => { if (byImpact[v.impact] !== undefined) byImpact[v.impact]++; });

  const certCol = clientCert ? CERT_COLORS[clientCert.status] : null;

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: `1px solid ${C.border}`,
        color: C.dim, padding: "6px 14px", borderRadius: 6, cursor: "pointer",
        marginBottom: 20, fontSize: 13 }}>← Back</button>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: C.white, margin: 0 }}>{client.name}</h2>
          <div style={{ color: C.tealLt, fontFamily: "monospace", fontSize: 13, marginTop: 4 }}>
            {client.domain}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <TierBadge tier={client.tier} />
            {certCol && clientCert && (
              <Badge label={certCol.label} color={certCol} />
            )}
          </div>
        </div>
        {clientCert && (
          <div style={{ padding: "14px 18px", background: certCol?.bg,
            border: `1px solid ${certCol?.border}`, borderRadius: 8, textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase",
              letterSpacing: "0.07em", marginBottom: 4 }}>AACP Certification</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: certCol?.text }}>
              {certCol?.label}
            </div>
            {clientCert.expires_at && (
              <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                Expires {new Date(clientCert.expires_at).toLocaleDateString()}
              </div>
            )}
            {clientCert.seal_token && (
              <div style={{ fontSize: 10, fontFamily: "monospace", color: C.slateL, marginTop: 6 }}>
                Seal: {clientCert.seal_token}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Impact Summary */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        {Object.entries(byImpact).map(([impact, count]) => {
          const col = IMPACT_COLORS[impact];
          return (
            <div key={impact} style={{ flex: "1 1 120px", padding: "14px 16px",
              background: col.bg, border: `1px solid ${col.border}`, borderRadius: 8 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: col.text,
                fontFamily: "monospace" }}>{count}</div>
              <div style={{ fontSize: 11, color: col.text, opacity: 0.8,
                textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600,
                marginTop: 4 }}>{impact}</div>
            </div>
          );
        })}
      </div>

      {/* Delta Alerts */}
      {clientDeltas.length > 0 && (
        <>
          <SectionHead style={{ color: C.amber }}>⚠ {clientDeltas.length} New Issue(s) Since Last Scan</SectionHead>
          <Table headers={["Rule", "Impact", "URL", "Element", "Detected"]}>
            {clientDeltas.map(d => (
              <tr key={d.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <Td><code style={{ background: "#1E293B", padding: "2px 6px", borderRadius: 3, fontSize: 11 }}>{d.rule_id}</code></Td>
                <Td><ImpactBadge impact={d.impact} /></Td>
                <Td style={{ fontFamily: "monospace", fontSize: 11, color: C.tealLt }}>{d.url}</Td>
                <Td style={{ fontFamily: "monospace", fontSize: 11, color: C.dim }}>{d.element_target}</Td>
                <Td style={{ color: C.dim, fontSize: 12 }}>{new Date(d.created_at).toLocaleDateString()}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {/* Violations */}
      <SectionHead style={{ marginTop: 20 }}>All Violations ({clientViolations.length})</SectionHead>
      {clientViolations.length === 0 ? (
        <div style={{ padding: "24px", textAlign: "center", color: C.green,
          background: "#0A2218", border: `1px solid #14B870`, borderRadius: 8 }}>
          ✓ No violations found — eligible for AACP certification
        </div>
      ) : (
        <Table headers={["Rule", "Impact", "WCAG SC", "Element", "Verified"]}>
          {clientViolations.map(v => (
            <tr key={v.id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <Td>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{v.help}</div>
                <code style={{ fontSize: 10, color: C.slateL }}>{v.rule_id}</code>
              </Td>
              <Td><ImpactBadge impact={v.impact} /></Td>
              <Td style={{ fontFamily: "monospace", fontSize: 12 }}>{v.wcag_sc || "—"}</Td>
              <Td style={{ fontFamily: "monospace", fontSize: 11, color: C.dim,
                maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap" }}>{v.element_target}</Td>
              <Td>
                {v.human_verified
                  ? <span style={{ color: C.green, fontSize: 12 }}>✓ Verified</span>
                  : <span style={{ color: C.amber, fontSize: 12 }}>⚡ Pending</span>}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {/* Scans */}
      <SectionHead style={{ marginTop: 20 }}>Scan History ({clientScans.length})</SectionHead>
      <Table headers={["URL", "Violations", "Passes", "Duration", "Completed"]}>
        {clientScans.map(s => (
          <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}` }}>
            <Td style={{ fontFamily: "monospace", fontSize: 12, color: C.tealLt }}>{s.url}</Td>
            <Td><span style={{ color: s.violations_count > 0 ? C.red : C.green, fontWeight: 700 }}>{s.violations_count}</span></Td>
            <Td style={{ color: C.green }}>{s.passes_count}</Td>
            <Td style={{ color: C.dim, fontSize: 12 }}>{s.duration_ms ? `${(s.duration_ms / 1000).toFixed(1)}s` : "—"}</Td>
            <Td style={{ color: C.dim, fontSize: 12 }}>{s.completed_at ? new Date(s.completed_at).toLocaleString() : "—"}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Shared layout primitives ──────────────────────────────────────────────────
const SectionHead = ({ children, style }) => (
  <h3 style={{ fontSize: 13, fontWeight: 700, color: C.teal, textTransform: "uppercase",
    letterSpacing: "0.09em", marginBottom: 10, marginTop: 0,
    paddingBottom: 6, borderBottom: `1px solid ${C.border}`, ...style }}>
    {children}
  </h3>
);

const Table = ({ headers, children }) => (
  <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.card, marginBottom: 16 }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: C.navy }}>
          {headers.map(h => (
            <th key={h} style={{ padding: "10px 14px", textAlign: "left",
              fontSize: 11, color: C.dim, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.07em",
              borderBottom: `1px solid ${C.border}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

const Td = ({ children, style }) => (
  <td style={{ padding: "10px 14px", color: C.white, verticalAlign: "middle", ...style }}>
    {children}
  </td>
);

const StatusDot = ({ status }) => {
  const map = { complete: C.green, running: C.amber, pending: C.dim, error: C.red };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%",
        background: map[status] || C.dim, display: "inline-block" }} />
      {status}
    </span>
  );
};

// ── Nav ───────────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "overview",  label: "Overview" },
  { id: "clients",   label: "Clients" },
];

// ── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { clients, scans, violations, certs, deltas, loading, reload } = useData();
  const [view, setView]     = useState("overview");
  const [selected, setSelected] = useState(null);

  const handleSelectClient = (client) => {
    setSelected(client);
    setView("client_detail");
  };

  const handleBack = () => {
    setSelected(null);
    setView("clients");
  };

  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif",
      background: C.bg, minHeight: "100vh", color: C.white }}>
      {/* Header */}
      <header style={{ background: C.navy, borderBottom: `1px solid ${C.border}`,
        padding: "0 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6,
            background: `linear-gradient(135deg, ${C.teal}, ${C.tealLt})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 900 }}>A</div>
          <div>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.02em" }}>
              AACP Scanner
            </span>
            <span style={{ marginLeft: 8, fontSize: 11, color: C.dim }}>
              Alphapointe Accessibility Certification
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {isDemoMode && (
            <span style={{ fontSize: 11, background: "#2D1B00",
              border: `1px solid ${C.amber}`, color: "#FCD34D",
              padding: "2px 10px", borderRadius: 4, fontWeight: 700 }}>
              DEMO MODE
            </span>
          )}
          <button onClick={reload} disabled={loading}
            style={{ background: C.teal, border: "none", color: "#fff",
              padding: "6px 14px", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 700, opacity: loading ? 0.6 : 1 }}>
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </header>

      {/* Nav */}
      <nav style={{ background: C.slate, borderBottom: `1px solid ${C.border}`,
        padding: "0 24px", display: "flex", gap: 0 }}>
        {NAV_ITEMS.map(item => (
          <button key={item.id} onClick={() => setView(item.id)}
            style={{ background: "none", border: "none",
              borderBottom: (view === item.id || (view === "client_detail" && item.id === "clients"))
                ? `2px solid ${C.teal}` : "2px solid transparent",
              color: view === item.id ? C.white : C.dim,
              padding: "12px 16px", cursor: "pointer", fontSize: 13,
              fontWeight: view === item.id ? 700 : 500, transition: "all 0.15s" }}>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Main */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: C.dim }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>◌</div>
            Loading scan data…
          </div>
        ) : (
          <>
            {view === "overview" && (
              <Overview clients={clients} scans={scans}
                violations={violations} certs={certs} deltas={deltas} />
            )}
            {view === "clients" && (
              <ClientList clients={clients} certs={certs}
                violations={violations} onSelect={handleSelectClient} />
            )}
            {view === "client_detail" && selected && (
              <ClientDetail client={selected} scans={scans}
                violations={violations} certs={certs}
                deltas={deltas} onBack={handleBack} />
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: "12px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 11, color: C.dim }}>
        <span>AACP Scanner — axe-core {!isDemoMode ? "live" : "demo"} · WCAG 2.2 AA</span>
        <span>Zero DOM modification · Zero tracking · Alphapointe</span>
      </footer>
    </div>
  );
}
