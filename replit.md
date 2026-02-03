# Cold Store Manager

## Overview

Cold Store Manager is a full-stack web application designed to streamline and manage cold storage operations. Its primary purpose is to efficiently track potato lots, monitor chamber capacities, assess product quality, and provide detailed analytics on storage performance. The application aims to offer a comprehensive dashboard for cold storage operators, supporting bilingual interactions (English/Hindi) to cater to a broader user base. The project envisions enhancing operational efficiency, improving inventory accuracy, and providing valuable insights for better decision-making within the cold storage industry.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **UI Components**: shadcn/ui (built on Radix UI)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Forms**: React Hook Form with Zod validation
- **Internationalization**: Custom context for English/Hindi

### Backend
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ES modules)
- **API**: RESTful JSON at `/api/*`
- **Build**: Vite (dev), esbuild (prod)

### Data Layer
- **ORM**: Drizzle ORM (PostgreSQL dialect)
- **Schema**: `shared/schema.ts` (shared between frontend/backend)
- **Validation**: Zod schemas (generated from Drizzle)
- **Storage**: Interface-based (`IStorage`) with in-memory implementation

### Key Design Patterns
- **Shared Types**: Centralized schema definitions for client and server.
- **Form Validation**: Zod for consistent client/server validation.
- **Component Architecture**: Reusable UI components and feature-specific components.

### Core Features
- **Database Schema**: Manages coldStorages, coldStorageUsers, chambers, lots, lotEditHistory, salesHistory, exitEntries, and cashFlow.
- **User Authentication**: Mobile number/password login, database-backed sessions, protected routes, change password. Features a KrashuVed splash screen.
- **Admin Panel**: Hidden `/admin` route for managing cold storages and users (create, edit, delete, set access, reset passwords), protected by `ADMIN_PASSWORD`.
- **Sales History & Charges**: Allows editing cold storage charges post-sale. Supports quintal and bag-based charge calculation, proportional entry deductions (Advance, Freight, Other), and tracks `extraDueToMerchant` separately. FIFO recalculation triggered by charge edits.
- **FIFO Payment System**: Comprehensive recomputation (`recomputeBuyerPayments`) for receipts, discounts, sales edits, reversals, and opening receivables, ensuring chronological application of payments against dues. Handles both cold storage dues and `extraDueToMerchant`.
- **Bill Numbering**: Atomic, independent sequences for Exit, Cold Storage Deduction, Sales, and Lot Entry bills, resettable seasonally. Lot entry bill numbers are assigned on print.
- **Cash Flow Transaction IDs**: Unique `CF + YYYYMMDD + number` IDs for all cash flow entries, generated atomically per cold store.
- **Due After Tracking**: Records remaining buyer/farmer dues after each cash receipt or discount transaction, displayed in transaction lists and CSV exports.
- **Start-of-Year Settings**: Configurable opening balances (cash in hand) and receivables (buyer/farmer dues) for current and previous two years, integrated with buyer autocomplete.
- **Farmer Receivables**: Specific tracking for farmers including contact, village, district, state. Cash Inward supports farmer payer type with FIFO payment allocation across all farmer receivables and self-sales.
- **Self-Sale Feature**: Allows farmers to buy their own produce, tracked as "Farmer" payer type dues, separate from "Cold Merchant" dues, and integrated into the farmer payment FIFO system.
- **Farmer FIFO Recomputation**: Comprehensive `recomputeFarmerPayments` function triggered by: farmer payment, farmer payment reversal, self-sale reversal, and self-sale edit. FIFO order: receivables first (by createdAt), then self-sales (by soldAt). Uses petty balance threshold (<₹1 = paid).
- **Dynamic Bank Accounts**: Unlimited user-defined bank accounts (current, limit, saving) with CRUD operations. Cash transactions reference account IDs, maintaining backward compatibility.
- **Buyer Ledger**: Central registry for all buyers (merchants) with auto-generated IDs (BYYYYYMMDD1 format). Tracks PY Receivables (opening receivables), Sales Due (unpaid sales), and Due Transfer In (farmer-to-buyer transfers). Supports merge detection on name changes, edit history, and archive/reinstate. Key is buyer name only (case-insensitive, trimmed).
- **Farmer Ledger**: Central registry for all farmers with auto-generated IDs (FMYYYYMMDD1 format). Key is (name, contact, village). Tracks PY Receivables, Self Due, and Merchant Due.
- **Lot Numbering**: Auto-resets to 1 each calendar year using on-the-fly max+1 calculation. Separate counters for Wafer vs Seed/Ration categories.

## External Dependencies

### Database
- **PostgreSQL**: Primary database.
- **Drizzle Kit**: Database migrations.

### UI/UX Libraries
- **Radix UI**: Accessible UI primitives.
- **Recharts**: Data visualization.
- **Lucide React**: Icons.
- **date-fns**: Date utilities.

### Development Tools
- **Vite**: Frontend build and dev server.
- **esbuild**: Production server bundling.
- **TypeScript**: Language.

### Replit Specific
- **@replit/vite-plugin-runtime-error-modal**
- **@replit/vite-plugin-cartographer**
- **@replit/vite-plugin-dev-banner**