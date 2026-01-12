# Cold Storage Management App - Design Guidelines

## Design Approach

**Selected Framework:** Material Design 3
**Rationale:** Data-heavy operational tool requiring clear hierarchy, robust form handling, and vibrant data visualization. Material Design's elevation system and component library excel at organizing complex information while supporting the requested colorful, chart-rich interface.

---

## Core Design Elements

### Typography
- **Primary Font:** Roboto (via Google Fonts CDN)
- **Headings:** Roboto Medium (500) - Dashboard titles, section headers
- **Body Text:** Roboto Regular (400) - Form labels, data displays
- **Data/Numbers:** Roboto Mono - Lot numbers, capacities, measurements
- **Sizes:** text-2xl (headers), text-base (body), text-sm (labels), text-xs (hints)

### Layout System
**Spacing Primitives:** Tailwind units of 2, 4, 6, and 8 for consistent rhythm
- Padding: p-4 (mobile cards), p-6 (desktop cards), p-8 (page containers)
- Margins: mb-4 (form fields), mb-6 (sections), mb-8 (major divisions)
- Gaps: gap-4 (form grids), gap-6 (card grids)

**Grid Structure:**
- Mobile: Single column, full-width cards
- Desktop: 2-3 column grids for dashboard stats, 2-column forms
- Max container width: max-w-7xl for dashboard, max-w-4xl for forms

---

## Component Library

### Navigation & Header
**Top App Bar:**
- Fixed header with app title "Cold Store Manager"
- Language toggle (EN/HI) as icon button top-right
- Hamburger menu (mobile) / horizontal nav (desktop)
- Elevation shadow for depth

**Navigation Menu:**
- Dashboard (home icon)
- New Lot Entry (plus icon)
- Search/Edit Lot (search icon)
- Analytics (chart icon)
- Help section with contact info at bottom

### Dashboard (Section 1)

**Hero Statistics Cards:**
- Grid layout: 2 columns mobile, 4 columns desktop
- Cards with subtle elevation (shadow-md)
- Icon + Large Number + Label pattern
- Color-coded backgrounds (soft pastels):
  - Total Capacity: Blue tint
  - Capacity Used: Green tint (with progress bar)
  - Total Farmers: Purple tint
  - Total Lots: Orange tint

**Chamber Fill Rates Visualization:**
- Horizontal bar chart showing each chamber's capacity
- Color gradient: Empty (light) → Full (dark)
- Labels showing chamber number + percentage

**Bag Statistics:**
- Segmented pill display showing Wafer vs Seed counts
- Donut chart showing proportion

**Primary Action Button:**
- Large, prominent FAB (Floating Action Button) or full-width CTA
- "Add New Lot" with plus icon
- Positioned for easy thumb access (mobile) or prominent desktop placement

### Form Interface (Section 2 - New Lot Entry)

**Layout Pattern:**
- Progressive disclosure: group related fields
- 2-column grid on desktop, single column mobile
- Required field indicators (asterisk + red accent)

**Field Groups:**
1. **Farmer Details:** Name, Village/Tehsil/Dist combo, Contact
2. **Lot Information:** Lot #, Size, Type dropdown
3. **Storage Location:** Chamber, Floor, Position (decimal input)
4. **Quality Assessment:** Quality dropdown, Assaying type radio buttons
5. **Conditional Fields:** Image upload + RS/DM inputs (only if Quality Check selected)
6. **Additional:** Remarks textarea

**Input Components:**
- Material Design outlined text fields
- Dropdowns with clear label hierarchy
- Number spinners for position (fractional support)
- Image upload with preview thumbnail
- Auto-focus on first field

**Form Actions:**
- Bottom action bar with "Cancel" (text button) and "Submit" (filled button)
- Validation messages inline below fields

### Search/Edit Interface (Section 3)

**Search Header:**
- Segmented control: "By Phone" | "By Lot #" | "By Size"
- Large search input with search icon
- Results appear as cards below

**Result Cards:**
- Farmer name (heading)
- Lot details in grid format
- Edit icon button top-right
- Expandable section showing full details

**Edit Actions:**
- Inline editing with save/cancel
- "Mark Partial Sale" button opens dialog:
  - Input for quantity sold
  - Price point field
  - Automatic calculation of remaining
  - Change log timestamp

**Audit Trail:**
- Accordion component showing edit history
- Timeline visualization with dates

### Analytics Dashboard (Section 4)

**Chamber Quality Matrix:**
- Table view with color-coded cells
- Chambers in rows, quality levels in columns
- Heat map styling (poor=red tint, medium=yellow, good=green)

**Quality Distribution Charts:**
- Stacked bar chart: Chambers on X-axis, bag count on Y-axis
- Color segments: Poor (red), Medium (yellow), Good (green)
- Legend clearly labeled

**Summary Cards:**
- Count cards showing total bags per quality level
- Large number with icon and percentage

---

## Interaction Patterns

**Loading States:**
- Skeleton screens for dashboard data
- Spinner for form submissions
- Progress indicators for image uploads

**Feedback:**
- Snackbar notifications for success/error messages
- Bottom-positioned, auto-dismiss after 4s
- Action button for undo (where applicable)

**Empty States:**
- Illustrated placeholders when no data
- Call-to-action to add first lot

**Multi-language Support:**
- Toggle switches language globally
- All labels/text translate instantly
- Number formats remain consistent

---

## Mobile-Specific Considerations

- Bottom navigation bar for primary sections (Dashboard, Add, Search, Analytics)
- Thumb-zone optimization for primary actions
- Swipe gestures for card actions (edit/delete)
- Large touch targets (min 44x44px)
- Scrollable forms with sticky submit button

---

## Data Visualization Principles

**Color Coding System:**
- Quality: Red (poor) → Yellow (medium) → Green (good)
- Capacity: Blue gradient (empty to full)
- Types: Distinct colors for Wafer vs Seed
- Chambers: Unique color per chamber for quick identification

**Chart Requirements:**
- Use Chart.js or Recharts library
- Responsive sizing
- Interactive tooltips on hover
- Legend placement: bottom on mobile, right on desktop

---

## Footer Elements

**App Footer:**
- "Created & Maintained by KrashuVed"
- "All Rights Reserved"
- Help contact: "Reach out: 8882589392"
- Language toggle mirrored here
- Minimal, centered text styling