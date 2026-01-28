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
- **lots**: Farmer lot entries with location, quality, bag information, optional bagTypeLabel, and entry-time deductions (advanceDeduction, freightDeduction, otherDeduction)
- **lotEditHistory**: Audit trail for lot modifications and partial sales
- **salesHistory**: Complete sales records with unique bill numbers, includes copied entry-time deductions for billing
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
  - **Quintal mode** (split calculation):
    - Cold charges (per quintal): (initialNetWeightKg × bagsToUse × coldChargeRate) / (100 × originalLotSize)
    - Hammali (per bag): hammaliRate × bagsToUse
    - Total base charge: sum of cold charges + hammali
  - **Bag mode**: (coldChargeRate + hammaliRate) × bagsToUse
  - bagsToUse = quantitySold (actual basis) or remainingSizeAtSale (totalRemaining basis)
- Extras (Kata, Extra Hammali, Grading, Entry Deductions) always added on top of base charge calculation
- **Proportional Entry Deductions**: Automatically calculated as (quantitySold / originalLotSize) × totalDeductions
  - Entry deductions (Advance, Freight, Other) are set at lot entry time and stored in both lots and salesHistory tables
  - When a partial or full sale is made, proportional deductions are included in "Total Billed Charges"
  - Display: Sale dialogs, Print bills, EditSaleDialog all show proportional amounts with (bagsSold/originalBags) formula
  - CSV exports include "Entry Deductions" column with proportional amounts for both Stock Register and Sales History
- FIFO recalculation triggered after charge edits using CurrentDueBuyerName logic
- Note: lots.netWeight is stored in KG (not quintals)
- Print bills display cold charges and hammali as separate line items (hammali always shows per bag unit)

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

### FIFO Trigger Points
All FIFO recomputation uses `recomputeBuyerPayments` which handles BOTH receipts AND discounts in a unified timeline:
- **Creating cash receipt**: Direct FIFO application via `createCashReceiptWithFIFO`
- **Creating discount**: Direct FIFO application via `createDiscountWithFIFO`
- **Reversing cash receipt**: Marks receipt as reversed, then calls `recomputeBuyerPayments` for affected buyer
- **Reversing discount**: Marks discount as reversed, then calls `recomputeBuyerPayments` for all affected buyers in allocations
- **Editing sale charges**: Calls `recomputeBuyerPayments` for CurrentDueBuyerName after charge update
- **Reversing sale**: Calls `recomputeBuyerPayments` for affected buyer after restoring bags
- **Adding opening receivable**: Calls `recomputeBuyerPayments` for cold_merchant with buyer name
- **Deleting opening receivable**: Calls `recomputeBuyerPayments` for cold_merchant with buyer name

The `recomputeBuyerPayments` function:
1. Resets all sales for buyer to baseline (dueAmount = coldStorageCharge, paidAmount = 0)
2. Resets extraDueToMerchant to original values
3. Resets opening receivables paidAmount to 0
4. Merges all active receipts + discounts into unified timeline sorted by date
5. Replays each transaction in chronological order (FIFO)
6. Recalculates lot totals for affected lots

### Bill Number System
- Four independent bill number sequences: Exit, Cold Storage Deduction, Sales, and Lot Entry
- Bill numbers assigned atomically on first print using UPDATE RETURNING pattern
- Numbers persist across reprints (stored in salesHistory/exitEntries/lots)
- All counters reset to 1 during season reset
- Lot entry bill numbers stored in lots.entryBillNumber, assigned when Print is clicked in receipt dialog

### Cash Flow Transaction IDs
- All cash flow entries (receipts, expenses, transfers, discounts, buyer-to-buyer transfers) receive a unique transactionId
- Format: CF + YYYYMMDD + natural number starting from 1 (e.g., CF202601221, CF202601222)
- Generated atomically using dailyIdCounters table (entity type: 'cash_flow')
- IDs are unique per cold store (not globally unique) - each cold store has its own independent CF sequence
- Counter key includes coldStorageId: `cash_flow_{coldStorageId}_{date}`
- Cash Management transaction list sorted by transactionId descending
- CSV export includes transactionId as first column
- Database fields: 
  - cashReceipts.transactionId
  - expenses.transactionId
  - cashTransfers.transactionId
  - discounts.transactionId
  - salesHistory.transferTransactionId (for buyer-to-buyer transfers)

### Due After Tracking
- Tracks remaining buyer/farmer dues after each cash receipt or discount transaction
- Database fields: cashReceipts.dueBalanceAfter, discounts.dueBalanceAfter
- Calculation method (for cold_merchant receipts):
  - salesHistory dues using CurrentDueBuyerName logic (COALESCE(transferToBuyerName, buyerName))
  - extraDueToMerchant by original buyerName
  - openingReceivables for cold_merchant type in current year
- For discounts: tracks remaining farmer dues after discount allocation
- Display: Badge in transaction list, row in payment details dialog
- CSV export: "Due After" column included between "Payer Type" and "Remarks"
- Note: Existing records (created before feature) have dueBalanceAfter=null; only new transactions populate this field

### Start-of-Year Settings
- Settings button in Cash Management header (edit access only)
- Two tabs: Opening Balances and Receivables
- Year selector allows configuring for current or previous 2 years
- Opening balances (cash in hand) affect displayed balance calculations
- Receivables track outstanding amounts due from buyers with payer type categories
- Buyer name autocomplete with popover shows suggestions from sales history immediately on focus
- Opening receivables for cold_merchant type are combined with sales history dues in buyer dropdown
- Database tables: cashOpeningBalances, openingReceivables (year-scoped)

### Dynamic Bank Accounts
- Replaced fixed two-account system (Current/Limit) with unlimited user-defined bank accounts per cold storage
- Bank accounts table: bankAccounts (id, coldStorageId, accountName, accountType, openingBalance, year)
- Account types: "current", "limit", "saving" (lowercase in database)
- CRUD operations in Settings Dialog (inside Cash Management page):
  - Add new bank accounts with name, type, and opening balance
  - Edit existing account details
  - Delete accounts with confirmation dialog
- Cash receipts and expenses use accountId (reference to bankAccounts table) instead of legacy accountType
- Cash transfers use fromAccountId/toAccountId fields
- Backward compatibility maintained:
  - API schemas accept both accountId and legacy accountType
  - Summary calculations check accountId first, fallback to accountType
  - getAccountLabel() helper displays actual account names with legacy fallback
- Summary calculations dynamically iterate over all bank accounts for per-account balances
- Filter dropdown supports filtering by dynamic bank account IDs
- Translation keys: bankAccounts, accountName, selectAccount, noBankAccounts, deleteBankAccountWarning

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