# Kiebler Heizungsoptimierung

A modern, mobile-first web dashboard for managing building portfolios, assets, and sensor measurements. Built with Next.js 16, TypeScript, and Tailwind CSS.

## 🚀 Features

- **📱 Mobile-First Responsive Design** - Optimized for all device sizes
- **📊 Real-Time Data** - Live sensor measurements with auto-refresh
- **🎨 Modern UI/UX** - Premium design with dark mode support
- **⚡ Performance Optimized** - Skeleton screens and server components
- **♿ Accessible** - WCAG 2.1 AA compliant with keyboard navigation
- **🔒 Type-Safe** - Full TypeScript coverage with strict mode

## 📋 Prerequisites

- Node.js 20+ (LTS recommended)
- npm, yarn, pnpm, or bun
- Core Platform running on `http://localhost:8080`

## 🛠️ Getting Started

### Installation

```bash
# Install dependencies
npm install
```

### Environment Setup

Create a `.env.local` file:

```bash
# Optional: backend target for the Next.js API proxy
# Defaults to http://localhost:8080 when omitted
BACKEND_URL=http://localhost:8080
```

### Development

```bash
# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

### Production Build

```bash
# Build for production
npm run build

# Start production server
npm run start
```

## 📱 Responsive Design

The dashboard implements a mobile-first responsive design with adaptive navigation:

| Viewport | Navigation | Layout |
|:---------|:-----------|:-------|
| **Mobile** (< 768px) | Bottom navigation + "More" bottom sheet | Single column |
| **Tablet** (768px - 1024px) | Sidebar navigation | 2-3 columns |
| **Desktop** (≥ 1024px) | Sidebar navigation | 3-4 columns |

### Key Breakpoints

- `sm`: 640px - Small tablets
- `md`: 768px - Tablets (navigation switch)
- `lg`: 1024px - Desktop (sidebar always visible)
- `xl`: 1280px - Large desktop
- `2xl`: 1536px - Extra large

## 🏗️ Architecture

### Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4
- **Data Fetching**: SWR (stale-while-revalidate)
- **Charts**: Recharts
- **Icons**: Lucide React
- **Fonts**: Geist Sans & Geist Mono

### Project Structure

```
app/                    # Next.js App Router
├── page.tsx           # Dashboard homepage
├── layout.tsx         # Root layout with navigation
├── globals.css        # Design system & global styles
├── sites/             # Sites pages
└── assets/            # Asset pages

components/
├── layout/            # Layout components
│   ├── Sidebar.tsx   # Desktop sidebar navigation
│   ├── BottomNav.tsx # Mobile bottom navigation
│   ├── MobileMenu.tsx# Legacy mobile hamburger prototype (unused)
│   └── Header.tsx    # Page header (server component)
├── ui/                # Reusable UI components
│   ├── Card.tsx      # Card container
│   ├── Badge.tsx     # Status badges
│   ├── Button.tsx    # Button component
│   ├── Skeleton.tsx  # Loading skeletons
│   └── ErrorMessage.tsx
├── charts/            # Chart components
└── assets/            # Asset-specific components

lib/
├── api/               # API client & types
├── hooks/             # Custom React hooks (SWR)
└── utils/             # Utility functions
```

## 🎨 Design System

### Color Palette

```css
--primary: #6366f1      /* Indigo */
--accent: #ec4899       /* Pink */
--success: #22c55e      /* Green */
--warning: #f59e0b      /* Orange */
--danger: #ef4444       /* Red */
```

### Components

All components support variants, sizes, and responsive props:

```tsx
// Card with variants
<Card variant="elevated" hover>
  <CardContent>...</CardContent>
</Card>

// Badge with status colors
<Badge variant="success" size="sm">Active</Badge>

// Button with loading state
<Button variant="primary" loading>Submit</Button>
```

## 📊 Pages

### Dashboard (`/`)
- Portfolio overview with key metrics
- Recent sites list
- Quick actions panel
- System status indicator

### Sites (`/sites`)
- Grid view of all buildings
- Responsive card layout
- Search and filter (coming soon)

### Site Detail (`/sites/[id]`)
- Building information
- Assets grouped by type
- Location map (coming soon)

### Asset Detail (`/assets/[id]`)
- Asset metadata
- Real-time measurements
- Historical data charts
- Time range selector

## 🔌 API Integration

The dashboard connects to the Core Platform REST API:

```typescript
// Browser-side API base URL
const API_BASE_URL = '/api/v1'

// Server-side proxy target
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080'

// Example endpoints
GET /api/v1/sites              # List sites
GET /api/v1/sites/{id}         # Get site details
GET /api/v1/assets/{id}        # Get asset details
GET /api/v1/assets/{id}/measurements/latest  # Latest measurements
```

## ♿ Accessibility

- ✅ WCAG 2.1 AA compliant
- ✅ Keyboard navigation support
- ✅ ARIA labels and landmarks
- ✅ Focus indicators
- ✅ Reduced motion support
- ✅ Touch targets ≥ 44px (mobile)

## 🧪 Testing

```bash
# Lint code
npm run lint

# Type check
npx tsc --noEmit
```

## 📚 Documentation

- [Implementation Documentation](../../docs/web-dashboard-implementation.md) - Detailed technical documentation
- [UI/UX Design Concept](../../docs/ui-ux-design-concept.md) - Design guidelines and principles

## 🚧 Known Issues

1. **Tailwind CSS v4 Warning** - `@theme inline` warning in dev (non-blocking)

## 🗺️ Roadmap

### Immediate
- [ ] Add search and filter
- [ ] PDF report generation
- [ ] Notifications and alerts

### Future
- [ ] Contact management for landlords
- [ ] Real-time WebSocket updates
- [ ] Progressive Web App (PWA)

## 📄 License

Proprietary - Kiebler Heizungsoptimierung

## 🤝 Contributing

This is a private project. For questions or issues, contact the development team.

---

**Version**: 0.6.0  
**Last Updated**: 2026-02-16 19:55 CET  
**Built with** ❤️ **by Kiebler Heizungsoptimierung**
