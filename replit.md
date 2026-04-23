# Cold Store Manager

## Overview

Cold Store Manager is a full-stack web application designed to streamline and manage cold storage operations. Its primary purpose is to efficiently track potato lots, monitor chamber capacities, assess product quality, and provide detailed analytics on storage performance. The application aims to offer a comprehensive dashboard for cold storage operators, supporting bilingual interactions (English/Hindi) to cater to a broader user base. The project envisions enhancing operational efficiency, improving inventory accuracy, and providing valuable insights for better decision-making within the cold storage industry.

## User Preferences

Preferred communication style: Simple, everyday language.

## Timezone Convention (IST, end-to-end)

This project operates entirely in India Standard Time (`Asia/Kolkata`). When working on the server, SQL, schema, or any timestamp-bearing code, assume IST wall-clock everywhere — there is no UTC anywhere in the business layer.

- **Node process** is pinned to IST: `process.env.TZ = 'Asia/Kolkata'` at the top of `server/index.ts`. So `new Date()`, `Date.getFullYear()`, date-fns `format(...)`, and any Date→string conversion on the server runs in IST.
- **Postgres session** is pinned to IST: every pooled connection runs `SET TIME ZONE 'Asia/Kolkata'` (see the `connect` listener in `server/db.ts`). So `now()`, `CURRENT_TIMESTAMP`, `CURRENT_DATE`, `EXTRACT`, `date_trunc`, `::date`, and every column with `.defaultNow()` operate in IST wall-clock.
- **Schema** uses `timestamp(..., { withTimezone: true })` (`TIMESTAMPTZ`) for every column except `exit_history.exit_date`. See "Off-by-one TZ bug — schema-wide resolution" below.

Rules for new code:
- Use `new Date()` for "now". Do **not** use `new Date(Date.UTC(...))` to populate a timestamp column.
- Do **not** parse `Z`-suffixed ISO strings from external sources straight into a timestamp column without first converting to IST wall-clock.
- New raw SQL date math may rely on the session being IST (no need to wrap in `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'`). The four pre-existing wrappers in `server/storage.ts` are kept as-is for stability.
- Client-side formatting uses the browser TZ; users are in India so this resolves to IST naturally. Only force `timeZone: 'Asia/Kolkata'` if you have a specific reason.

### Off-by-one TZ bug — schema-wide resolution

Background: the Postgres session is IST, so `defaultNow()` writes IST wall-clock values into bare `timestamp` columns. The `pg` driver later parses those values as UTC, which shifts any post-6:30 PM IST value forward by one calendar day whenever the column is rendered. Task #218 patched `exit_history.exit_date` at the route layer; Task #219 migrated the eight columns that were already user-visible to `timestamptz`; Task #220 then converted **every remaining bare `timestamp` column** in `shared/schema.ts` to `timestamptz` so the bug class can never resurface (e.g. when a future feature starts rendering an audit `created_at`).

**Single documented exception: `exit_history.exit_date`.** It stays a bare `timestamp` because Task #218 already fixed it at the route layer (anchoring to noon IST), and four `EXTRACT(... FROM (exit_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))` SQL wrappers in `server/storage.ts` depend on it staying a bare timestamp.

**Migration mechanics:** the conversion happens in two complementary places — `scripts/post-merge.sh` (idempotent psql loop, runs BEFORE `npm run db:push` so drizzle's auto-generated ALTER doesn't fall back to a default UTC cast) and the runtime migration `2026-04-23_convert_all_timestamps_to_timestamptz` in `server/migrations.ts` (also idempotent, safety net for environments that skip post-merge). Both use `... AT TIME ZONE 'Asia/Kolkata'` so the historic IST wall-clock values are re-interpreted correctly — which fixes the off-by-one bug for both new and old data. The earlier, narrower migration `2026-04-23_convert_displayed_dates_to_timestamptz` is retained in the registry as a no-op for environments that already applied it.

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
- **Sale Cache Invalidation**: Any React Query mutation that writes to a sale, exit, payment, cash-receipt, cash-transfer, discount, up-for-sale, buyer-ledger, or farmer-ledger endpoint must call `invalidateSaleSideEffects(queryClient)` from `@/lib/queryClient` (typically in `onSuccess`) so NIKASI / Exit Register / Cash Flow / Buyer & Farmer Ledger views refresh automatically. The guardrail script `scripts/check-sale-invalidation.mjs` enforces this; run it locally or via the `sale-invalidation` validation. It also runs as part of `scripts/post-merge.sh`. Document any legitimate exception (e.g. roster-only ledger writes that don't change sale aggregates) with `// guardrail-allow: skip-sale-invalidation -- <reason>` directly above or inside the `useMutation` call.

### Year Conventions
- **Operations** (lots, sales, cash flow, receivables, expenses, lot numbering, year filters): Calendar year (Jan-Dec)
- **Financial Statements & Depreciation**: Indian Financial Year (April 1 – March 31), labeled "YYYY-YY" (e.g., "2025-26")
- **Depreciation Proration**: Based on months within the FY. Asset purchased in November → 5 months in that FY.
- **Balance Sheet Date**: As of March 31 of the FY end.

### Core Features
- **Database Schema**: Manages migrations, coldStorages, coldStorageUsers, chambers, lots, lotEditHistory, salesHistory, exitEntries, cashFlow, assets, assetDepreciationLog, liabilities, liabilityPayments.
- **One-Time Migrations**: Registry-based system in `server/migrations.ts`. Each migration has a unique name and runs once on startup; the `migrations` table tracks applied migrations. To add: append to `MIGRATIONS` array with a dated name. To remove: delete the entry — the DB record prevents re-runs.
- **User Authentication**: Mobile number/password login, database-backed sessions, protected routes, change password. Features a KrashuVed splash screen.
- **Admin Panel**: Hidden `/admin` route for managing cold storages and users (create, edit, delete, set access, reset passwords), protected by `ADMIN_PASSWORD`.
- **Sales History & Charges**: Allows editing cold storage charges post-sale. Supports quintal and bag-based charge calculation, proportional entry deductions (Advance, Freight, Other), and tracks `extraDueToMerchant` separately. FIFO recalculation triggered by charge edits.
- **FIFO Payment System**: Comprehensive recomputation (`recomputeBuyerPayments`) for receipts, discounts, sales edits, reversals, and opening receivables, ensuring chronological application of payments against dues. Handles both cold storage dues and `extraDueToMerchant`.
- **Bill Numbering**: Atomic, independent sequences for Exit, Cold Storage Deduction, Sales, and Lot Entry bills, resettable seasonally. Lot entry bill numbers are assigned on print.
- **Cash Flow Transaction IDs**: Unique `CF + YYYYMMDD + number` IDs for all cash flow entries, generated atomically per cold store.
- **Due After Tracking**: Records remaining buyer/farmer dues after each cash receipt or discount transaction, displayed in transaction lists and CSV exports.
- **Start-of-Year Settings**: Configurable opening balances (cash in hand) and receivables (buyer/farmer dues) for current and previous two years, integrated with buyer autocomplete.
- **Interest Accrual**: Yearly-compounding simple interest for opening receivables, farmer advance/freight, and merchant advances. Daily accrual uses `min(latestPrincipal, finalAmount)` as principal, computes simple interest from `effectiveDate`, and compounds annually (principal = finalAmount at year boundary, effectiveDate jumps +1 year). Payments reduce finalAmount at recording time; accrual picks up reduced amount via min(). `latestPrincipal` column stores the principal used for calculation. `lastAccrualDate` is a guard-only field (prevents same-day re-run).
- **Farmer Receivables**: Specific tracking for farmers including contact, village, district, state. Cash Inward supports farmer payer type with FIFO payment allocation across all farmer receivables and self-sales.
- **Self-Sale Feature**: Allows farmers to buy their own produce, tracked as "Farmer" payer type dues, separate from "Cold Merchant" dues, and integrated into the farmer payment FIFO system.
- **Master Nikasi Buyer Target**: Master Nikasi dialog includes a buyer picker (defaults to "Self"). Selecting a real buyer ledger routes the entire batch as a regular sale to that buyer (due tracked under cold_merchant) instead of a self-sale; per-row buyer-portion logic still applies inside `createMasterNikasi`.
- **Farmer FIFO Recomputation**: Comprehensive `recomputeFarmerPayments` function triggered by: farmer payment, farmer payment reversal, self-sale reversal, and self-sale edit. FIFO order: receivables first (by createdAt), then self-sales (by soldAt). Uses petty balance threshold (<₹1 = paid).
- **Dynamic Bank Accounts**: Unlimited user-defined bank accounts (current, limit, saving) with CRUD operations. Cash transactions reference account IDs, maintaining backward compatibility.
- **Buyer Ledger**: Central registry for all buyers (merchants) with auto-generated IDs (BYYYYYMMDD1 format). Tracks PY Receivables (opening receivables), Sales Due (unpaid sales), and Due Transfer In (buyer-to-buyer transfers). Supports merge detection on name changes, edit history, and archive/reinstate. Key is buyer name only (case-insensitive, trimmed).
- **Farmer Ledger**: Central registry for all farmers with auto-generated IDs (FMYYYYMMDD1 format). Key is (name, contact, village). Tracks PY Receivables, Self Due, and Merchant Due. Supports `entityType` ("farmer" or "company") and custom per-farmer `customColdChargeRate`/`customHammaliRate` overrides. Company entities always use quintal-based charging regardless of global setting.
- **Charge Calculation Priority**: Sale-time custom rates > farmer-level custom rates > global default rates. `chargeUnitAtSale`, `coldCharge`, `hammali` are baked into sale records at creation and never re-derived. Company entities force quintal mode; farmers use global chargeUnit setting.
- **Ledger ID Tracking**: All transaction tables (salesHistory, cashReceipts, openingReceivables) store both ledger ID (record UUID) and entity ID (BYYYYYMMDD1/FMYYYYMMDD1) at time of creation for consistent tracking. Sales store buyerLedgerId/buyerId; cash receipts store farmerLedgerId/farmerId for farmer payer type or buyerLedgerId/buyerId for cold_merchant payer type; opening receivables store both farmer and buyer IDs based on payer type.
- **Lot Numbering**: Auto-resets to 1 each calendar year using on-the-fly max+1 calculation. Separate counters for Wafer vs Seed/Ration categories.
- **Asset Register**: Full CRUD for fixed assets with categories (building, plant_machinery, furniture, vehicles, computers, electrical_fittings, other). Supports opening assets (existing) and assets created via capital expenses. Tracks original cost, current book value, depreciation rate, and disposal.
- **Depreciation Engine**: WDV (Written Down Value) method per Indian IT Act rates. FY-based calculation with month proration. Rates: building 10%, furniture 10%, plant_machinery 15%, vehicles 15%, computers 40%, electrical_fittings 10%, other 10%. Idempotent — recalculates if run again for same FY.
- **Liability Tracker**: CRUD for liabilities (bank_loan, equipment_loan, credit_line, outstanding_payable, other). Tracks outstanding amounts, interest rates, EMI, settlement. Payment recording with principal/interest split and reversals.
- **Capital Expense Flow**: Expense form has Revenue/Capital toggle. Capital expenses create both an expense record (`expenseClass: 'capital'`) and a linked asset. `expenseClass` column on expenses table defaults to `'revenue'` for all existing data.
- **Expense Classification**: Three classes — `'revenue'` (operational expenses shown on P&L), `'capital'` (asset purchases), and `'advance'` (short-term loans: farmer_advance, farmer_freight, merchant_advance). Advances are excluded from P&L and shown as Current Assets on the Balance Sheet.
- **Balance Sheet**: FY-based report showing Fixed Assets (by category after depreciation), Current Assets (Farmer PY Receivables, Buyer PY Receivables, Farmer Advance, Farmer Freight, Merchant Advance — outstanding balances from `opening_receivables`, `farmer_advance_freight`, `merchant_advance` tables), Long-term Liabilities, Current Liabilities (includes auto-calculated limit account outstanding from bank account transactions), and Owner's Equity. CSV export via `?format=csv`. Equity = Total Assets (Fixed + Current) - Total Liabilities.
- **Profit & Loss**: FY-based report showing Income (cold storage charges, other income) and Expenses (revenue expenses by type, depreciation, interest on liabilities). Advances/freight are excluded (classified as `'advance'` not `'revenue'`). Net Profit/Loss calculation. CSV export via `?format=csv`.
- **Navigation**: Books section with Asset Register (`/assets`), Liability Register (`/liabilities`), Balance Sheet (`/balance-sheet`), Profit & Loss (`/profit-and-loss`).

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