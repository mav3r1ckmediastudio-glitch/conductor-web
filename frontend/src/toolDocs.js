// toolDocs.js — Tool help content for Conductor Web.
// Ported from the v2 plugin's help_content.json — full Purpose / How To /
// Common Mistakes / Related tools, plus a deep-link to the online manual.
// Consumed by RadialWheel's ⓘ help popup and App's active-chip help link.

export const DOCS_BASE = 'https://conductor-web-manual.netlify.app/';

export const TOOL_DOCS = {
  "civil-edit-cabinet": {
    title:    "Edit Cabinet / POP",
    purpose:  "Edits the attributes of an existing cabinet/POP — ID, equipment counts (DUX/Calix shelves, GPON cards), splitter configuration and other details — without moving it. Feeds the Bill of Materials and Cabinet Cost Calculator.",
    howTo:    "1. Click Edit Cabinet / POP.\n2. The cabinet edit form opens in the right panel.\n3. Update the fields.\n4. Save.",
    mistakes: "This tool edits attributes only. To move the cabinet itself, use the Move Asset tool in the sidebar.",
    related:  ["civil-chamber", "civil-duct"],
    anchor:   "tools-civil",
  },
  "civil-chamber": {
    title:    "Place Chamber",
    purpose:  "Places an underground chamber, auto-numbered by its compass direction from the parent cabinet.",
    howTo:    "1. Click Place Chamber.\n2. Click the chamber's location on the map.\n3. Fill in chamber details (type, size).\n4. Save.",
    mistakes: "Requires a Build Area and a Cabinet to already exist — the auto-numbering is calculated relative to the cabinet's position.",
    related:  ["fibre-joint", "civil-duct"],
    anchor:   "tools-civil",
  },
  "civil-duct": {
    title:    "Digitise Duct",
    purpose:  "Draws an underground duct route between two nodes (chambers, poles, or the cabinet). Auto-assigns a DUCT-NNN ID based on the compass leg from the cabinet, and auto-calculates length from the digitised geometry.",
    howTo:    "1. Click Digitise Duct.\n2. Click the start node (cabinet or chamber) — must snap.\n3. Click the end node — must snap.\n4. Fill in duct details (type, diameter) and save.\n5. If the duct is protected by a scaffold-bar sleeve, set Sleeve to SCAFFOLD_BAR and enter the sleeve length — this feeds a dedicated scaffold bar line item into the BoM.",
    mistakes: "Both ends must snap onto existing chamber/cabinet nodes — if snapping is off or you click empty space, the duct won't connect into the network topology correctly.",
    related:  ["civil-chamber", "fibre-cable"],
    anchor:   "tools-civil",
  },
  "civil-drop-duct": {
    title:    "Digitise Drop Duct",
    purpose:  "Two-click tool that draws a drop duct from a joint or chamber to a premises (or a free point).",
    howTo:    "1. Click Digitise Drop Duct.\n2. LMB click 1 — start point (joint, chamber, or free).\n3. LMB click 2 — end point (premises or free).\n4. RMB — saves the drop and resets ready for the next one.\n5. Esc — exits the tool.",
    mistakes: "The tool stays active after each save (RMB) — press Esc when you're done, otherwise the next click starts a new drop.",
    related:  ["fibre-bundle", "pia-drop"],
    anchor:   "tools-civil",
  },
  "civil-road": {
    title:    "Road Crossing",
    purpose:  "Digitise a duct segment that crosses under a road. A thin wrapper around Digitise Duct — surface_type is locked to ROAD. Each crossing adds a fixed cost line to the BoM.",
    howTo:    "Left-click to add vertices across the road (snaps to chambers/poles/cabinet). Right-click to finish. Fill in the duct details — Surface Type is pre-set to ROAD and cannot be changed. Add a permit reference if a road opening licence (e.g. S50) applies.",
    mistakes: "Forgetting to record the permit reference for road opening licences. Not snapping to the chambers either side of the crossing.",
    related:  ["civil-duct", "civil-stream"],
    anchor:   "tools-civil",
  },
  "civil-stream": {
    title:    "Stream Crossing",
    purpose:  "Digitise a duct segment that crosses under a watercourse. A thin wrapper around Digitise Duct — surface_type is locked to WATERCOURSE. Each crossing adds a fixed cost line to the BoM.",
    howTo:    "Left-click to add vertices across the watercourse (snaps to chambers/poles/cabinet). Right-click to finish. Fill in the duct details — Surface Type is pre-set to WATERCOURSE and cannot be changed. Add a land drainage / watercourse consent reference if applicable.",
    mistakes: "Forgetting to record watercourse consent references. Not snapping to the chambers either side of the crossing.",
    related:  ["civil-duct", "civil-road"],
    anchor:   "tools-civil",
  },
  "fibre-cable": {
    title:    "Digitise Cable",
    purpose:  "Draws a fibre cable between two joints (or the cabinet). Snaps only to joints and the cabinet — not chambers. Offers to copy the geometry of the parent duct.",
    howTo:    "1. Click Digitise Cable.\n2. Click the start joint or cabinet — must snap.\n3. Click the end joint — must snap.\n4. Choose whether to copy the parent duct's geometry.\n5. Fill in cable type and fibre count, then save.",
    mistakes: "Cable snaps to joints and the cabinet only — if a chamber has no Joint placed inside it, the cable can't connect there. Place a Joint first.",
    related:  ["fibre-joint", "fibre-trace", "aerial-span"],
    anchor:   "tools-fibre",
  },
  "fibre-bundle": {
    title:    "Digitise Bundle",
    purpose:  "Two-click tool that draws a fibre bundle from a secondary splitter joint to a premises/ONT.",
    howTo:    "1. Click Digitise Bundle.\n2. LMB click 1 — start point, must snap to a secondary splitter joint.\n3. LMB click 2 — end point (premises/ONT).\n4. RMB — saves and resets for the next bundle.\n5. Esc — exits the tool.",
    mistakes: "The start point must snap to a secondary splitter joint specifically — clicking a plain joint or chamber won't work.",
    related:  ["civil-drop-duct", "fibre-assign"],
    anchor:   "tools-fibre",
  },
  "fibre-joint": {
    title:    "Place Joint",
    purpose:  "Places a joint closure inside an existing chamber. Joints are the nodes of the fibre topology, and can optionally contain a passive optical splitter.",
    howTo:    "1. Click Place Joint.\n2. Click inside an existing chamber — must snap.\n3. Fill in joint details (type, splitter configuration if applicable).\n4. Save.",
    mistakes: "The joint must be placed inside (snapped to) a chamber — joints placed in empty space won't be usable for cable connections.",
    related:  ["civil-chamber", "fibre-cable"],
    anchor:   "tools-fibre",
  },
  "fibre-assign": {
    title:    "Assign Fibre Roles",
    purpose:  "Runs the automatic fibre assignment engine across the network, assigning every premise to a splitter port through the 1:4 → 1:8 cascade. Allocation is sticky and freeze-aware — ports marked INSTALLED or LIVE are never reassigned.",
    howTo:    "1. Make sure the network topology (cables, joints, drops/bundles) is complete.\n2. Click Assign Fibre Roles.\n3. Review the summary: assigned, splitters, spare, over-cap.\n4. Inspect a CBT's port grid via Edit Asset.",
    mistakes: "Run Validate Fibre Routes first — assigning fibre roles over a broken topology produces incomplete or incorrect assignments.",
    related:  ["fibre-trace", "fibre-count"],
    anchor:   "tools-fibre",
  },
  "fibre-trace": {
    title:    "Fibre Trace",
    purpose:  "Traces the fibre path between a premises and the cabinet, following splices and joints, and shows the optical power budget (loss, margin, PASS/FAIL) for that route.",
    howTo:    "1. Click the Fibre Trace tool.\n2. Click a premises on the map — it snaps to the nearest one within range.\n3. The route highlights and the panel reports the hop-by-hop path and status.\n4. If the route is complete, an Optical Budget card shows total loss, margin and PASS/FAIL with an expandable per-element breakdown.",
    mistakes: "Clicking a feature that isn't snapped to the network will fail to start a trace. The optical budget card only appears for ROUTED routes; PARTIAL/UNSERVED have no loss figure to show.",
    related:  ["fibre-count"],
    anchor:   "tools-fibre",
  },
  "fibre-count": {
    title:    "Fibre Count",
    purpose:  "Calculates fibre utilisation across all cables and joints in the network — used, spare, and total fibres per segment with RAG status. Useful for checking headroom before adding new drops.",
    howTo:    "1. Click Fibre Count.\n2. Review the per-segment utilisation panel.\n3. Click a segment row to highlight it on the map.",
    mistakes: "Running this before all downstream premises are placed will under-count — place premises first.",
    related:  ["fibre-trace"],
    anchor:   "tools-fibre",
  },
  "aerial-pole": {
    title:    "Place Pole",
    purpose:  "Places an Openreach pole. Poles are civil-only assets with no optical role — a CBT placed on a pole carries the optical event. Rendered as a 3D cylinder on the map.",
    howTo:    "1. Click Place Pole.\n2. Click the pole's location on the map.\n3. Fill in pole details (height, ownership).\n4. Save.",
    mistakes: "A pole on its own won't appear in fibre traces — place a CBT on it with Place CBT to give it optical connectivity.",
    related:  ["aerial-cbt", "aerial-span"],
    anchor:   "tools-aerial",
  },
  "aerial-cbt": {
    title:    "Place CBT",
    purpose:  "Places a Cabinet Branch Terminal (CBT) on a pole, snapping to the nearest pole. The CBT shares the pole's coordinates (stored as parent_pole_id) and carries the optical splice/splitter event — it is always a 1:8 terminal splitter by default.",
    howTo:    "1. Click Place CBT.\n2. Click near an existing pole — it snaps automatically.\n3. Fill in CBT details (splitter configuration if applicable).\n4. Save.",
    mistakes: "Must be placed within snapping distance of a pole — place the pole first. CBTs must each have a dedicated fibre tail back to an underground joint; they must not be daisy-chained optically.",
    related:  ["aerial-pole", "aerial-drop", "fibre-assign"],
    anchor:   "tools-aerial",
  },
  "aerial-cbt-tail": {
    title:    "Draw CBT Tail",
    purpose:  "Digitises the fibre tail from a CBT back to its parent underground joint, snapping through intermediate poles. Each CBT requires its own dedicated tail. Hard stop at 350m — the true measured length is stored for the BoM.",
    howTo:    "1. Click Draw CBT Tail.\n2. Click the origin CBT.\n3. Click through intermediate poles to route the tail.\n4. RMB to finish at the destination joint.",
    mistakes: "Maximum tail length is 350m. Designs needing longer runs should use an intermediate pole and joint. Stores from_cbt and to_joint references.",
    related:  ["aerial-cbt", "fibre-joint", "aerial-span"],
    anchor:   "tools-aerial",
  },
  "aerial-span": {
    title:    "Digitise Aerial Span",
    purpose:  "Draws an aerial fibre span between poles/CBTs. Carries fibre between poles (from_node / to_node as pole IDs) and renders with the PIA aerial sky-blue colour. Span fibre count determines which aerial cable cost is used in the BoM.",
    howTo:    "1. Click Digitise Aerial Span.\n2. Click CBTs to add span vertices — must snap.\n3. RMB to finish.\n4. Fill in cable details (fibre count, type).",
    mistakes: "Snaps to CBTs — place CBTs on the poles first with Place CBT.",
    related:  ["aerial-pole", "aerial-cbt", "fibre-cable"],
    anchor:   "tools-aerial",
  },
  "aerial-drop": {
    title:    "Digitise Aerial Drop",
    purpose:  "Draws an aerial drop from a CBT to a premises — the final-mile overhead connection. drop_type = PIA_AERIAL_DROP and from_cbt are set automatically when the start node is a CBT, shown with a light blue rubber band.",
    howTo:    "1. Click Digitise Aerial Drop.\n2. LMB click 1 on the CBT.\n3. LMB click 2 on the premises.\n4. RMB to save and reset. Esc to exit.",
    mistakes: "The start point must be a CBT (placed with Place CBT) for the drop_type and from_cbt to be set correctly.",
    related:  ["aerial-cbt", "fibre-bundle"],
    anchor:   "tools-aerial",
  },
  "pia-chamber": {
    title:    "Place PIA UG Chamber",
    purpose:  "Places an Openreach underground chamber (chamber_type = PIA_UG_CHAMBER) for routes using Openreach's underground subduct (PIA) network.",
    howTo:    "1. Click Place PIA UG Chamber.\n2. Click the chamber's location on the map.\n3. Fill in chamber details.\n4. Save.",
    mistakes: "Use this rather than the standard Place Chamber tool for PIA underground routes, so the chamber is correctly tagged as PIA_UG_CHAMBER.",
    related:  ["pia-duct", "aerial-pole"],
    anchor:   "tools-pia",
  },
  "pia-duct": {
    title:    "Digitise PIA UG Duct",
    purpose:  "Multi-vertex line tool for Openreach underground subduct routes. Snaps to PIA UG chambers and PIA poles, written to the ducts layer with duct_type = PIA_UG and owner = Openreach.",
    howTo:    "1. Click Digitise PIA UG Duct.\n2. Click each vertex along the route, snapping to PIA UG chambers/poles.\n3. RMB to finish and save — the tool stays active for the next one.\n4. Esc to exit.",
    mistakes: "The tool stays active after each save — press Esc when you're done routing, otherwise the next click starts a new duct.",
    related:  ["pia-chamber", "pia-drop"],
    anchor:   "tools-pia",
  },
  "pia-drop": {
    title:    "Digitise PIA UG Drop",
    purpose:  "Two-click tool for Openreach underground drops. Start snaps to a PIA UG chamber, end snaps to a premises. Written to drop_ducts with drop_type = PIA_UG and owner = Openreach.",
    howTo:    "1. Click Digitise PIA UG Drop.\n2. LMB click 1 on the PIA UG chamber.\n3. LMB click 2 on the premises.\n4. RMB to save and reset. Esc to exit.",
    mistakes: "The start point must snap to a PIA_UG_CHAMBER specifically — a regular chamber won't work.",
    related:  ["pia-chamber", "civil-drop-duct"],
    anchor:   "tools-pia",
  },
};

// Full entry for a tool (or a safe placeholder).
export const toolDoc = (toolId) => TOOL_DOCS[toolId] || {
  title: toolId, purpose: 'No help content available for this tool yet.',
  howTo: '', mistakes: '', related: [], anchor: '',
};

// Short label for a related-tool chip.
export const toolTitle = (toolId) => (TOOL_DOCS[toolId]?.title) || toolId;

// Deep-link to this tool's manual section.
export const docsUrl = (toolId) => {
  const e = TOOL_DOCS[toolId];
  return e && e.anchor ? `${DOCS_BASE}#${e.anchor}` : DOCS_BASE;
};

// One-line tip (Purpose, first sentence) — kept for the active-chip title.
export const toolTip = (toolId) => {
  const p = TOOL_DOCS[toolId]?.purpose || '';
  const dot = p.indexOf('. ');
  return dot > 0 ? p.slice(0, dot + 1) : p;
};
