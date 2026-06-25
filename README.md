<p align="center">
  <img src="frontend/src/assets/hero.png" alt="Conductor" width="150" />
</p>

<h1 align="center">Conductor Web</h1>

<p align="center">
  <strong>A web-based FTTP design platform for planning, validating and documenting fibre networks from cabinet to customer.</strong>
</p>

<p align="center">
  Conductor Web is the browser-based rebuild of the original Conductor QGIS plugin, bringing the same full-lifecycle FTTP design workflow into a modern, focused web interface.
</p>

---

## What is Conductor?

Conductor is a specialist FTTP network design tool built for real-world fibre planning.

It is designed to help broadband operators, network designers and delivery teams manage the full design journey in one place: importing premises, defining build areas, placing cabinets and POPs, drawing civils, designing fibre routes, validating connectivity, checking optical loss, producing splice plans and building costed delivery outputs.

The original Conductor project was built as a QGIS plugin for rural fibre design. This repository is the web rebuild: the same Conductor workflow, redesigned as a dedicated browser-based design environment.

---

## Why Conductor exists

FTTP design often ends up split across too many places: GIS layers, spreadsheets, hand-written splice notes, PDF markups, naming conventions, cost calculators and local knowledge held by individual designers.

Conductor brings those stages into one controlled workflow.

Instead of simply drawing lines on a map, Conductor understands the structure of an FTTP network: cabinets, chambers, ducts, joints, poles, CBTs, cables, splitters, customer drops, premises and the route logic between them.

The goal is simple:

> **Design faster. Validate earlier. Hand over cleaner build packs.**

---

## What Conductor does

### Project setup

Conductor starts every build as a structured project, with a project name, build-area code and consistent asset prefix. This keeps network assets named predictably across cabinets, ducts, chambers, joints, CBTs, poles, premises and routes.

The workflow is staged so designers complete the core setup in the right order:

```text
Create project → Import premises → Draw build area → Place cabinet / POP → Design network
```

This prevents the design from becoming messy before the foundations are in place.

---

### Premises and build areas

Conductor can import premises data and use it as the basis for the network design.

Supported workflows include:

- importing UPRN/address data
- plotting premises on the map
- drawing build-area boundaries
- filtering premises to the chosen build area
- using postcode and address information to guide design decisions
- preparing premises for route validation and customer connection checks

This allows the designer to work from the actual properties being served, rather than designing blind and reconciling the premises later.

---

### Civil design

Conductor separates the physical civils network from the fibre network, matching the way FTTP builds are delivered in the real world.

Civil tools include:

- place cabinet / POP
- edit cabinet / POP
- place chambers
- digitise ducts
- digitise drop ducts
- digitise road crossings
- digitise stream crossings
- track duct sleeves / scaffold-bar protection where needed
- edit, delete and move assets

The civil layer represents the infrastructure in the ground: ducts, chambers, road crossings, watercourse crossings and drop routes.

---

### Fibre design

Once the civils network is in place, Conductor supports the fibre layer that runs through it.

Fibre tools include:

- place joints
- define splitters
- digitise spine and distribution cables
- digitise customer bundles
- assign tube and fibre numbers
- apply IEC-style fibre colour conventions
- trace fibre routes from premises back to cabinet
- calculate cable capacity against served premises

Conductor is designed around a real splitter cascade, including the common **1:4 × 1:8 = 1:32** GPON design pattern.

---

### PIA, poles and aerial design

Conductor also supports networks using Openreach PIA, underground PIA routes and aerial plant.

PIA and aerial workflows include:

- place poles
- place CBTs
- draw CBT tails
- digitise aerial spans
- digitise aerial drops
- place PIA underground chambers
- digitise PIA underground ducts
- digitise PIA underground drops
- model CBT-fed premises routes
- distinguish underground, aerial and hybrid network sections

This makes Conductor suitable for rural and mixed-build networks where ducts, poles, CBTs and PIA infrastructure are all part of the same design.

---

### Route validation

Conductor is not just a drawing tool. It checks whether premises are actually connected correctly.

The route validator is designed to trace each premises back through the network and classify it as:

- **Routed** — a valid path exists back to the cabinet / POP
- **Partial** — a route exists but has a break, missing asset or topology issue
- **Unserved** — no valid network route has been created yet

Validation helps identify design problems before they become build problems.

Examples of issues Conductor can help flag include:

- missing drop routes
- broken fibre paths
- splitter chains in the wrong order
- missing 1:4 or 1:8 splitters
- over-capacity cables
- incomplete premises routes
- CBT tail warnings
- route sections that cannot be traced back to the cabinet

---

### Optical budget checks

Conductor includes optical budget logic so designers can see whether a route is likely to pass before it is built.

Budget checks can account for:

- fibre length
- fibre attenuation
- splice loss
- connector allowance
- splitter insertion loss
- safety margin
- GPON / XGS-PON link class assumptions

This is especially useful for rural networks, where long tails, cascaded splitters and mixed underground/aerial routes can push optical loss close to the limit.

---

### Fibre trace

The fibre trace workflow lets a designer inspect the full path from a selected premises back to the serving cabinet or POP.

A trace can show:

- the selected premises
- the drop route
- CBT or joint connection
- distribution route
- splitter points
- spine route
- cabinet / POP endpoint
- optical budget summary
- route status

This makes it easier to diagnose design errors, explain a route to an engineer, or confirm that a customer has been designed correctly.

---

### Outputs and build packs

Conductor is designed to produce the outputs needed to move from design into delivery.

Output workflows include:

- splice plans
- route splice exports
- single line diagrams
- bill of materials
- cabinet cost calculator
- project summary metrics
- route tables
- material and cable-length summaries
- design health checks

The aim is to reduce manual spreadsheet work and make the handover from design to build much cleaner.

---

## Web rebuild highlights

The web version keeps the original Conductor design philosophy but presents it in a dedicated browser interface.

Current web interface highlights include:

- modern dark map interface
- MapLibre-based interactive mapping
- MapTiler basemaps
- optional 2D / 3D map view
- staged project workflow
- address import panel
- build-area drawing flow
- cabinet / POP placement form
- radial tool wheel for design tools
- route drawer and asset inspection panels
- project state saved in the browser during prototype use
- optical budget calculation module ready for validation and trace workflows

The intent is for Conductor Web to become the main product-facing version of Conductor, without requiring users to work inside QGIS.

---

## Core workflow

A typical Conductor design process looks like this:

1. **Create a project**  
   Set the project name, area code and asset prefix.

2. **Import premises**  
   Bring in UPRN/address data and plot the properties to be served.

3. **Draw the build area**  
   Define the design boundary and focus the project on the relevant premises.

4. **Place cabinet / POP**  
   Add the serving node and record power, operator, equipment and capacity details.

5. **Design civils**  
   Add chambers, ducts, crossings and drop ducts.

6. **Design fibre**  
   Add joints, splitters, cables, bundles and customer drops.

7. **Add PIA / aerial assets where needed**  
   Add poles, CBTs, aerial spans, PIA chambers and underground PIA routes.

8. **Validate routes**  
   Check that premises trace correctly back to the cabinet.

9. **Check fibre capacity and optical budget**  
   Confirm that cable sizes, splitters and route losses are within design limits.

10. **Export delivery outputs**  
    Generate splice plans, route exports, SLDs, BoMs and cost summaries.

---

## Main feature areas

| Area | What it covers |
|---|---|
| Project workflow | Project setup, staged unlock, asset naming and design progression |
| Premises | Address/UPRN import, map plotting and build-area filtering |
| Civil network | Cabinets, POPs, chambers, ducts, drop ducts, road and stream crossings |
| Fibre network | Joints, splitters, fibre cables, customer bundles and fibre assignment |
| PIA underground | PIA chambers, PIA ducts and PIA drop routes |
| Aerial | Poles, CBTs, CBT tails, aerial spans and aerial drops |
| Validation | Routed, partial and unserved premises checks |
| Fibre intelligence | Fibre trace, fibre count and optical power budget checks |
| Outputs | Splice plans, route splice exports, BoM, SLD and cabinet cost summaries |
| Interface | Web map, radial tool wheel, route drawer, asset panels and 2D/3D view |

---

## Local development

This repository contains a Svelte/Vite frontend and a small FastAPI backend.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend will usually run at:

```text
http://localhost:5173
```

### Backend

```bash
cd backend
python -m venv venv
```

Activate the virtual environment.

Windows:

```bash
venv\Scripts\activate
```

macOS / Linux:

```bash
source venv/bin/activate
```

Install dependencies and run the API:

```bash
pip install fastapi uvicorn
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The backend health endpoint should return:

```json
{
  "status": "Conductor API is alive"
}
```

---

## Environment variables

The frontend requires a MapTiler API key.

Create:

```text
frontend/.env
```

Add:

```env
VITE_MAPTILER_KEY=your_maptiler_key_here
```

Do not commit real API keys to GitHub. Use an `.env.example` file for placeholders.

---

## Repository notes

Before publishing this repository publicly, check that the following are not committed:

- real MapTiler keys
- `.env` files
- customer premises data
- live UPRN datasets
- real cabinet or network locations, unless intended
- backend virtual environments
- generated build folders
- private operational notes

Recommended exclusions include:

```gitignore
node_modules/
dist/
venv/
__pycache__/
frontend/.env
frontend/.env.*
```

---

## Credits

Conductor Web uses:

- **MapLibre GL JS** for browser-based map rendering
- **MapTiler** for basemaps and terrain services
- **Svelte** and **Vite** for the frontend application
- **FastAPI** for the backend prototype

The original Conductor plugin was developed as a QGIS-based FTTP design tool. This web rebuild carries the same design logic and workflow forward into a standalone product interface.

---

## Licence

No open-source licence is currently included.

Unless a licence is added, this project should be treated as private and proprietary.

Suggested wording for a private commercial repo:

```text
Copyright © Mav3r1ck Media Studio.
All rights reserved.

This software is proprietary and confidential. No permission is granted to copy,
modify, distribute, sublicense or use this software except under a written
agreement with the owner.
```

---

## Suggested GitHub description

```text
Web-based FTTP network design platform for premises import, civils planning, fibre routing, PIA/aerial design, validation, optical budget checks and build outputs.
```

## Suggested GitHub topics

```text
fttp fibre-broadband gis maplibre svelte vite fastapi network-design telecoms fibre-planning pia gpon
```
