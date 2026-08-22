# Threshold Product Shell: Integration Handoff

The current product experience is a **local-data demo shell**. It intentionally renders all major user journeys while keeping API and identity seams visible and isolated. The live backend checks completed during this task confirmed `/health` and `/ready`, but the documented data and PDF endpoints returned `404`; nothing in the UI claims that those endpoints are already connected.

## Replace These Local Contracts

| Current local seam | File | Replacement when available |
|---|---|---|
| Route list, activity, and status registers | `client/src/lib/productShellData.ts` → `demoRoutes` | Organisation route-list endpoint, plus `GET /api/route/:routeId/waypoints` for each route’s detail state. |
| Route event and core injector demo | `client/src/lib/routeData.ts` and `ProductApp.tsx` | `GET /api/route/:routeId/events`, `GET /api/route/:routeId/decisions`, and `POST /api/route/:routeId/inject-spike` for test routes only. |
| Audit timeline | `client/src/lib/productShellData.ts` → `auditItems` | Organisation decision feed, or a combined feed constructed from route decision endpoints. Preserve the full `rationale` string in the visible card. |
| Compliance and claim drawer previews | `ProductApp.tsx` → `complianceArtifacts` and `claimArtifacts` | Record and claim detail contracts. Link the drawer export action to the verified compliance and claims PDF URLs. |
| Role selector and organisation gate | `AuthPages.tsx` and `ProductShell.tsx` | Clerk headless sign-in/sign-up hooks and Clerk organisation membership role metadata. Remove the local role selector after role resolution is live. |

## App Routes Already Available

| Role | Route | Product intent |
|---|---|---|
| Auth | `/sign-in`, `/sign-up`, `/verify`, `/organization` | Custom visual shell ready to wrap with Clerk headless hooks. |
| Dispatcher | `/app/dispatcher/routes`, `/detail`, `/create`, `/activity` | Route monitoring, demo injector, create-route flow, activity register. |
| Admin | `/app/admin/settings`, `/routes`, `/detail`, `/create`, `/members` | Organisation configuration and people-management surfaces. |
| Compliance | `/app/compliance/audit`, `/records`, `/claims` | Primary decision review, driver record, and cargo claim workspaces. |
| Driver | `/app/driver/routes`, `/detail`, `/records` | Read-only assigned-route and own-record surfaces. |

## Clerk Wiring Notes

Replace the form submits in `AuthPages.tsx` with the configured Clerk headless lifecycle. The expected UI states are already designed: email/password entry, email verification, error display space, submit loading space, and the organisation-entry gate. Resolve the initial post-auth route from Clerk organisation membership metadata: `admin → /app/admin/settings`, `dispatcher → /app/dispatcher/routes`, `compliance → /app/compliance/audit`, and `driver → /app/driver/routes`.

## API and Hosting Notes

The current externally reachable API is HTTP-only. A deployed HTTPS frontend should call an HTTPS API origin or use a same-origin server-side proxy to avoid browser mixed-content blocking. Keep the demonstrator injector unavailable on non-demo routes. The UI already labels PHX — 01 as the only local demo route and treats document exports as unavailable until a verified PDF endpoint exists.

> The interface intentionally shows **confidence as agreement between the two deterministic modules**, not as a machine-learning probability. Preserve that meaning when the API fields are wired.
