# Cold Store Manager

## Overview

Cold Store Manager is a full-stack web application for managing cold storage operations. It helps track potato lots, monitor chamber capacity, assess quality, and analyze storage performance. The app supports bilingual operation (English/Hindi) and provides a comprehensive dashboard for cold storage operators.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS custom properties for theming
- **Charts**: Recharts for data visualization
- **Forms**: React Hook Form with Zod validation
- **Internationalization**: Custom i18n context supporting English and Hindi

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ES modules
- **API Pattern**: RESTful JSON API at `/api/*` routes
- **Build Tool**: Vite for development, esbuild for production bundling

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` (shared between frontend and backend)
- **Validation**: Zod schemas generated from Drizzle schemas via drizzle-zod
- **Storage Abstraction**: Interface-based storage pattern (`IStorage`) with in-memory implementation

### Key Design Patterns
- **Shared Types**: Schema definitions in `/shared` folder are imported by both client and server
- **Form Validation**: Zod schemas defined once and used for both client-side validation and API validation
- **Component Architecture**: Reusable UI components in `client/src/components/ui/`, feature components alongside pages

### Database Schema
Core entities:
- **coldStorages**: Configuration for each cold storage facility (includes bill number counters, address fields: address, tehsil, district, state, pincode)
- **coldStorageUsers**: Users who can access a cold storage (name, mobileNumber, password, accessType: view/edit)
- **chambers**: Storage chambers within a facility with capacity tracking
- **lots**: Farmer lot entries with location, quality, and bag information
- **lotEditHistory**: Audit trail for lot modifications and partial sales
- **salesHistory**: Complete sales records with unique bill numbers (coldStorageBillNumber, salesBillNumber)
- **exitEntries**: Exit/Nikasi entries with unique bill numbers
- **cashFlow**: Cash management with FIFO-based payment allocation

### Admin Panel
- Hidden admin page at `/admin` (not in main navigation)
- Password-protected with ADMIN_PASSWORD environment variable (default: admin123)
- Token-based session authentication for all admin API routes
- Features:
  - Cold storage management (create, edit, delete)
  - Collapsible rows showing cold storage details and address
  - User management per cold storage (add users, set access type, reset passwords)

### Bill Number System
- Four independent bill number sequences: Exit, Cold Storage Deduction, Sales, and Lot Entry
- Bill numbers assigned atomically on first print using UPDATE RETURNING pattern
- Numbers persist across reprints (stored in salesHistory/exitEntries/lots)
- All counters reset to 1 during season reset
- Lot entry bill numbers stored in lots.entryBillNumber, assigned when Print is clicked in receipt dialog

### Build and Deployment
- Development: Vite dev server with HMR, Express API on same port
- Production: Client built to `dist/public`, server bundled to `dist/index.cjs`
- Database migrations via `drizzle-kit push`

## External Dependencies

### Database
- **PostgreSQL**: Primary database via `DATABASE_URL` environment variable
- **Drizzle Kit**: Database migrations and schema management

### UI/UX Libraries
- **Radix UI**: Accessible component primitives (dialogs, dropdowns, forms, etc.)
- **Recharts**: Chart library for analytics visualizations
- **Lucide React**: Icon library
- **date-fns**: Date formatting utilities

### Development Tools
- **Vite**: Frontend build tool and dev server
- **esbuild**: Production server bundling
- **TypeScript**: Type checking across the codebase

### Replit-Specific
- **@replit/vite-plugin-runtime-error-modal**: Error overlay in development
- **@replit/vite-plugin-cartographer**: Replit development tools
- **@replit/vite-plugin-dev-banner**: Development environment indicator