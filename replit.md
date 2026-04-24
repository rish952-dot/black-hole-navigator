# Project Overview

A pure frontend React application built with Vite, TypeScript, Tailwind CSS, and Three.js (via @react-three/fiber and @react-three/drei). Originally created in Lovable and migrated to Replit.

## Architecture

- **Frontend only** — no backend server, no database
- **Framework:** React 18 + TypeScript
- **Build tool:** Vite
- **Styling:** Tailwind CSS + shadcn/ui components
- **3D rendering:** Three.js via @react-three/fiber and @react-three/drei
- **Routing:** React Router DOM v6
- **State/data:** TanStack React Query

## Pages

- `/` — Main index page
- `/mesh` — 3D mesh viewer page
- `*` — 404 Not Found

## Development

```bash
npm run dev     # Start dev server on port 5000
npm run build   # Build for production (outputs to dist/)
```

## Key Files

- `src/App.tsx` — Root component with routing
- `src/pages/` — Page components
- `src/components/` — Shared UI components (shadcn/ui based)
- `src/hooks/` — Custom React hooks
- `src/data/` — Static data
- `vite.config.ts` — Vite configuration (host 0.0.0.0, port 5000)

## Notes

- No external auth, no API keys, no backend integrations
- Lovable-tagger plugin was removed during migration; replaced with standard Vite/React config
