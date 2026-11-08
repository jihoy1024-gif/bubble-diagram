# Bubble Diagram

True-scale program bubble diagrams over a calibrated site plan. Static HTML/CSS/JS, no build step.

## Run
- Double-click `serve.bat` (serves at http://127.0.0.1:8770 and opens the browser), or
- open `index.html` directly (everything works except the "Load sample" button and PDF import needs internet for pdf.js).

## Workflow
1. Drop a site plan (PNG / JPG / PDF first page) on the canvas. It is a locked background layer with opacity control.
2. Calibrate: press `S`, click two points of a known distance (Shift keeps it straight), type the real distance
   (`32`, `32'-6"`, `10 m`). Or pick the drawing scale (e.g. 3/32" = 1'-0") + image dpi and press Set
   (dpi is read automatically from PDFs and most PNG/JPEG files).
3. Type programs on the left: `Classroom 900`, `Study room 120 x6 @Learning`, or paste rows from Excel
   (name, area, qty, zone). Each becomes a bubble or box at its true area; colours are assigned from a categorical palette.
4. Resize / rotate with the handles; labels show drawn area and the difference from target. Lock proportions,
   Snap to target, Make round/square are in the inspector.
5. Connect programs in the Matrix tab (Required / Preferred / Avoid) or draw circulation with Line `L`,
   Polyline `P`, Arrow `A`, Curve `C`. Ends dropped inside a block stay attached and follow it. `Arrange` lays
   blocks out by relationship at true size (pinned blocks stay).
6. Save / Open project `.json` (site plan + scale embedded). Autosaves in the browser. Export PNG or SVG.

World units are feet internally (areas SF); the ft/m toggle switches display and input.

`samples/clemente_siteplan_3-32_100dpi.png` — Clemente site plan at 3/32" = 1'-0", 100 dpi
(1 ft = 9.375 px; the 32' scale bar spans exactly 300 px), for checking calibration.
