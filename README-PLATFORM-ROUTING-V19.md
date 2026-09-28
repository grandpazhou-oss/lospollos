# STCT Platform v1.9 P1 Deep Links

Platform Gate P1 uses a static-host-safe hash route. The logical route remains
the portion after `#`, so a static server only needs to serve `index.html`.

Examples:

```text
index.html#/
index.html#/design/facility-location
index.html#/command/dispatch
index.html#/platform/trust
index.html?optPort=8787&v=p1#/command/dispatch
```

The router preserves documented runtime query keys (`optPort`, `v`,
`forceHeuristic`, `noWebGL`, `no-webgl`, and `reduced-motion`) and discards
unknown keys when it writes a canonical URL. Route-specific parameters are
allowed only when declared by the route descriptor.

Browser Back, Forward, reload, and bookmarks use the hash as the route
authority. Unknown, malformed, or unsafe routes produce a controlled nonblank
error state. P1 placeholders prove routing only; Platform Gate P3 owns COMMAND
domain migration, and later gates own unfinished DESIGN and PLATFORM business
capabilities.
