# STCT v1.6 Color Role Ledger

Status: implementation contract

| Token | Value | Role | Prohibited use |
| --- | --- | --- | --- |
| `--v16-navy` | `#003b79` | primary text, selected route, structural lines | full-screen dark background |
| `--v16-blue` | `#0068b7` | interactive focus, planned route, information | success or live-state implication |
| `--v16-red` | `#e60012` | destructive action, critical alert, LOGISTEED signal | large decorative blocks |
| `--v16-amber` | `#b45309` | warning, stale state, degraded provider | normal or selected state |
| `--v16-green` | `#14804a` | verifier PASS, acknowledged, healthy | simulated movement by itself |
| `--v16-ink` | `#172033` | body text | disabled text |
| `--v16-muted` | `#5d687a` | secondary evidence text | required truth labels |
| `--v16-line` | `#d7dde7` | dividers and table rules | dominant visual field |
| `--v16-surface` | `#ffffff` | primary workspace | translucent overlay on text |
| `--v16-subtle` | `#f4f7fa` | alternate rows and secondary bands | nested card decoration |

## Operational Mapping

- Planned route: blue solid line plus `Planned` label.
- Simulated actual trace: green solid line plus `Simulated Actual` label.
- Recovery proposal: cyan/dashed line plus `Proposed` label.
- Critical affected segment: red line or hatch plus severity icon.
- Completed: neutral/green with lock or check icon.
- In service: blue with current-state icon.
- Remaining: neutral/amber with pending icon.
- Stale/offline: amber/red plus explicit timestamp and text.

Color never carries status alone. Every status also has text and an icon, line style, or pattern.
