# STCT v1.8 Accessibility And i18n Audit

## Accessibility Summary

- Semantic landmarks: header, navigation tablist, main, sections, tables, and asides.
- Keyboard: tabs, entity steppers, scenario compare, recovery preview, dock reschedule, capsule export, and presentation mode.
- Focus: a 3 px visible focus outline is supplied and action updates do not move focus.
- Non-color evidence: heatmap signal, numeric value, and severity level remain visible as text.
- Alternatives: map, heatmap, Dock Gantt, Time-Space, and no-WebGL content include text or table equivalents.
- Announcements: preview and recovery updates use a throttled polite live region.
- Motion: flow, pulse, and trip-chain motion are removed by reduced-motion media rules while tables and labels remain.
- Mobile: viewport zoom is not disabled; safe-area insets, scrolling tables, and bottom-sheet content reservation are present.

## Terminology

| Concept | Chinese | English | Japanese |
| --- | --- | --- | --- |
| Network Operations | 网络运营 | Network Operations | ネットワーク運用 |
| Decision Room | 决策室 | Decision Room | 意思決定室 |
| Capacity Heatmap | 容量热力图 | Capacity Heatmap | 容量ヒートマップ |
| Trip Chain | 趟次链 | Trip Chain | 便チェーン |
| Dock Gantt | 月台甘特图 | Dock Gantt | ドックガント |
| Time-Space | 时间空间图 | Time-Space | 時空間 |
| Network Recovery | 网络恢复 | Network Recovery | ネットワーク復旧 |
| Network Capsule | 网络胶囊 | Network Capsule | ネットワークカプセル |

Identifiers, hashes, reason codes, and engine names remain unchanged across
languages because they are audit evidence rather than translated interface
copy.

## Long Description

The Network Decision Room summarizes a synthetic multi-depot plan. It places
critical alerts, service risk, capacity stress, recommended actions, and their
source hashes before secondary analysis. The Network Map shows depots and trip
routes and has a text summary and tables as alternatives. Capacity, trip,
dock, time-space, scenario, recovery, and capsule views provide source-backed
tables and keyboard controls. Preview actions update only the local demo state;
they do not call an external service or apply a physical operational change.

