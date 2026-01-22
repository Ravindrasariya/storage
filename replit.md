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

### User Authentication System
- KrashuVed splash screen displayed on initial app load
- Login page with mobile number (10 digits) and password authentication
- Database-backed sessions (userSessions table) persist across server restarts
- Auth context with localStorage integration for client-side session persistence
- Protected routes redirect unauthenticated users to login
- User profile dropdown showing cold storage name, user info, access type
- Change password functionality requires current password verification for security
- Key files: `client/src/lib/auth.tsx`, `client/src/pages/Login.tsx`, `client/src/components/SplashScreen.tsx`

### Admin Panel
- Hidden admin page at `/admin` (not in main navigation, accessible without user authentication)
- Password-protected with ADMIN_PASSWORD environment variable (default: admin123)
- Token-based session authentication for all admin API routes
- Features:
  - Cold storage management (create, edit, delete)
  - Collapsible rows showing cold storage details and address
  - User management per cold storage (add users, set access type, reset passwords)

### Sales History Edit Dialog
- Edit dialog allows modifying cold storage charges after initial sale
- Context fields recorded at sale time and shown as non-editable: chargeBasis, initialNetWeightKg, remainingSizeAtSale
- If baseChargeAmountAtSale = 0, base charge fields are disabled (already billed) with "Already Billed" badge
- Charge formulas use stored context:
  - Quintal mode: (initialNetWeightKg × bagsToUse × rate) / (100 × originalLotSize)
  - Bag mode: bagsToUse × rate
  - bagsToUse = quantitySold (actual basis) or remainingSizeAtSale (totalRemaining basis)
- Extras (Kata, Extra Hammali, Grading) always added on top of base charge calculation
- FIFO recalculation triggered after charge edits using CurrentDueBuyerName logic
- Note: lots.netWeight is stored in KG (not quintals)

### Extra Due to Merchant (extraDueToMerchant)
- Separate field for buyer-specific surcharges charged by merchant
- Always tracked by ORIGINAL buyerName (NOT affected by transfers)
- Different from regular cold charges which use CurrentDueBuyerName (COALESCE(NULLIF(transferToBuyerName, ''), buyerName))
- Editable in Sales History Edit Dialog separately from cold charges
- Aggregated in merchant analytics and cash management by original buyer
- Database fields:
  - salesHistory.extraDueToMerchant (real, default 0): Remaining due (reduced by FIFO payments)
  - salesHistory.extraDueToMerchantOriginal (real, default 0): Original value set by user (for recompute)
- FIFO payment allocation: Two-pass system
  1. First pass: Apply receipts to cold storage dues (dueAmount) in FIFO order
  2. Second pass: If surplus remains, apply to extraDueToMerchant (by original buyerName, FIFO order)
- Recompute behavior: restores extraDueToMerchant to extraDueToMerchantOriginal before reapplying receipts for idempotency

### Bill Number System
- Four independent bill number sequences: Exit, Cold Storage Deduction, Sales, and Lot Entry
- Bill numbers assigned atomically on first print using UPDATE RETURNING pattern
- Numbers persist across reprints (stored in salesHistory/exitEntries/lots)
- All counters reset to 1 during season reset
- Lot entry bill numbers stored in lots.entryBillNumber, assigned when Print is clicked in receipt dialog

### Cash Flow Transaction IDs
- All cash flow entries (receipts, expenses, transfers) receive a unique transactionId
- Format: CF + YYYYMMDD + natural number starting from 1 (e.g., CF202601221, CF202601222)
- Generated atomically using dailyIdCounters table (entity type: 'cash_flow')
- IDs are globally unique across all cold storages
- Cash Management transaction list sorted by transactionId descending
- CSV export includes transactionId as first column
- Database fields: cashReceipts.transactionId, expenses.transactionId, cashTransfers.transactionId

### Start-of-Year Settings
- Settings button in Cash Management header (edit access only)
- Two tabs: Opening Balances and Receivables
- Year selector allows configuring for current or previous 2 years
- Opening balances (cash in hand, limit account, current account) affect displayed balance calculations
- Receivables track outstanding amounts due from buyers with payer type categories
- Buyer name autocomplete with popover shows suggestions from sales history immediately on focus
- Opening receivables for cold_merchant type are combined with sales history dues in buyer dropdown
- Database tables: cashOpeningBalances, openingReceivables (year-scoped)

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