// Microsoft-branded deck: Proactive AKS Maintenance Handling
// Generated with pptxgenjs. Brand system: Segoe UI, four-square logo motif,
// Azure blue + Fluent neutrals.
const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Brandon Babcock";
pres.company = "Microsoft";
pres.title = "Proactive AKS Maintenance Handling";

// ---- Brand palette ----
const C = {
  navy: "0B2545",      // deep navy (title/close bg)
  navy2: "13315C",     // panel navy
  blue: "0078D4",      // Azure / Microsoft blue (primary)
  blueDk: "005A9E",
  blueLt: "DEECF9",    // light blue panel
  ink: "201F1E",       // Fluent gray 190 (body text)
  muted: "605E5C",     // Fluent gray 130 (muted)
  line: "D2D0CE",      // Fluent gray 60 (hairline)
  panel: "F3F2F1",     // Fluent gray 20 (light panel)
  white: "FFFFFF",
  // four-square brand colors
  red: "F25022",
  green: "7FBA00",
  cyan: "00A4EF",
  yellow: "FFB900",
  greenOk: "107C10",   // success green
};
const F = { h: "Segoe UI Semibold", b: "Segoe UI", light: "Segoe UI Light" };

const W = 13.333, H = 7.5, M = 0.6;
const shadow = () => ({ type: "outer", color: "000000", blur: 7, offset: 3, angle: 135, opacity: 0.16 });

// ---- Helpers ----
function fourSquare(slide, x, y, size, gap) {
  gap = gap == null ? size * 0.14 : gap;
  const s = (size - gap) / 2;
  const cells = [
    [x,        y,        C.red],
    [x + s + gap, y,        C.green],
    [x,        y + s + gap, C.cyan],
    [x + s + gap, y + s + gap, C.yellow],
  ];
  cells.forEach(([cx, cy, col]) =>
    slide.addShape(pres.shapes.RECTANGLE, { x: cx, y: cy, w: s, h: s, fill: { color: col }, line: { type: "none" } })
  );
}

function brandMark(slide, x, y, dark, mark) {
  mark = mark == null ? 0.34 : mark;
  fourSquare(slide, x, y, mark);
  slide.addText("Microsoft", {
    x: x + mark + 0.12, y: y - 0.06, w: 2.2, h: mark + 0.12,
    fontFace: F.b, fontSize: 16, color: dark ? C.white : C.ink,
    align: "left", valign: "middle", margin: 0,
  });
}

function contentHeader(slide, kicker, title) {
  slide.background = { color: C.white };
  slide.addText(kicker.toUpperCase(), {
    x: M, y: 0.42, w: 11, h: 0.32, fontFace: F.h, fontSize: 12.5,
    color: C.blue, charSpacing: 2.5, bold: true, margin: 0, align: "left",
  });
  slide.addText(title, {
    x: M, y: 0.72, w: W - 2 * M, h: 0.72, fontFace: F.h, fontSize: 30,
    color: C.ink, bold: true, margin: 0, align: "left", valign: "middle",
  });
  // top brand mark (small, right)
  fourSquare(slide, W - M - 0.3, 0.46, 0.3);
  // footer
  slide.addShape(pres.shapes.LINE, { x: M, y: H - 0.5, w: W - 2 * M, h: 0, line: { color: C.line, width: 1 } });
  slide.addText("Microsoft  ·  Azure Kubernetes Service", {
    x: M, y: H - 0.48, w: 7, h: 0.3, fontFace: F.b, fontSize: 9, color: C.muted, margin: 0, align: "left", valign: "middle",
  });
  slide.addText("Proactive AKS Maintenance Handling", {
    x: W - M - 5, y: H - 0.48, w: 5, h: 0.3, fontFace: F.b, fontSize: 9, color: C.muted, margin: 0, align: "right", valign: "middle",
  });
}

// numbered card helper
function card(slide, x, y, w, h, opts) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h, fill: { color: opts.fill || C.white },
    line: { color: opts.border || C.line, width: 1 }, shadow: opts.shadow ? shadow() : undefined,
  });
  if (opts.accent) {
    slide.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.08, h, fill: { color: opts.accent }, line: { type: "none" } });
  }
}

// ============================================================= S1 TITLE
(() => {
  const s = pres.addSlide();
  s.background = { color: C.navy };
  // subtle panel band
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.16, fill: { color: C.blue }, line: { type: "none" } });
  brandMark(s, M, 0.62, true, 0.4);

  s.addText("AZURE KUBERNETES SERVICE  ·  PLATFORM MAINTENANCE", {
    x: M, y: 2.35, w: 11, h: 0.36, fontFace: F.h, fontSize: 13.5, color: C.cyan,
    charSpacing: 3, bold: true, margin: 0, align: "left",
  });
  s.addText("Proactive AKS Maintenance Handling", {
    x: M, y: 2.72, w: 11.4, h: 1.5, fontFace: F.h, fontSize: 46, color: C.white,
    bold: true, margin: 0, align: "left", valign: "top",
  });
  s.addText("Detecting Azure platform maintenance and protecting workloads before impact", {
    x: M, y: 4.15, w: 10.6, h: 0.7, fontFace: F.light, fontSize: 20, color: "C8D6E8",
    margin: 0, align: "left",
  });

  // presenter strip
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: 6.15, w: 0.06, h: 0.78, fill: { color: C.blue }, line: { type: "none" } });
  s.addText([
    { text: "Brandon Babcock", options: { fontFace: F.h, fontSize: 15, color: C.white, bold: true, breakLine: true } },
    { text: "Azure AKS Subject-Matter Expert  ·  Microsoft", options: { fontFace: F.b, fontSize: 12, color: "AEC1DA" } },
  ], { x: M + 0.22, y: 6.1, w: 6, h: 0.9, margin: 0, align: "left", valign: "middle" });
  s.addText([
    { text: "Reference architecture & live demo", options: { fontFace: F.h, fontSize: 15, color: C.white, bold: true, breakLine: true } },
    { text: "Technical working session  ·  August 5, 2026", options: { fontFace: F.b, fontSize: 12, color: "AEC1DA" } },
  ], { x: W - M - 5, y: 6.1, w: 5, h: 0.9, margin: 0, align: "right", valign: "middle" });

  // large motif bottom-right
  fourSquare(s, W - 1.9, 0.7, 1.0, 0.16);
})();

// ============================================================= S2 CHALLENGE
(() => {
  const s = pres.addSlide();
  contentHeader(s, "The Challenge", "The problem platform teams hit today");

  const items = [
    [C.red, "Hardware redeployed out from under AKS", "Azure remediates degraded hosts by redeploying the VM instance — AKS is never given a chance to gracefully move workloads first."],
    [C.yellow, "Residual pod networking issues", "After the platform redeploy, pods are left with lingering network problems that require manual cleanup."],
    [C.cyan, "No proactive awareness", "Maintenance is discovered through ad-hoc audit runs and manual correlation — nodes stay schedulable when maintenance begins."],
    [C.green, "\u201CDegraded\u201D is ambiguous", "Resource Health fires \u201CDegraded\u201D even on a normal AKS scale-down — the documentation oversells what the signal means."],
  ];
  const cw = (W - 2 * M - 0.4) / 2, ch = 1.95, gx = 0.4, gy = 0.35;
  const x0 = M, y0 = 1.75;
  items.forEach((it, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = x0 + col * (cw + gx), y = y0 + row * (ch + gy);
    card(s, x, y, cw, ch, { accent: it[0], shadow: true });
    s.addShape(pres.shapes.OVAL, { x: x + 0.28, y: y + 0.28, w: 0.42, h: 0.42, fill: { color: it[0] }, line: { type: "none" } });
    s.addText(String(i + 1), { x: x + 0.28, y: y + 0.28, w: 0.42, h: 0.42, fontFace: F.h, fontSize: 16, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
    s.addText(it[1], { x: x + 0.9, y: y + 0.24, w: cw - 1.15, h: 0.55, fontFace: F.h, fontSize: 15.5, bold: true, color: C.ink, align: "left", valign: "middle", margin: 0 });
    s.addText(it[2], { x: x + 0.9, y: y + 0.8, w: cw - 1.15, h: ch - 1.0, fontFace: F.b, fontSize: 12, color: C.muted, align: "left", valign: "top", margin: 0 });
  });
})();

// ============================================================= S3 WHY IT HAPPENS
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Root Cause", "An AKS node is a VM in a Scale Set");

  // left: layered diagram
  const lx = M, ly = 1.8, lw = 6.0;
  const layers = [
    ["AKS cluster", "Managed control plane (Microsoft-operated)", C.blue],
    ["Node pool", "A Virtual Machine Scale Set (VMSS)", C.blueDk],
    ["VM instances", "Each node = one VMSS VM on a physical host", C.navy2],
  ];
  let yy = ly;
  layers.forEach((l, i) => {
    const h = 1.05, inset = i * 0.5;
    card(s, lx + inset, yy, lw - inset, h, { fill: i === 2 ? C.navy2 : C.panel, border: C.line });
    s.addShape(pres.shapes.RECTANGLE, { x: lx + inset, y: yy, w: 0.08, h, fill: { color: l[2] }, line: { type: "none" } });
    s.addText(l[0], { x: lx + inset + 0.28, y: yy + 0.14, w: lw - inset - 0.5, h: 0.4, fontFace: F.h, fontSize: 15, bold: true, color: i === 2 ? C.white : C.ink, margin: 0, valign: "middle" });
    s.addText(l[1], { x: lx + inset + 0.28, y: yy + 0.55, w: lw - inset - 0.5, h: 0.4, fontFace: F.b, fontSize: 11.5, color: i === 2 ? "C8D6E8" : C.muted, margin: 0, valign: "middle" });
    yy += h + 0.2;
  });
  s.addText("Platform maintenance targets the VM, not the pod.", {
    x: lx, y: yy + 0.05, w: lw, h: 0.4, fontFace: F.h, fontSize: 13, italic: true, color: C.red, margin: 0,
  });

  // right: explanation
  const rx = 7.2, rw = W - M - rx;
  s.addText("The control plane is managed. The nodes are not abstracted away.", {
    x: rx, y: 1.85, w: rw, h: 0.8, fontFace: F.h, fontSize: 18, bold: true, color: C.ink, margin: 0,
  });
  s.addText([
    { text: "Every node is a real VM subject to Azure platform maintenance:", options: { fontFace: F.b, fontSize: 13, color: C.ink, breakLine: true, paraSpaceAfter: 10 } },
    { text: "Freeze  \u2014  brief pause of the VM", options: { fontFace: F.b, fontSize: 13, color: C.ink, bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 6 } },
    { text: "Reboot  \u2014  host-initiated restart", options: { fontFace: F.b, fontSize: 13, color: C.ink, bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 6 } },
    { text: "Redeploy  \u2014  move to a healthy host (the painful one)", options: { fontFace: F.b, fontSize: 13, color: C.ink, bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 6 } },
    { text: "Terminate / Preempt  \u2014  instance removed (Spot)", options: { fontFace: F.b, fontSize: 13, color: C.ink, bullet: { indent: 18 }, breakLine: true } },
  ], { x: rx, y: 2.75, w: rw, h: 2.2, margin: 0, valign: "top" });
  card(s, rx, 5.15, rw, 1.5, { fill: C.blueLt, accent: C.blue });
  s.addText([
    { text: "Why it hurts:  ", options: { fontFace: F.h, fontSize: 12.5, bold: true, color: C.blueDk } },
    { text: "when Azure redeploys a degraded host, the VM disappears from under AKS. Kubernetes only finds out after the fact \u2014 so pods are killed ungracefully instead of being drained first.", options: { fontFace: F.b, fontSize: 12.5, color: C.ink } },
  ], { x: rx + 0.25, y: 5.3, w: rw - 0.45, h: 1.2, margin: 0, valign: "middle" });
})();

// ============================================================= S4 TWO SIGNALS
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Azure Signals", "Two signals \u2014 know which one to automate on");

  const cw = (W - 2 * M - 0.5) / 2, y0 = 1.75, ch = 3.7;
  // Scheduled Events (the automation signal)
  const ax = M;
  card(s, ax, y0, cw, ch, { fill: C.white, border: C.line, shadow: true });
  s.addShape(pres.shapes.RECTANGLE, { x: ax, y: y0, w: cw, h: 0.75, fill: { color: C.blue }, line: { type: "none" } });
  s.addText("Scheduled Events", { x: ax + 0.3, y: y0, w: cw - 1.6, h: 0.75, fontFace: F.h, fontSize: 18, bold: true, color: C.white, valign: "middle", margin: 0 });
  s.addText("AUTOMATE", { x: ax + cw - 1.5, y: y0 + 0.16, w: 1.25, h: 0.42, fontFace: F.h, fontSize: 11, bold: true, color: C.blue, align: "center", valign: "middle", fill: { color: C.white }, margin: 0 });
  s.addText([
    { text: "Delivered via IMDS  \u2014  169.254.169.254", options: { fontFace: F.b, fontSize: 12.5, color: C.ink, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: 8 } },
    { text: "Machine-readable, typed events per VM", options: { fontFace: F.b, fontSize: 12.5, color: C.ink, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: 8 } },
    { text: "Arrives BEFORE the action (~10\u201315 min)", options: { fontFace: F.b, fontSize: 12.5, color: C.ink, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: 8 } },
    { text: "Can be acknowledged to start early", options: { fontFace: F.b, fontSize: 12.5, color: C.ink, bullet: { indent: 16 }, breakLine: true } },
  ], { x: ax + 0.35, y: y0 + 1.0, w: cw - 0.7, h: 2.5, margin: 0, valign: "top" });
  s.addText("\u2192 The trigger for cordon / drain automation", { x: ax + 0.35, y: y0 + ch - 0.55, w: cw - 0.7, h: 0.4, fontFace: F.h, fontSize: 12, italic: true, bold: true, color: C.blueDk, margin: 0 });

  // Resource Health (alerting / audit)
  const bx = M + cw + 0.5;
  card(s, bx, y0, cw, ch, { fill: C.white, border: C.line, shadow: true });
  s.addShape(pres.shapes.RECTANGLE, { x: bx, y: y0, w: cw, h: 0.75, fill: { color: C.muted }, line: { type: "none" } });
  s.addText("Resource Health", { x: bx + 0.3, y: y0, w: cw - 1.6, h: 0.75, fontFace: F.h, fontSize: 18, bold: true, color: C.white, valign: "middle", margin: 0 });
  s.addText("ALERT / AUDIT", { x: bx + cw - 1.75, y: y0 + 0.16, w: 1.5, h: 0.42, fontFace: F.h, fontSize: 10, bold: true, color: C.muted, align: "center", valign: "middle", fill: { color: C.white }, margin: 0 });
  s.addText([
    { text: "ARM availabilityStatuses API", options: { fontFace: F.b, fontSize: 12.5, color: C.ink, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: 8 } },
    { text: "Human-facing health narrative", options: { fontFace: F.b, fontSize: 12.5, color: C.ink, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: 8 } },
    { text: "Available / Degraded / Unavailable", options: { fontFace: F.b, fontSize: 12.5, color: C.ink, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: 8 } },
    { text: "Noisy: \u201CDegraded\u201D also fires on scale-down", options: { fontFace: F.b, fontSize: 12.5, color: C.red, bullet: { indent: 16 }, breakLine: true } },
  ], { x: bx + 0.35, y: y0 + 1.0, w: cw - 0.7, h: 2.5, margin: 0, valign: "top" });
  s.addText("\u2192 Great for dashboards & audit, not as an automation trigger", { x: bx + 0.35, y: y0 + ch - 0.55, w: cw - 0.7, h: 0.4, fontFace: F.h, fontSize: 12, italic: true, bold: true, color: C.muted, margin: 0 });

  // takeaway strip
  card(s, M, 5.7, W - 2 * M, 0.95, { fill: C.navy, border: C.navy });
  s.addText([
    { text: "This is exactly the customer\u2019s pain point:  ", options: { fontFace: F.h, fontSize: 13, bold: true, color: C.yellow } },
    { text: "because \u201CDegraded\u201D also means \u201Cscaled down,\u201D you can\u2019t automate off it. We automate off Scheduled Events and use Resource Health for awareness.", options: { fontFace: F.b, fontSize: 13, color: C.white } },
  ], { x: M + 0.3, y: 5.7, w: W - 2 * M - 0.6, h: 0.95, margin: 0, valign: "middle" });
})();

// ============================================================= S5 SOLUTION LOOP
(() => {
  const s = pres.addSlide();
  contentHeader(s, "The Solution", "A closed loop: detect early, drain gracefully");

  const steps = [
    ["1", "Detect", "Read the maintenance signal for each node", C.blue],
    ["2", "Cordon", "Mark the node unschedulable at lead time", C.blueDk],
    ["3", "Drain", "Evict pods gracefully, honoring PodDisruptionBudgets", C.navy2],
    ["4", "Notify", "Push an alert to Teams / ServiceNow / Google Chat", C.green],
    ["5", "Recover", "Acknowledge Azure, uncordon after the host returns", C.cyan],
  ];
  const n = steps.length, gap = 0.35;
  const cw = (W - 2 * M - gap * (n - 1)) / n;
  const y = 2.15, ch = 3.0;
  steps.forEach((st, i) => {
    const x = M + i * (cw + gap);
    card(s, x, y, cw, ch, { fill: C.white, border: C.line, shadow: true });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.12, fill: { color: st[3] }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: x + cw / 2 - 0.42, y: y + 0.45, w: 0.84, h: 0.84, fill: { color: st[3] }, line: { type: "none" } });
    s.addText(st[0], { x: x + cw / 2 - 0.42, y: y + 0.45, w: 0.84, h: 0.84, fontFace: F.h, fontSize: 26, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
    s.addText(st[1], { x: x + 0.1, y: y + 1.45, w: cw - 0.2, h: 0.45, fontFace: F.h, fontSize: 16, bold: true, color: C.ink, align: "center", margin: 0 });
    s.addText(st[2], { x: x + 0.18, y: y + 1.92, w: cw - 0.36, h: 1.0, fontFace: F.b, fontSize: 11, color: C.muted, align: "center", valign: "top", margin: 0 });
    if (i < n - 1) {
      s.addShape(pres.shapes.CHEVRON, { x: x + cw + gap / 2 - 0.13, y: y + 0.72, w: 0.26, h: 0.3, fill: { color: C.line }, line: { type: "none" } });
    }
  });
  s.addText("The node never begins platform maintenance while it is still schedulable \u2014 that is the whole point.", {
    x: M, y: 5.55, w: W - 2 * M, h: 0.5, fontFace: F.h, fontSize: 14, italic: true, color: C.blueDk, align: "center", margin: 0,
  });
})();

// ============================================================= S6 ARCHITECTURE
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Architecture", "Two cooperating components on the cluster");

  const box = (x, y, w, h, fill, border, title, sub, titleCol, subCol) => {
    card(s, x, y, w, h, { fill, border });
    s.addText(title, { x: x + 0.15, y: y + 0.08, w: w - 0.3, h: h * 0.55, fontFace: F.h, fontSize: 12.5, bold: true, color: titleCol || C.white, align: "center", valign: "middle", margin: 0 });
    if (sub) s.addText(sub, { x: x + 0.1, y: y + h * 0.5, w: w - 0.2, h: h * 0.5, fontFace: F.b, fontSize: 9, color: subCol || "C8D6E8", align: "center", valign: "top", margin: 0 });
  };

  // Left: signal sources
  s.addText("AZURE PLATFORM", { x: M, y: 1.7, w: 2.6, h: 0.3, fontFace: F.h, fontSize: 10, bold: true, color: C.muted, charSpacing: 1.5, align: "center", margin: 0 });
  box(M, 2.05, 2.6, 0.95, C.blue, C.blue, "Scheduled Events", "IMDS 169.254.169.254", C.white, "DEECF9");
  box(M, 3.25, 2.6, 0.95, C.muted, C.muted, "Resource Health", "ARM availabilityStatuses", C.white, "EDEBE9");

  // Middle: components
  s.addText("ON THE CLUSTER", { x: 4.35, y: 1.7, w: 4.6, h: 0.3, fontFace: F.h, fontSize: 10, bold: true, color: C.muted, charSpacing: 1.5, align: "center", margin: 0 });
  box(4.35, 2.05, 4.6, 1.15, C.navy2, C.navy2, "maintenance-controller  (DaemonSet)", "One pod per node  \u00B7  cordon + drain  \u00B7  lead-time", C.white, "C8D6E8");
  box(4.35, 3.4, 4.6, 1.15, C.navy, C.navy, "maintenance-operator  (Deployment + PVC)", "poll  \u00B7  store  \u00B7  dedup  \u00B7  HW-notify  \u00B7  dashboard", C.white, "C8D6E8");

  // Right: outcomes
  s.addText("ACTIONS & OUTPUTS", { x: 10.05, y: 1.7, w: 2.7, h: 0.3, fontFace: F.h, fontSize: 10, bold: true, color: C.muted, charSpacing: 1.5, align: "center", margin: 0 });
  box(10.05, 2.05, 2.7, 0.8, C.panel, C.line, "Nodes cordoned / drained", null, C.ink);
  box(10.05, 3.0, 2.7, 0.8, C.blueLt, C.blue, "Logic App \u2192 Teams", "ServiceNow / Google Chat", C.blueDk, C.blueDk);
  box(10.05, 3.95, 2.7, 0.8, C.panel, C.line, "SQLite store + Dashboard", ":8080  /api", C.ink, C.muted);

  // arrows
  const arrow = (x1, y1, x2, y2, col) => s.addShape(pres.shapes.LINE, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: { color: col || C.blue, width: 2, endArrowType: "triangle" } });
  arrow(M + 2.6, 2.52, 4.35, 2.62, C.blue);       // sched -> controller
  arrow(M + 2.6, 3.72, 4.35, 3.97, C.muted);      // RH -> operator
  arrow(6.65, 3.4, 6.65, 3.2, C.yellow);          // operator -> controller (patch up)
  s.addText("patch node-event CM", { x: 6.75, y: 3.16, w: 2.0, h: 0.3, fontFace: F.b, fontSize: 8.5, italic: true, color: C.muted, margin: 0 });
  arrow(8.95, 2.55, 10.05, 2.45, C.navy2);        // controller -> nodes
  arrow(8.95, 3.9, 10.05, 3.4, C.blue);           // operator -> logic app
  arrow(8.95, 4.1, 10.05, 4.35, C.navy);          // operator -> store

  // caption band
  card(s, M, 5.35, W - 2 * M, 1.25, { fill: C.panel, accent: C.blue });
  s.addText([
    { text: "How they cooperate:  ", options: { fontFace: F.h, fontSize: 12.5, bold: true, color: C.blueDk } },
    { text: "the ", options: { fontFace: F.b, fontSize: 12.5, color: C.ink } },
    { text: "operator", options: { fontFace: F.h, fontSize: 12.5, bold: true, color: C.ink } },
    { text: " is the control plane \u2014 it polls subscriptions, persists and de-duplicates events, detects hardware failures and fans out notifications. The ", options: { fontFace: F.b, fontSize: 12.5, color: C.ink } },
    { text: "controller", options: { fontFace: F.h, fontSize: 12.5, bold: true, color: C.ink } },
    { text: " is the data plane \u2014 it runs on every node and performs the actual cordon and drain when its node is targeted.", options: { fontFace: F.b, fontSize: 12.5, color: C.ink } },
  ], { x: M + 0.3, y: 5.4, w: W - 2 * M - 0.6, h: 1.15, margin: 0, valign: "middle" });
})();

// ============================================================= S7 CONTROLLER
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Component 1 \u00B7 Data Plane", "maintenance-controller (DaemonSet)");

  const rx = M, rw = 6.4;
  s.addText([
    { text: "Runs one pod on every node", options: { fontFace: F.b, fontSize: 13.5, color: C.ink, bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 11 } },
    { text: "Watches the node\u2019s own maintenance signal (Scheduled Events via IMDS)", options: { fontFace: F.b, fontSize: 13.5, color: C.ink, bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 11 } },
    { text: "Cordons the node (marks it unschedulable)", options: { fontFace: F.b, fontSize: 13.5, color: C.ink, bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 11 } },
    { text: "Drains via the Eviction API \u2014 honors PodDisruptionBudgets", options: { fontFace: F.b, fontSize: 13.5, color: C.ink, bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 11 } },
    { text: "Lead-time scheduling: act at notBefore \u2212 leadSeconds", options: { fontFace: F.b, fontSize: 13.5, color: C.ink, bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 11 } },
    { text: "Acknowledges Azure last, so the platform starts only when we are ready", options: { fontFace: F.b, fontSize: 13.5, color: C.ink, bullet: { indent: 18 } } },
  ], { x: rx, y: 1.85, w: rw, h: 3.6, margin: 0, valign: "top" });

  // safety callout
  card(s, rx, 5.6, rw, 1.05, { fill: C.blueLt, accent: C.blue });
  s.addText([
    { text: "Safety by default:  ", options: { fontFace: F.h, fontSize: 12, bold: true, color: C.blueDk } },
    { text: "ships in observe-only mode, uses tightly-scoped RBAC, and only ever acts on its own node.", options: { fontFace: F.b, fontSize: 12, color: C.ink } },
  ], { x: rx + 0.25, y: 5.65, w: rw - 0.45, h: 0.95, margin: 0, valign: "middle" });

  // right: state machine chips
  const cx = 7.35, cw2 = W - M - cx;
  s.addText("Per-node state machine", { x: cx, y: 1.85, w: cw2, h: 0.4, fontFace: F.h, fontSize: 15, bold: true, color: C.ink, margin: 0 });
  const states = [
    ["Scheduled", "waiting for lead time", C.muted],
    ["Detected", "signal received", C.blue],
    ["Cordoned", "unschedulable", C.blueDk],
    ["Drained", "pods evicted safely", C.navy2],
    ["Complete", "acknowledged \u2192 recover", C.green],
  ];
  let yy = 2.4;
  states.forEach((st, i) => {
    card(s, cx, yy, cw2, 0.72, { fill: C.white, border: C.line });
    s.addShape(pres.shapes.OVAL, { x: cx + 0.2, y: yy + 0.19, w: 0.34, h: 0.34, fill: { color: st[2] }, line: { type: "none" } });
    s.addText(st[0], { x: cx + 0.7, y: yy, w: 2.0, h: 0.72, fontFace: F.h, fontSize: 13.5, bold: true, color: C.ink, valign: "middle", margin: 0 });
    s.addText(st[1], { x: cx + 2.6, y: yy, w: cw2 - 2.75, h: 0.72, fontFace: F.b, fontSize: 11, color: C.muted, valign: "middle", align: "right", margin: 0 });
    yy += 0.72 + 0.16;
    if (i < states.length - 1) s.addShape(pres.shapes.LINE, { x: cx + 0.37, y: yy - 0.16, w: 0, h: 0.16, line: { color: C.line, width: 1.5 } });
  });
})();

// ============================================================= S8 OPERATOR
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Component 2 \u00B7 Control Plane", "maintenance-operator (Deployment + PVC)");

  const feats = [
    [C.blue, "Subscription polling", "Sweeps the configured prod/dev subscription lists for maintenance signals \u2014 no per-node blind spots."],
    [C.blueDk, "Persistent store", "Normalized events + full action history in SQLite on a PersistentVolume; survives pod restarts and reschedules."],
    [C.green, "Deduplication", "Every event has a stable ID; repeats increment a counter instead of firing duplicate actions."],
    [C.red, "Hardware-failure detection", "Flags HardwareDegraded / HardwareFailure, pushes a Teams alert and drives the cordon \u2014 gated so a VMSS scale-in never false-triggers."],
    [C.cyan, "Operator dashboard + API", "Live HTML dashboard and JSON API on :8080 \u2014 upcoming actions, event log, health."],
    [C.yellow, "Drives the controller", "Patches the shared node-event ConfigMap so the right node cordons/drains at the right time."],
  ];
  const cw = (W - 2 * M - 0.8) / 3, ch = 2.05, gx = 0.4, gy = 0.35, x0 = M, y0 = 1.8;
  feats.forEach((f, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = x0 + col * (cw + gx), y = y0 + row * (ch + gy);
    card(s, x, y, cw, ch, { fill: C.white, border: C.line, shadow: true });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.1, fill: { color: f[0] }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: x + 0.28, y: y + 0.3, w: 0.36, h: 0.36, fill: { color: f[0] }, line: { type: "none" } });
    s.addText(f[1], { x: x + 0.78, y: y + 0.26, w: cw - 1.0, h: 0.5, fontFace: F.h, fontSize: 14, bold: true, color: C.ink, valign: "middle", margin: 0 });
    s.addText(f[2], { x: x + 0.28, y: y + 0.85, w: cw - 0.56, h: ch - 1.0, fontFace: F.b, fontSize: 11, color: C.muted, valign: "top", margin: 0 });
  });
})();

// ============================================================= S9 NOTIFICATIONS
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Notifications", "A vendor-neutral notification hub");

  // flow row
  const flow = [
    ["Controller / Operator", "emits a normalized event", C.navy2],
    ["Azure Logic App", "HTTP trigger \u2192 workflow", C.blue],
    ["Built-in Teams connector", "posts an Adaptive Card", C.blueDk],
    ["You", "direct message in Teams", C.green],
  ];
  const n = flow.length, gap = 0.6, cw = (W - 2 * M - gap * (n - 1)) / n, y = 2.05, ch = 1.7;
  flow.forEach((f, i) => {
    const x = M + i * (cw + gap);
    card(s, x, y, cw, ch, { fill: C.white, border: C.line, shadow: true });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.1, fill: { color: f[2] }, line: { type: "none" } });
    s.addText(f[0], { x: x + 0.15, y: y + 0.3, w: cw - 0.3, h: 0.7, fontFace: F.h, fontSize: 13.5, bold: true, color: C.ink, align: "center", valign: "middle", margin: 0 });
    s.addText(f[1], { x: x + 0.12, y: y + 1.0, w: cw - 0.24, h: 0.6, fontFace: F.b, fontSize: 10.5, color: C.muted, align: "center", valign: "top", margin: 0 });
    if (i < n - 1) s.addShape(pres.shapes.CHEVRON, { x: x + cw + gap / 2 - 0.15, y: y + ch / 2 - 0.15, w: 0.3, h: 0.3, fill: { color: C.blue }, line: { type: "none" } });
  });

  // swap panel
  card(s, M, 4.25, 6.1, 2.15, { fill: C.panel, accent: C.blue });
  s.addText("Swap the last hop, keep everything else", { x: M + 0.3, y: 4.45, w: 5.5, h: 0.4, fontFace: F.h, fontSize: 15, bold: true, color: C.ink, margin: 0 });
  s.addText([
    { text: "ServiceNow  \u2014  create incident / add work note", options: { fontFace: F.b, fontSize: 12.5, color: C.ink, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: 8 } },
    { text: "Google Chat  \u2014  post to a space", options: { fontFace: F.b, fontSize: 12.5, color: C.ink, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: 8 } },
    { text: "Teams  \u2014  Adaptive Card DM  (shown live today)", options: { fontFace: F.b, fontSize: 12.5, color: C.ink, bullet: { indent: 16 } } },
  ], { x: M + 0.3, y: 4.95, w: 5.5, h: 1.3, margin: 0, valign: "top" });

  // why panel
  card(s, M + 6.4, 4.25, W - 2 * M - 6.4, 2.15, { fill: C.navy, accent: C.yellow });
  s.addText("Why a Logic App?", { x: M + 6.7, y: 4.45, w: 5.2, h: 0.4, fontFace: F.h, fontSize: 15, bold: true, color: C.white, margin: 0 });
  s.addText([
    { text: "The cluster code stays vendor-neutral \u2014 it emits one event. Routing, formatting, retries and credentials live in the Logic App, so adding ServiceNow or Google Chat is configuration, not a code change.", options: { fontFace: F.b, fontSize: 12.5, color: "DDE6F2" } },
  ], { x: M + 6.7, y: 4.95, w: W - 2 * M - 6.4 - 0.6, h: 1.3, margin: 0, valign: "top" });
})();

// ============================================================= S10 CONCEPTS
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Reference", "Key Azure & Kubernetes concepts");

  const concepts = [
    ["IMDS", "Instance Metadata Service \u2014 non-routable 169.254.169.254 endpoint every VM can query"],
    ["Scheduled Events", "Typed, machine-readable maintenance notices delivered before the action"],
    ["Resource Health", "ARM view of a resource\u2019s availability \u2014 great for alerting, noisy for automation"],
    ["VMSS", "Virtual Machine Scale Set \u2014 the compute behind an AKS node pool"],
    ["Cordon", "Marks a node unschedulable; existing pods keep running"],
    ["Drain / Eviction API", "Gracefully evicts pods while respecting disruption limits"],
    ["PodDisruptionBudget", "Caps how many replicas can be down at once during a drain"],
    ["Workload Identity", "Federated Entra identity for pods \u2014 no secrets to poll Azure APIs"],
    ["Logic App", "Serverless workflow that turns an event into a notification action"],
    ["Adaptive Card", "Rich, actionable message format rendered natively in Teams"],
  ];
  const cols = 2, rows = 5;
  const cw = (W - 2 * M - 0.4) / cols, ch = 0.88, gx = 0.4, gy = 0.14, x0 = M, y0 = 1.7;
  concepts.forEach((c, i) => {
    const col = Math.floor(i / rows), row = i % rows;
    const x = x0 + col * (cw + gx), y = y0 + row * (ch + gy);
    card(s, x, y, cw, ch, { fill: i % 2 ? C.white : C.panel, border: C.line });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.08, h: ch, fill: { color: C.blue }, line: { type: "none" } });
    s.addText(c[0], { x: x + 0.25, y: y + 0.08, w: cw - 0.4, h: 0.34, fontFace: F.h, fontSize: 13, bold: true, color: C.blueDk, margin: 0 });
    s.addText(c[1], { x: x + 0.25, y: y + 0.42, w: cw - 0.45, h: 0.42, fontFace: F.b, fontSize: 10.5, color: C.muted, margin: 0, valign: "top" });
  });
})();

// ============================================================= S11 SCORECARD
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Coverage", "Every in-scope requirement \u2014 addressed");

  const rows = [
    ["Poll maintenance signals across subscriptions", "operator \u00B7 subscription poller"],
    ["Map VMSS instances \u2192 AKS clusters \u2192 node names", "controller + operator"],
    ["Persistent, normalized event store + audit history", "operator \u00B7 SQLite on PVC"],
    ["Deduplicate incoming events", "operator \u00B7 stable event IDs"],
    ["Schedule cordon at a configurable lead time", "controller \u00B7 leadSeconds"],
    ["Notify on hardware failures", "operator \u2192 Logic App \u2192 Teams"],
    ["Outbound notifications (ServiceNow / Google Chat)", "Logic App \u00B7 swap last hop"],
    ["Operator visibility \u2014 dashboard / API", "operator \u00B7 :8080 + /api"],
  ];
  // manual grid (LibreOffice mangles pptxgenjs addTable, so build with shapes)
  const tx = M, tw = W - 2 * M, y0 = 1.72;
  const cReq = 6.4, cStat = 1.0, cWhere = tw - cReq - cStat;
  const xReq = tx + 0.25, xStat = tx + cReq, xWhere = tx + cReq + cStat + 0.05;
  // header
  const hh = 0.5;
  s.addShape(pres.shapes.RECTANGLE, { x: tx, y: y0, w: tw, h: hh, fill: { color: C.navy }, line: { type: "none" } });
  s.addText("In-scope requirement", { x: xReq, y: y0, w: cReq - 0.4, h: hh, fontFace: F.h, fontSize: 13, bold: true, color: C.white, valign: "middle", margin: 0 });
  s.addText("Status", { x: xStat, y: y0, w: cStat, h: hh, fontFace: F.h, fontSize: 13, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
  s.addText("Where it lives", { x: xWhere, y: y0, w: cWhere - 0.4, h: hh, fontFace: F.h, fontSize: 13, bold: true, color: C.white, valign: "middle", margin: 0 });
  // rows
  const rh = 0.5, gap = 0.03;
  let yy = y0 + hh + gap;
  rows.forEach((r, i) => {
    s.addShape(pres.shapes.RECTANGLE, { x: tx, y: yy, w: tw, h: rh, fill: { color: i % 2 ? C.white : C.panel }, line: { color: C.line, width: 0.5 } });
    s.addText(r[0], { x: xReq, y: yy, w: cReq - 0.4, h: rh, fontFace: F.b, fontSize: 12, color: C.ink, valign: "middle", margin: 0 });
    s.addShape(pres.shapes.OVAL, { x: xStat + cStat / 2 - 0.16, y: yy + rh / 2 - 0.16, w: 0.32, h: 0.32, fill: { color: C.greenOk }, line: { type: "none" } });
    s.addText("\u2713", { x: xStat + cStat / 2 - 0.16, y: yy + rh / 2 - 0.16, w: 0.32, h: 0.32, fontFace: F.h, fontSize: 13, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
    s.addText(r[1], { x: xWhere, y: yy, w: cWhere - 0.4, h: rh, fontFace: F.b, fontSize: 11.5, color: C.muted, valign: "middle", margin: 0 });
    yy += rh + gap;
  });
  s.addText("8 of 8 in-scope requirements demonstrated live \u2014 nothing left as \u201Cfuture work\u201D for the walkthrough.", {
    x: M, y: yy + 0.08, w: W - 2 * M, h: 0.35, fontFace: F.h, fontSize: 12.5, italic: true, color: C.greenOk, align: "center", margin: 0,
  });
})();

// ============================================================= S12 DEMO FLOW
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Live Demo", "What you\u2019ll see \u2014 run of show");

  const acts = [
    ["Act 1", "Azure reality check", "Show the cluster, node pool = VMSS, and the live Scheduled Events / Resource Health endpoints.", C.blue],
    ["Act 2", "Safe, graceful drain", "Inject a maintenance event; watch cordon \u2192 drain honoring PDBs. demo.ps1", C.blueDk],
    ["Act 3", "A real platform signal", "Read Scheduled Events straight from IMDS on a node.", C.navy2],
    ["Act 4", "Hardware failure + alert", "HardwareFailure \u2192 cordon + Teams card fires. demo-hardware.ps1", C.red],
    ["Act 5", "Lead-time scheduling", "Event held in Scheduled state, then acts at window \u2212 lead. demo-leadtime.ps1", C.yellow],
    ["Act 6", "Operator dashboard", "Persisted events, dedup counters, upcoming actions at :8080.", C.green],
  ];
  const cw = (W - 2 * M - 0.8) / 3, ch = 2.0, gx = 0.4, gy = 0.35, x0 = M, y0 = 1.8;
  acts.forEach((a, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = x0 + col * (cw + gx), y = y0 + row * (ch + gy);
    card(s, x, y, cw, ch, { fill: C.white, border: C.line, shadow: true });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 1.15, h: 0.5, fill: { color: a[3] }, line: { type: "none" } });
    s.addText(a[0], { x, y, w: 1.15, h: 0.5, fontFace: F.h, fontSize: 13, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
    s.addText(a[1], { x: x + 1.3, y: y + 0.02, w: cw - 1.45, h: 0.5, fontFace: F.h, fontSize: 13.5, bold: true, color: C.ink, valign: "middle", margin: 0 });
    s.addText(a[2], { x: x + 0.25, y: y + 0.68, w: cw - 0.5, h: ch - 0.85, fontFace: F.b, fontSize: 11.5, color: C.muted, valign: "top", margin: 0 });
  });
})();

// ============================================================= S13 REAL VS SIM
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Transparency", "Real vs. simulated \u2014 no hand-waving");

  const cw = (W - 2 * M - 0.5) / 2, y0 = 1.8, ch = 4.15;
  // Real
  card(s, M, y0, cw, ch, { fill: C.white, border: C.line, shadow: true });
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: y0, w: cw, h: 0.7, fill: { color: C.greenOk }, line: { type: "none" } });
  s.addText("Production-identical (real)", { x: M + 0.3, y: y0, w: cw - 0.6, h: 0.7, fontFace: F.h, fontSize: 16, bold: true, color: C.white, valign: "middle", margin: 0 });
  s.addText([
    "Scheduled Events & Resource Health API calls",
    "Cordon via the Kubernetes API",
    "Drain via the Eviction API (honors PDBs)",
    "Logic App \u2192 Teams Adaptive Card delivery",
    "Persistent store, dedup, action history",
    "Operator dashboard & JSON API",
  ].map((t, i, arr) => ({ text: t, options: { fontFace: F.b, fontSize: 13, color: C.ink, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: i < arr.length - 1 ? 10 : 0 } })),
    { x: M + 0.35, y: y0 + 0.95, w: cw - 0.7, h: ch - 1.1, margin: 0, valign: "top" });

  // Simulated
  const bx = M + cw + 0.5;
  card(s, bx, y0, cw, ch, { fill: C.white, border: C.line, shadow: true });
  s.addShape(pres.shapes.RECTANGLE, { x: bx, y: y0, w: cw, h: 0.7, fill: { color: C.muted }, line: { type: "none" } });
  s.addText("Injected for the demo (simulated)", { x: bx + 0.3, y: y0, w: cw - 0.6, h: 0.7, fontFace: F.h, fontSize: 16, bold: true, color: C.white, valign: "middle", margin: 0 });
  s.addText([
    "The event content (we inject it via a ConfigMap instead of waiting hours for Azure to schedule real maintenance)",
    "The subscription-poll source list",
    "The target node selection, so the demo is repeatable",
  ].map((t, i, arr) => ({ text: t, options: { fontFace: F.b, fontSize: 13, color: C.ink, bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: i < arr.length - 1 ? 12 : 0 } })),
    { x: bx + 0.35, y: y0 + 0.95, w: cw - 0.7, h: 2.3, margin: 0, valign: "top" });
  card(s, bx + 0.35, y0 + ch - 1.15, cw - 0.7, 0.9, { fill: C.blueLt, accent: C.blue });
  s.addText([
    { text: "Everything downstream of the event \u2014 the detection, cordon, drain, notify and store \u2014 is exactly what runs in production.", options: { fontFace: F.h, fontSize: 12, italic: true, color: C.blueDk } },
  ], { x: bx + 0.55, y: y0 + ch - 1.1, w: cw - 1.1, h: 0.8, margin: 0, valign: "middle" });
})();

// ============================================================= S14 HARDENING
(() => {
  const s = pres.addSlide();
  contentHeader(s, "Path to Production", "From demo to a supported service");

  const items = [
    [C.blue, "Real signal sources", "Point the operator poller at live Resource Health per subscription; keep Scheduled Events for the automation trigger."],
    [C.blueDk, "Workload Identity", "Federated Entra identity for the pods \u2014 no secrets, least-privilege access to Azure APIs."],
    [C.green, "Managed store", "Swap SQLite/PVC for Azure SQL, Cosmos DB, or Log Analytics for durability and query."],
    [C.cyan, "System node pool", "Run the operator on a dedicated system pool so it is never evicted by the drain it triggered."],
    [C.yellow, "Real ITSM actions", "Wire the Logic App to your ServiceNow instance and Google Chat space."],
    [C.red, "Compare to built-ins", "Position against Node Problem Detector and node auto-repair; this fills the proactive, pre-impact gap."],
  ];
  const cw = (W - 2 * M - 0.8) / 3, ch = 2.05, gx = 0.4, gy = 0.35, x0 = M, y0 = 1.8;
  items.forEach((it, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = x0 + col * (cw + gx), y = y0 + row * (ch + gy);
    card(s, x, y, cw, ch, { fill: C.white, border: C.line, shadow: true });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.1, fill: { color: it[0] }, line: { type: "none" } });
    s.addText(it[1], { x: x + 0.28, y: y + 0.28, w: cw - 0.56, h: 0.5, fontFace: F.h, fontSize: 14.5, bold: true, color: C.ink, valign: "top", margin: 0 });
    s.addText(it[2], { x: x + 0.28, y: y + 0.85, w: cw - 0.56, h: ch - 1.0, fontFace: F.b, fontSize: 11.5, color: C.muted, valign: "top", margin: 0 });
  });
})();

// ============================================================= S15 NEXT STEPS
(() => {
  const s = pres.addSlide();
  contentHeader(s, "The Ask", "Proposed next steps");

  const steps = [
    ["Share the reference", "We hand over the demo, runbook and this architecture as a starting point \u2014 you are not building from zero."],
    ["Point at a non-prod subscription", "Deploy read-only/observe mode against a dev cluster and validate signals on your real node pools."],
    ["Flip the poller to live Resource Health", "Confirm what \u201CDegraded\u201D looks like in your environment and tune what we act on."],
    ["Integrate your ITSM", "Wire the Logic App to ServiceNow / Google Chat for real incident and channel notifications."],
    ["Investigate residual pod networking in parallel", "Provide an SME to root-cause the post-redeploy network issue \u2014 the deeper original concern."],
  ];
  const y0 = 1.8, rh = 0.86, gap = 0.12;
  steps.forEach((st, i) => {
    const y = y0 + i * (rh + gap);
    card(s, M, y, W - 2 * M, rh, { fill: i % 2 ? C.white : C.panel, border: C.line });
    s.addShape(pres.shapes.OVAL, { x: M + 0.25, y: y + rh / 2 - 0.27, w: 0.54, h: 0.54, fill: { color: C.blue }, line: { type: "none" } });
    s.addText(String(i + 1), { x: M + 0.25, y: y + rh / 2 - 0.27, w: 0.54, h: 0.54, fontFace: F.h, fontSize: 18, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
    s.addText(st[0], { x: M + 1.05, y: y + 0.1, w: 4.2, h: rh - 0.2, fontFace: F.h, fontSize: 15, bold: true, color: C.ink, valign: "middle", margin: 0 });
    s.addText(st[1], { x: M + 5.35, y: y + 0.1, w: W - 2 * M - 5.6, h: rh - 0.2, fontFace: F.b, fontSize: 12, color: C.muted, valign: "middle", margin: 0 });
  });
})();

// ============================================================= S16 CLOSE
(() => {
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.16, fill: { color: C.blue }, line: { type: "none" } });
  brandMark(s, M, 0.62, true, 0.4);

  s.addText("Thank you", { x: M, y: 2.7, w: 11, h: 1.1, fontFace: F.h, fontSize: 52, bold: true, color: C.white, margin: 0 });
  s.addText("Let\u2019s protect your AKS workloads before maintenance \u2014 not after.", {
    x: M, y: 3.9, w: 10.5, h: 0.6, fontFace: F.light, fontSize: 20, color: "C8D6E8", margin: 0,
  });

  s.addShape(pres.shapes.RECTANGLE, { x: M, y: 5.35, w: 0.06, h: 0.8, fill: { color: C.blue }, line: { type: "none" } });
  s.addText([
    { text: "Brandon Babcock", options: { fontFace: F.h, fontSize: 15, color: C.white, bold: true, breakLine: true } },
    { text: "Azure AKS Subject-Matter Expert  ·  Microsoft", options: { fontFace: F.b, fontSize: 12, color: "AEC1DA" } },
  ], { x: M + 0.22, y: 5.3, w: 7, h: 0.9, margin: 0, valign: "middle" });

  s.addText("Questions?", { x: W - M - 4, y: 5.4, w: 4, h: 0.6, fontFace: F.h, fontSize: 22, bold: true, color: C.cyan, align: "right", margin: 0 });
  fourSquare(s, W - 1.9, 0.7, 1.0, 0.16);
})();

const out = require("path").join(__dirname, "..", "AKS-Maintenance-Handling.pptx");
pres.writeFile({ fileName: out }).then((f) => console.log("Wrote " + f)).catch((e) => { console.error(e); process.exit(1); });
