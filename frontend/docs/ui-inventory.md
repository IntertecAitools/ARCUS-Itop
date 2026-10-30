# Frontend UI inventory — sidebar, pages and components

A complete map of what the frontend (`frontend/src`) shows: every sidebar item, the page each one opens, and every component on each page, with its type. It is generated from the code and from the schema files the BFF serves (`cmdb-schema/*.json`), as of commit `1234db8` on `frontend`.

**How to read it**

- **Part A** covers the app shell (sidebar, top bar, command palette) and the pages that were built by hand: the Dashboard, the Incidents list, the incident detail and New incident pages, plus the Modules, Records, Not-found and Attachments screens.
- **Part B** lists every sidebar group and entry from iTop's menu, with the route and the page each one opens. For dashboard entries it lists every panel.
- **Part C** lists, for every record class those entries open, the list columns, the detail tabs, the lifecycle buttons and **every field** with its label, type, read-mode display, edit control and whether it is required.

**Component type legend**

| Type | Meaning |
|---|---|
| Layout | Page chrome and structure (Sidebar, Topbar, PageHeader, Card) |
| Navigation | Links, breadcrumbs, tabs, the command palette |
| Form control | Input, Select, Textarea, date picker, file input |
| Action | Button, IconButton, a link styled as a button |
| Data display | Table, badge, pill, avatar, KPI tile, label/value list |
| Chart | Donut, trend (area/line), bar, sparkline |
| Feedback | Empty state, skeleton loader, error alert, spinner, error boundary |
| Overlay | Modal dialog, dropdown menu, command palette |

---

# PART A — App shell and hand-built pages

## A1. Routes (`config/modules.ts` → `app/router/routes.tsx`)

| Route | Page component | Shown in sidebar? | Reached from |
|---|---|---|---|
| `/` | Redirect → `/dashboard` | — | — |
| `/dashboard` | **DashboardPage** | **Yes** (only built module with its own nav item) | Sidebar "Dashboard", logo, Not-found page |
| `/incidents` | **IncidentListPage** | No (hidden) | Dashboard "View all" links |
| `/incidents/new` | **NewIncidentPage** | No | "New incident" button on the Incidents list |
| `/incidents/:id` | **IncidentDetailPage** | No | Rows on the Incidents list and dashboard tables |
| `/records` | **RecordsIndexPage** | No (hidden) | "All classes" buttons, breadcrumbs |
| `/records/:className` | **RecordListPage** | No | Every iTop list / search entry in the sidebar |
| `/records/:className/new` | **RecordNewPage** | No | Every iTop "New …" entry in the sidebar |
| `/records/:className/:id` | **RecordDetailPage** | No | Rows on any record list, related links, dashboard panels |
| `/dashboards` and `/dashboards/:id` | **DashboardViewPage** | No (hidden) | Every "Overview" / dashboard entry in the sidebar |
| `/modules` | **ModulesIndexPage** | No (hidden) | "All" link in the sidebar's Modules header; the collapsed sidebar icon |
| `*` | **NotFoundPage** | — | Any unknown URL |

> Important: the **Incident Management** entries in the sidebar ("Assigned to me", "Open", "New incident"…) open the **generic** record pages (`/records/Incident…`), not the hand-built `/incidents` pages. The hand-built Incidents pages are reached only from the Dashboard's cross-links.

## A2. App shell — `AgentLayout` (wraps every page)

| # | Component | Type | What it is / does |
|---|---|---|---|
| 1 | "Skip to content" link | Navigation (accessibility) | Hidden until focused; jumps to `#main` |
| 2 | **Sidebar** | Layout | Fixed left column, collapsible (see A3) |
| 3 | **Topbar** | Layout | Fixed top bar (see A4) |
| 4 | `<main>` content well | Layout | Max width 1600px; holds the current page |
| 5 | **ErrorBoundary** | Feedback | Catches a page crash so the shell keeps working; shows a "Try again" secondary Button |
| 6 | **Suspense → RouteFallback (Spinner)** | Feedback | Shown while a lazy-loaded page downloads |
| 7 | **CommandPalette** | Overlay | Ctrl/Cmd+K search-and-jump dialog (see A5) |

## A3. Sidebar (`components/layout/Sidebar.tsx` + `ItopNavigation.tsx`)

| # | Element | Type | Details |
|---|---|---|---|
| 1 | **Logo** | Layout / brand | SVG mark + app name (`VITE_APP_NAME`, default "Intertec") + tagline (`VITE_PLATFORM_NAME`, default "Servicedesk"). Name hidden when collapsed |
| 2 | **Built modules** group | Navigation | `NavItem`s generated from `modules.ts`. Today one item: **Dashboard** (LayoutDashboard icon). Active item gets a brand-coloured left bar. Supports a red count badge (`badgeKey`), unused by Dashboard |
| 3 | **"Modules" header + "All" link** | Navigation | Opens `/modules` |
| 4 | **iTop module groups** (`GroupSection` × 10) | Navigation (collapsible) | One collapsible button per iTop menu group (10), with icon + chevron. The group containing the current page opens automatically. Each entry is a `NavLink`; "create" entries show a `NEW` hint and "search" entries show `SEARCH` |
| 5 | Loading state | Feedback | 3 pulsing skeleton bars while the navigation loads |
| 6 | Collapsed state | Navigation | The whole iTop tree folds into one LayoutGrid icon linking to `/modules` |
| 7 | **Collapse / Expand** button | Action | Bottom of the sidebar; toggles width; state kept in `ui.store` |

**The sidebar, top to bottom** (groups come from the BFF's `/api/meta/navigation`, built from `cmdb-schema/cmdb-navigation.json`):

| Group (icon) | Entries (kind) |
|---|---|
| — **Dashboard** (built module) | Dashboard |
| **Welcome** (LayoutGrid) | Welcome (dashboard) |
| **Configuration management** (Boxes) | Overview (dashboard) · Contacts (dashboard) · New contact (new) · Locations (list) · Search for contacts (search) · New CI (new) · Search for CIs (search) · Documents (list) · Software catalog (list) · Groups of CIs (list) |
| **Helpdesk** (Headphones) | Overview (dashboard) · Assigned to me (list) · New request (new) · Under escalation (list) · Search for requests (search) · Open (list) · Initiated by me (list) |
| **Incident Management** (Siren) | Overview (dashboard) · Assigned to me (list) · New incident (new) · Under escalation (list) · Search for incidents (search) · Open (list) · Reported by me (list) |
| **Problem management** (FileWarning) | Overview (dashboard) · New problem (new) · My problems (list) · Search for problems (search) · All open problems (list) · New known error (new) · All known errors (list) · Search for known errors (search) · FAQ categories (list) · FAQs (list) |
| **Change management** (RefreshCw) | Overview (dashboard) · New change (new) · Changes assigned to me (list) · Search for changes (search) · Open changes (list) · Changes awaiting approval (list) · Changes awaiting acceptance (list) |
| **Service management** (Layers) | Overview (dashboard) · Customer contracts · Provider contracts · Service families · Services (lists) · Service catalog (dashboard) · Service subcategories · SLAs · SLTs · Delivery models (lists) |
| **Data administration** (Database) | Organizations (list) · Typology configuration (dashboard) |
| **Administration** (ShieldCheck, admin) | User accounts (list) · Profiles (list) · Audit configuration (dashboard) |
| **Configuration** (Settings, admin) | OAuth Mail Access (list) |

Totals: 10 iTop groups, 58 entries, plus the Dashboard item. 17 iTop menu nodes are deliberately left out; they are listed on the Modules page (A9).

## A4. Topbar (`components/layout/Topbar.tsx`)

| # | Component | Type | Details |
|---|---|---|---|
| 1 | Search bar button | Action → Overlay | Placeholder "Search incidents, requests, assets, knowledge articles…" plus a `Ctrl K` key hint. Opens the CommandPalette. Global Ctrl/Cmd+K shortcut |
| 2 | **ThemeToggle** | Action (IconButton) | Switches light/dark (Moon/Sun icon) |
| 2a | **LanguagePicker** (`features/auth`) | Action (native select) | English / العربية. Sets `<html lang dir>` (Arabic is right-to-left), saved on the device and on the account (`PUT /auth/language`). Also on sign-in and in the portal header |
| 3 | Notifications | Action (IconButton) | Bell + red unread dot. **No panel is wired yet**, and the dot always shows |
| 4 | Help and documentation | Action (IconButton) | CircleHelp icon. **Not wired yet** |
| 5 | Divider | Layout | Vertical hairline |
| 6 | **UserMenu** | Overlay (dropdown menu) | Avatar + name + role → menu with name/email header, **Preferences** and **Sign out**. Both items are **placeholders with no action**. User is a hard-coded `admin / Administrator` from `session.store` |

## A5. Command palette (`components/overlays/CommandPalette.tsx`)

| Element | Type | Details |
|---|---|---|
| Backdrop | Overlay | Click closes |
| Search input | Form control | "Jump to a module, or search tickets…" plus an `Esc` key hint |
| Result list | Navigation (listbox) | Built modules (Dashboard) plus **every iTop sidebar entry** (58), each with a kind icon (Plus / Search / List), label and "group · class" line. Arrow keys move, Enter opens, Esc closes |
| Empty result | Feedback | "No module matches "…"" |

## A6. Shared page pieces

| Component | Type | Used on |
|---|---|---|
| **PageHeader** | Layout | Every page: breadcrumbs, H1 title, description line, right-aligned actions row |
| **Breadcrumbs** | Navigation | Inside PageHeader; "Home › … › current" |
| **Card / CardHeader / CardBody / CardFooter** | Layout | Container for nearly every block |
| **EmptyState** | Feedback | Icon + title + description + optional action |
| **Skeleton / SkeletonCard** | Feedback | Loading placeholders |
| Error alert box (`role="alert"`, red) | Feedback | Load or save failures on every page |

---

## A7. Dashboard page — `/dashboard` (`features/dashboard`)

**Data:** `GET /api/dashboard/overview?range=…` (one request feeds every card).

| # | Section | Component | Type | Contents / behaviour |
|---|---|---|---|---|
| 1 | Header | PageHeader | Layout | Breadcrumb Home › Dashboard. Title "Good morning/afternoon/evening, {user}". Description "Here's an overview of your IT operations." |
| 2 | Header action | Today's date chip | Data display | CalendarDays icon + long date |
| 3 | Header action | **Date range** Select | Form control | Last 24 hours / Last 7 days (default) / Last 30 days / Last 90 days. Stored in the URL as `?range=` |
| 4 | Row 1 | **KpiRow** → 4 × **KpiCard** | Data display + Chart | **Total Incidents** (brand, FileText), **Open Incidents** (critical, TriangleAlert), **SLA Breached** (warning, Clock), **SLA Compliance %** (good, ShieldCheck). Each tile has a value, a delta ("↑ x vs last week") and a **Sparkline** (bars for brand, line for the others). Loading shows 4 SkeletonCards |
| 5 | Row 2 (5/12) | **IncidentTrendCard** | Chart | **TrendChart** (Recharts area/line): series **Created** (filled) and **Resolved**, with a **ChartLegend** in the header. Empty: "No activity in this period" |
| 6 | Row 2 (4/12) | **CategoryBreakdownCard** | Chart | **DonutChart** (total in the centre) + vertical **ChartLegend** with values; hovering links the slice and the legend. "View all → /incidents" |
| 7 | Row 2 (3/12) | **SlaPerformanceCard** | Chart | DonutChart with On Time (green) / At Risk (amber) / Breached (red), compliance % in the centre, plus a legend. Its "View details → /sla" link is hidden because that module isn't built |
| 8 | Row 3 (7/12) | **RecentIncidentsCard** | Data display (table) | **DataTable** columns: ID (link) · Summary · Priority (**PriorityBadge**) · Status (**StatusPill**) · Assignee (**Avatar** + name / "Unassigned") · Created · ⋮ (IconButton). Clicking a row opens `/incidents/:id`. "View all → /incidents" |
| 9 | Row 3 (5/12) | **MyAssignmentsCard** | Navigation (Tabs) + table | **Tabs**: Incidents / Approvals / Requests, each with a count. DataTable columns: ID · Summary · Priority · Status · ⋮. "View all → /incidents?assignee=me" |
| 10 | Row 4 (5/12) | **ServiceRequestShortcuts** | Data display (tiles) | 4 tiles (Access / Hardware / Software / Email icons) with label + description. The "Create" button is **hidden** until a service-catalog module exists |
| 11 | Row 4 (4/12) | **ChangeCalendarCard** | Data display (calendar) | Prev/Next week **IconButtons**, month label, 7 day buttons (a dot marks days with changes, the selected day is filled), then the selected day's changes: risk dot (low/medium/high), ref, title, time. Its "View all → /changes" link is hidden because that module isn't built |
| 12 | Row 4 (3/12) | **KnowledgeArticlesCard** | Data display (list) | Article rows: FileText icon, title, "N views". Rows are not links because the knowledge module isn't built |

## A8. Incidents — hand-built pages (`features/incidents`)

### A8.1 Incidents list page — `/incidents` (IncidentListPage)

| # | Component | Type | Details |
|---|---|---|---|
| 1 | PageHeader | Layout | Home › Incidents. Title "Incidents". Description "{N} incidents matching this view." |
| 2 | **"+ New incident"** | Action (link button, primary) | → `/incidents/new` |
| 3 | Error alert | Feedback | "Couldn't load incidents. …" |
| 4 | **IncidentFilterBar** | Form controls | **Search** Input (Search icon, ✕ clear button, debounced 350 ms, "Search by reference or summary…") · **Status** Select (All statuses / New / Open / In Progress / Pending / Resolved / Closed) · **Priority** Select (All priorities / Critical / High / Medium / Low) · **Assignee** Select (Anyone / Unassigned) · **"Clear N filters"** ghost Button. All filters live in the URL |
| 5 | **DataTable** inside a Card | Data display (table) | Columns: **ID** (link, e.g. INC-1042) · **Summary** · **Priority** (PriorityBadge) · **Operational Status** (text) · **Status** (StatusPill) · **Caller** · **Organisation** · **Assignee** (Avatar + name / "Unassigned") · **Created** (short date-time) · **⋮** row-actions IconButton. Sortable headers; clicking a row opens the detail page; 8 skeleton rows while loading |
| 6 | **IncidentPagination** | Navigation | "1–20 of 134" · **Previous** / **Next** secondary Buttons · "page / pages" |
| 7 | EmptyState | Feedback | "No incidents yet" + "Raise the first one" button, or "No incidents match these filters" |

### A8.2 Incident detail page — `/incidents/:id` (IncidentDetailPage)

| # | Area | Component | Type | Details |
|---|---|---|---|---|
| 1 | Header | PageHeader | Layout | Home › Incidents › {ref}. Title = incident summary. Description row: ref · **StatusPill** · **PriorityBadge** · "Raised {friendly date}" |
| 2 | Header actions | **Edit** Button (Pencil, secondary) | Action | Hidden when closed; opens **IncidentEditDialog** |
| 3 | Header actions | **All incidents** (ArrowLeft) | Action (link) | → `/incidents` |
| 4 | Banner | **SlaBanner** | Feedback (alert) | Red "SLA breached on time to own / time to resolve" when breached |
| 5 | Left 2/3 | **Description** Card | Data display | Plain text of the description |
| 6 | Left | **Resolution** Card (when resolved) | Data display | Subtitle "Code: …" + solution text |
| 7 | Left | **Private Log** Card (when it has entries) | Data display | Wraps an IncidentCaseLog |
| 8 | Left | **IncidentCaseLog — "Activity"** | Data display + Form | Subtitle "N public entries". Each entry shows **Avatar**, author, date and message. Then a **Textarea** "Add an update for the caller…" and a **"Post update"** Button (Send icon). EmptyState "Nothing logged yet" |
| 9 | Right 1/3 | **Actions** Card → **IncidentActions** | Action + Form | Buttons come from the backend's `availableActions`: **Assign**, **Reassign**, **Resolve**, **Put on hold**, **Close**, **Reopen**. Choosing one opens an inline panel: Assign/Reassign → **Agent** Select; Resolve → **Resolution** Textarea + **Resolution code** Select (optional). Then **Confirm …** and **Cancel**. Closed: "This incident is closed. No further actions are available." |
| 10 | Right | **Details** Card (label/value list `dl`) | Data display | Assignee (Avatar) · Team · Caller · Organisation · Service · Category · Priority (PriorityBadge) · Operational Status (**OperationalStatusPill**) · Urgency · Impact · Origin · Escalation Flag · Escalation Reason · Pending Reason · Resolved · Closed · Last updated · Assignment Date · Last Pending Date · TTO Escalation Deadline · TTR Escalation Deadline · Parent Incident (link) · Parent Request (link) · Parent Problem (link) · Parent Change (link) · Related Requests (link list / "None") · Child Incidents (link list / "None") · Resolution · Resolution Code · Time Spent · User Satisfaction · User Comment · SLA TTO Passed / TTO Over / TTR Passed / TTR Over (Yes/No). Empty values are hidden |
| 11 | Overlay | **IncidentEditDialog** | Overlay (modal form) | Title "Edit {ref}" + ✕. Fields: **Title** (Input) · **Description** (Textarea, 5 rows) · **Urgency** (select, hint "Urgency and impact together set the priority.") · **Impact** (select) · **Assignee** (select, "Unassigned") · **Team** (select, "None"). Footer **Cancel** / **Save changes**. Sends only the fields that changed. Esc or a backdrop click closes it |
| 12 | States | Skeleton (2 blocks) / "Incident not found" card + "Back to incidents" | Feedback | |

### A8.3 New incident page — `/incidents/new` (NewIncidentPage)

Form built with react-hook-form and the Zod `newIncidentSchema`.

| # | Area | Field / component | Control type | Required | Notes |
|---|---|---|---|---|---|
| 1 | Header | Eyebrow "New incident", H1 "Create a new incident", subtitle | Layout | | |
| 2 | Header | **Cancel** (ghost link) · **Submit incident** (primary submit) | Action | | Submit is disabled while options load |
| 3 | Main card "Incident details" | **Subject** (`title`) | Text input | Yes | Max 255 characters |
| 4 | | **Description** | Textarea (8 rows) | Yes | Max 10,000 characters; hint about there being no length limit |
| 5 | | **Source** (`origin`) | Select | | Default "portal" |
| 6 | | **Urgency** | Select | Yes | "Select urgency" |
| 7 | | **Impact** | Select | Yes | "Select impact" |
| 8 | | **Priority** | Read-only input | | Worked out live from urgency × impact (priority matrix); never submitted |
| 9 | | **Reported date** (`startDate`) | Date-time picker | | Hint: leave blank for "now" |
| 10 | | **Service** | Select | | Disabled with "No services configured" when there are none |
| 11 | | **Category** (`serviceSubcategoryId`) | Select (depends on Service) | | Cleared when the service changes; "Select a service first" |
| 12 | Side card "Details" | **Assignment group (optional)** (`teamId`) | Select | | "Auto-assign by rules" |
| 13 | | **Assignee (optional)** (`agentId`) | Select | | "Not assigned" |
| 14 | | Field error / hint text (FormField `Field`) | Feedback | | One slot per field: the error replaces the hint |

## A9. Modules page — `/modules` (ModulesIndexPage)

| # | Component | Type | Details |
|---|---|---|---|
| 1 | PageHeader | Layout | "Modules", "{N} screens across {M} module groups." |
| 2 | **Filter modules** Input | Form control | Filters entries by label or class |
| 3 | One **Card per iTop group** | Data display + Navigation | Group label, `admin` chip, entry count; each entry is a link with a Plus/Search icon, label and class name (monospace) |
| 4 | **"Not yet available"** Card | Data display | The 17 excluded menu nodes, grouped: *Administration tools* (Audit, BackupStatus, CSVImport, ConfigEditor, DBToolsMenu, DataFeatureRemovalMenu, DataModelMenu, ExportMenu, NotificationsMenu, RunQueriesMenu, TagAdminMenu, UniversalSearchMenu, iTopUpdate) · *Waiting on sign-in* (MyShortcuts) · *System internals* (QueryMenu, DataSources) · *Nothing to show* (SystemTools) |
| 5 | Skeleton (4 cards) / EmptyState | Feedback | |

## A10. Generic record pages (`features/records`) — used by every iTop list, search and new entry

### A10.1 Records index — `/records` (RecordsIndexPage)
- PageHeader "Records" · **Filter classes** Input · 4 group **Cards**: *Tickets & workflow*, *Configuration items*, *People & organisations*, *Everything else*. Each holds a count and the class names as chip links. Abstract classes are hidden. Skeleton and EmptyState for loading and no match.

### A10.2 Record list — `/records/:className[?view=…]` (RecordListPage)

| # | Component | Type | Details |
|---|---|---|---|
| 1 | PageHeader | Layout | Home › Records › {Class}. Title = class name. Description "N records · filtered: {view label} · sorted by the BFF" |
| 2 | **Clear filter** (when `?view=`) | Action (link button) | Goes back to the unfiltered list |
| 3 | **+ New** (primary, non-abstract classes only) | Action | → `/records/:class/new` |
| 4 | **All classes** (ArrowLeft) | Action | → `/records` |
| 5 | **Search** Input | Form control | "Search {Class}…" (`?q=`) |
| 6 | **DataTable** | Data display (table) | **ID** (#id link) + up to **6 columns** from iTop's list declaration (listed per class in Part C). Enum values show iTop's labels. Clicking a row opens the detail page |
| 7 | Pagination | Navigation | "Page x of y · N total" + **Previous** / **Next** (only when there is more than one page) |
| 8 | EmptyState / "Unknown class" / Skeleton | Feedback | |

### A10.3 Record detail — `/records/:className/:id` (RecordDetailPage)

| # | Component | Type | Details |
|---|---|---|---|
| 1 | PageHeader | Layout | Home › Records › {Class label} › #id. Title = the record's label. Description "{Class} · id N" |
| 2 | **Lifecycle buttons** | Action (secondary Buttons) | One per stimulus allowed in the current state (listed per class in Part C), e.g. "Assign", "Mark as resolved". Hidden while editing |
| 3 | **Edit / Cancel** toggle (Pencil / X) | Action | Shown when the class has editable fields |
| 4 | **Save changes** (primary) | Action | In edit mode; sends only the fields that changed |
| 5 | **All {Class}** (ArrowLeft) | Action | Back to the list |
| 6 | Error alert | Feedback | Save or stimulus failure |
| 7 | **Tab bar** (`role=tablist`) | Navigation (tabs) | **Details** · **Attachments** (Ticket classes only) · one tab per related set / case log in iTop's order (per class in Part C) |
| 8 | Details tab → **RecordForm** | Layout + Data display / Form | One **Card per iTop fieldset** (e.g. "General Information", "Qualification", "Dates"), in a 2-column grid, each with label/value rows. Read mode uses **FieldValue**; edit mode uses **FieldInput** (control per field in Part C). Required fields are marked with a red `*` |
| 9 | Attachments tab → **AttachmentsPanel** | Data display + Form | See A10.5 |
| 10 | Related tab → **RelatedTab** | Data display (link list) | Linked objects as links + class name in monospace; "Showing x of N"; EmptyState "Nothing linked yet" |
| 11 | Log tab → **FieldValue (CaseLog)** | Data display | Entries with a left border: "user · date" + message |
| 12 | "Record not found" / Skeleton | Feedback | |

### A10.4 New record — `/records/:className/new` (RecordNewPage)

| # | Component | Type | Details |
|---|---|---|---|
| 1 | PageHeader | Layout | "New {Class}", "{r} required of {n} fields", **All {Class}** button |
| 2 | **"Fields" CardHeader** with the **Create** button | Action | Subtitle "N required field(s) still empty" or "Ready to save". Create stays disabled until every required field is filled |
| 3 | **RecordForm** (editing) | Form | Every writable field except the lifecycle/status field, in iTop's fieldsets (the "On New form" column in Part C) |
| 4 | **"Created …, with exceptions"** Card | Feedback | Shown when iTop accepted the record but refused some fields (e.g. priority), with an **Open the record** button |
| 5 | Abstract class (e.g. "New CI" → FunctionalCI) | Feedback (EmptyState) | "{Class} is an abstract class" + **Browse classes** |

### A10.5 AttachmentsPanel (`features/attachments`) — Attachments tab on every Ticket class

| Element | Type | Details |
|---|---|---|
| Header "Attachments" + count | Data display | Paperclip icon |
| Hidden file input + **Upload** Button | Form control + Action | 32 MB limit, empty files rejected; shows "Uploading…" |
| Validation, error and success messages | Feedback | "… is empty." / "… The limit is 32 MB." / "Uploaded {file}." |
| **AttachmentRow** per file | Data display | FileText icon, filename, "size · type · date · by {user}" |
| **Download** Button | Action | Downloads the file |
| **Delete** (Trash icon) → inline confirm "Delete this file?" **Delete** (danger) / **Cancel** | Action | Two-step delete |
| Skeleton / EmptyState "No attachments yet" | Feedback | |

## A11. iTop dashboard pages — `/dashboards/:id` (DashboardViewPage + Dashlet)

PageHeader (Home › Dashboards › {title}) plus a grid of up to 2 columns of **Dashlet** cards. Each panel's kind decides its component:

| Dashlet kind | Rendered as | Type |
|---|---|---|
| `header` / `text` | Card with a LayoutDashboard icon, title and text | Data display |
| `badge` | Big number + caption, the whole card links to `/records/{class}` | Data display (KPI tile) |
| `list` | Up to N record links + "View all N →" | Data display + Navigation |
| `pie` | **DonutChart** (max 8 slices, total in the centre) | Chart |
| `bars` | Recharts **BarChart** with **ChartTooltip**, palette colours | Chart |
| `table` / `header-dynamic` | Grouped-count table + "View {class}" link | Data display |
| loading / error | Skeleton / "Couldn't load this panel." | Feedback |

The panels of each dashboard are listed in Part B.

## A12. Not-found page (`*`)
A Card with a Compass icon, "Page not found", an explanation line and a **Go to dashboard** button.

## A13. Shared component library (`src/components`)

| Component | Folder | Type | Variants / props |
|---|---|---|---|
| Button | ui | Action | variant: primary, secondary, ghost, subtle, danger, link · size: sm, md, lg · loading, leadingIcon, trailingIcon, fullWidth · `buttonClasses()` styles links as buttons |
| IconButton | ui | Action | size sm/md · tone default/brand · `label` (accessible name) |
| Input | ui | Form control | leadingIcon, trailing slot, invalid |
| Select | ui | Form control | options [{value,label}] (native select) |
| Tabs | ui | Navigation | items [{id,label,count}] |
| Card, CardHeader (title/subtitle/action), CardBody, CardFooter | ui | Layout | |
| Avatar | ui | Data display | size xs/sm/md/lg, initials fallback, src |
| Badge | ui | Data display | tone: neutral, info, good, warning, serious, critical, brand · dot · icon · size sm/md |
| Skeleton, SkeletonCard | ui | Feedback | |
| DataTable | data-display | Data display (table) | TanStack table: sortable headers, row click, loading rows, empty title/description, density compact/comfortable, horizontal scroll |
| StatusPill | data-display | Data display | new (brand), open / in_progress (info), pending (warning), resolved (good), closed (neutral) |
| PriorityBadge | data-display | Data display | critical (red), high (serious/orange), medium (warning), low (good) |
| OperationalStatusPill | data-display | Data display | operational (good), degraded (warning), outage (critical) |
| KpiCard | data-display | Data display + Chart | tone brand/critical/warning/good, delta {value, direction up/down/flat, intent}, trend sparkline |
| Sparkline | data-display | Chart | variant line/bars, custom SVG |
| TrendChart | data-display | Chart | Recharts area/line, multiple series, `filled` |
| DonutChart | data-display | Chart | centre value/label, size, active slice highlight |
| ChartLegend, ChartTooltip | data-display | Chart helpers | horizontal/vertical legend, hover link |
| EmptyState | feedback | Feedback | icon, title, description, action |
| ErrorBoundary | feedback | Feedback | page-crash catcher with retry |
| Spinner, RouteFallback | feedback | Feedback | |
| Sidebar, ItopNavigation, Topbar, PageHeader, Breadcrumbs, Logo | layout | Layout / Navigation | see A2–A6 |
| CommandPalette | overlays | Overlay | see A5 |

Feature-local components: `FormField` (Field, Select, SectionLabel, CONTROL) and `IncidentActions`, `IncidentCaseLog`, `IncidentEditDialog`, `IncidentFilterBar`, `IncidentPagination` in incidents; `FieldControls` (FieldValue, FieldInput), `RecordForm`, `RelatedTab` in records; `Dashlet` in itop-dashboards; `AttachmentsPanel` in attachments; nine dashboard cards plus `ViewAllLink` and `ticketColumns` in dashboard.

**Scaffolded but empty feature folders** (no pages yet): auth, changes, cmdb, contacts, knowledge-base, notifications, problems, reports, search, service-catalog, settings, sla, tickets, user-requests.

## A13a. Organisation admin — `/organisation` (`features/tenant-admin`, administrators)

A customer's own administration with tenancy on; with it off the page says there is no customer to manage. A customer administrator sees only their tenant; the platform operator gets a customer picker.

| Tab | What it does |
|---|---|
| Organisations | Table (name, code, parent, status select) and an "Add organisation" form (name, code, parent). A new one joins the tenant at once |
| Teams | "Add team" form (name, email, organisation); a card per team with member chips (× removes) and a person search that adds a member |
| Users | Explains the grant limit and links to **Users**, where Administrator is shown locked for a customer administrator |
| Branding | Product name, brand colour (colour well + hex field), logo upload (PNG/JPEG/WebP/SVG ≤ 200 KB, remove), a live preview in the dark and light looks with the contrast fixes applied, Save, "Back to the default look" |
| Domains | Email domains (domain → organisation, remove, add; public mail providers refused). Site host names: listed; editable by the platform operator only |

Branding applies app-wide from `GET /branding` (`features/branding`): the accent colour re-points the brand tokens (`lib/branding/palette.ts`), the name and logo replace the Intertec lockup, the tab title and the favicon.

## A13b. Create an account — `/register` (`features/auth`)

First name, last name, work email → "Check your email". Offered on sign-in when `/auth/options` says `selfRegistration`.

## A14. Things this inventory turned up

1. **Sidebar Incident entries skip the hand-built Incident pages.** Everything under *Incident Management* opens the generic `/records/Incident…` screens. `/incidents` is reachable only from Dashboard links.
2. **Dead links on the incident detail page.** Parent Request / Parent Problem / Parent Change / Related Requests link to `/requests/:id`, `/problems/:id` and `/changes/:id`. None of these routes exist, so they land on *Page not found*.
3. **Rows repeated in the incident Details card.** "Operational Status", "Last Pending Date", "Escalation Flag", "Escalation Reason" and "Pending Reason" each appear twice.
4. **Placeholder controls.** Notifications (its dot is always on), Help, Preferences, Sign out and every row "⋮" button do nothing yet. The user is hard-coded as `admin`.
5. **Generic edit mode includes fields iTop controls.** `status`, the derived `priority` and the StopWatch/SubItem SLA fields show as editable controls on the generic Edit form. (The New form drops only the status field.)
6. **"View all" links hidden by design.** `/changes`, `/sla`, `/knowledge` and `/service-catalog` links, plus the service-shortcut "Create" buttons, stay hidden until those modules are registered.

---

# PART B — Every sidebar entry and the page it opens

## Sidebar group: Welcome

iTop group id `WelcomeMenu` · rendered by `GroupSection` in `ItopNavigation.tsx` (collapsible button + list of `NavLink`s).

### Welcome page  (Welcome → Welcome)

- **Sidebar item:** `Welcome` · kind `dashboard` · menu id `WelcomeMenuPage`
- **Route:** `/dashboards/WelcomeMenuPage` → **DashboardViewPage**
- **Dashboard title:** Welcome · iTop columns: 1 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Header card (icon + title) — "Configuration items"
  2. Count tile (big number, links to list) — "Contact count (tile caption = class name)" · class `Contact`
  3. Count tile (big number, links to list) — "Location count (tile caption = class name)" · class `Location`
  4. Count tile (big number, links to list) — "BusinessProcess count (tile caption = class name)" · class `BusinessProcess`
  5. Count tile (big number, links to list) — "ApplicationSolution count (tile caption = class name)" · class `ApplicationSolution`
  6. Count tile (big number, links to list) — "Server count (tile caption = class name)" · class `Server`
  7. Count tile (big number, links to list) — "NetworkDevice count (tile caption = class name)" · class `NetworkDevice`
  8. Count tile (big number, links to list) — "Contract count (tile caption = class name)" · class `Contract`
  9. Grouped-count table + 'View <class>' link — "Helpdesk" · class `UserRequest` · grouped by `status`
  10. Record list card (links to records, 'View all N →') — "My requests" · class `UserRequest`

## Sidebar group: Configuration management

iTop group id `ConfigManagement` · rendered by `GroupSection` in `ItopNavigation.tsx` (collapsible button + list of `NavLink`s).

### Overview page  (Configuration management → Overview)

- **Sidebar item:** `Overview` · kind `dashboard` · menu id `ConfigManagementOverview`
- **Route:** `/dashboards/ConfigManagementOverview` → **DashboardViewPage**
- **Dashboard title:** Overview · iTop columns: 1 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Header card (icon + title) — "Infrastructure"
  2. Count tile (big number, links to list) — "Server count (tile caption = class name)" · class `Server`
  3. Count tile (big number, links to list) — "NetworkDevice count (tile caption = class name)" · class `NetworkDevice`
  4. Count tile (big number, links to list) — "Rack count (tile caption = class name)" · class `Rack`
  5. Count tile (big number, links to list) — "Enclosure count (tile caption = class name)" · class `Enclosure`
  6. Count tile (big number, links to list) — "PowerConnection count (tile caption = class name)" · class `PowerConnection`
  7. Count tile (big number, links to list) — "StorageSystem count (tile caption = class name)" · class `StorageSystem`
  8. Count tile (big number, links to list) — "SANSwitch count (tile caption = class name)" · class `SANSwitch`
  9. Count tile (big number, links to list) — "NAS count (tile caption = class name)" · class `NAS`
  10. Count tile (big number, links to list) — "TapeLibrary count (tile caption = class name)" · class `TapeLibrary`
  11. Header card (icon + title) — "Software and applications"
  12. Count tile (big number, links to list) — "Software count (tile caption = class name)" · class `Software`
  13. Count tile (big number, links to list) — "OSFamily count (tile caption = class name)" · class `OSFamily`
  14. Count tile (big number, links to list) — "OSVersion count (tile caption = class name)" · class `OSVersion`
  15. Count tile (big number, links to list) — "IOSVersion count (tile caption = class name)" · class `IOSVersion`
  16. Count tile (big number, links to list) — "Middleware count (tile caption = class name)" · class `Middleware`
  17. Count tile (big number, links to list) — "DBServer count (tile caption = class name)" · class `DBServer`
  18. Count tile (big number, links to list) — "WebServer count (tile caption = class name)" · class `WebServer`
  19. Count tile (big number, links to list) — "PCSoftware count (tile caption = class name)" · class `PCSoftware`
  20. Count tile (big number, links to list) — "OtherSoftware count (tile caption = class name)" · class `OtherSoftware`
  21. Count tile (big number, links to list) — "MiddlewareInstance count (tile caption = class name)" · class `MiddlewareInstance`
  22. Count tile (big number, links to list) — "DatabaseSchema count (tile caption = class name)" · class `DatabaseSchema`
  23. Count tile (big number, links to list) — "WebApplication count (tile caption = class name)" · class `WebApplication`
  24. Count tile (big number, links to list) — "Patch count (tile caption = class name)" · class `Patch`
  25. Count tile (big number, links to list) — "Licence count (tile caption = class name)" · class `Licence`
  26. Count tile (big number, links to list) — "DataFlow count (tile caption = class name)" · class `DataFlow`
  27. Header card (icon + title) — "Miscellaneous"
  28. Count tile (big number, links to list) — "NetworkInterface count (tile caption = class name)" · class `NetworkInterface`
  29. Count tile (big number, links to list) — "Subnet count (tile caption = class name)" · class `Subnet`
  30. Count tile (big number, links to list) — "VLAN count (tile caption = class name)" · class `VLAN`
  31. Count tile (big number, links to list) — "BusinessProcess count (tile caption = class name)" · class `BusinessProcess`
  32. Count tile (big number, links to list) — "ApplicationSolution count (tile caption = class name)" · class `ApplicationSolution`
  33. Count tile (big number, links to list) — "Group count (tile caption = class name)" · class `Group`
  34. Count tile (big number, links to list) — "LogicalVolume count (tile caption = class name)" · class `LogicalVolume`
  35. Count tile (big number, links to list) — "FiberChannelInterface count (tile caption = class name)" · class `FiberChannelInterface`
  36. Count tile (big number, links to list) — "NASFileSystem count (tile caption = class name)" · class `NASFileSystem`
  37. Count tile (big number, links to list) — "Tape count (tile caption = class name)" · class `Tape`
  38. Header card (icon + title) — "End user devices"
  39. Count tile (big number, links to list) — "PC count (tile caption = class name)" · class `PC`
  40. Count tile (big number, links to list) — "Phone count (tile caption = class name)" · class `Phone`
  41. Count tile (big number, links to list) — "IPPhone count (tile caption = class name)" · class `IPPhone`
  42. Count tile (big number, links to list) — "MobilePhone count (tile caption = class name)" · class `MobilePhone`
  43. Count tile (big number, links to list) — "Tablet count (tile caption = class name)" · class `Tablet`
  44. Count tile (big number, links to list) — "Printer count (tile caption = class name)" · class `Printer`
  45. Count tile (big number, links to list) — "Peripheral count (tile caption = class name)" · class `Peripheral`
  46. Header card (icon + title) — "Virtualization"
  47. Count tile (big number, links to list) — "Farm count (tile caption = class name)" · class `Farm`
  48. Count tile (big number, links to list) — "Hypervisor count (tile caption = class name)" · class `Hypervisor`
  49. Count tile (big number, links to list) — "VirtualMachine count (tile caption = class name)" · class `VirtualMachine`
  50. Count tile (big number, links to list) — "Cloud count (tile caption = class name)" · class `Cloud`
  51. Count tile (big number, links to list) — "ContainerApplication count (tile caption = class name)" · class `ContainerApplication`
  52. Count tile (big number, links to list) — "ContainerHost count (tile caption = class name)" · class `ContainerHost`
  53. Count tile (big number, links to list) — "ContainerCluster count (tile caption = class name)" · class `ContainerCluster`
  54. Count tile (big number, links to list) — "ContainerImage count (tile caption = class name)" · class `ContainerImage`

### Contacts page  (Configuration management → Contacts)

- **Sidebar item:** `Contacts` · kind `dashboard` · menu id `Contact`
- **Route:** `/dashboards/Contact` → **DashboardViewPage**
- **Dashboard title:** Contact · iTop columns: 1 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Grouped-count table + 'View <class>' link — "Contacts" · class `Contact` · grouped by `status`
  2. Count tile (big number, links to list) — "Team count (tile caption = class name)" · class `Team`
  3. Count tile (big number, links to list) — "Person count (tile caption = class name)" · class `Person`

### New contact page  (Configuration management → New contact)

- **Sidebar item:** `New contact` · kind `create` · sidebar hint `NEW` · menu id `NewContact`
- **Route:** `/records/Contact/new` → **RecordNewPage**
- **Fields, columns, tabs, actions:** see [Class layout: Contact](#class-layout-contact)

### Locations page  (Configuration management → Locations)

- **Sidebar item:** `Locations` · kind `list` · menu id `Location`
- **Route:** `/records/Location?view=Location` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT Location`
- **Fields, columns, tabs, actions:** see [Class layout: Location](#class-layout-location)

### Search for contacts page  (Configuration management → Search for contacts)

- **Sidebar item:** `Search for contacts` · kind `search` · sidebar hint `SEARCH` · menu id `SearchContacts`
- **Route:** `/records/Contact` → **RecordListPage**
- **Fields, columns, tabs, actions:** see [Class layout: Contact](#class-layout-contact)

### New CI page  (Configuration management → New CI)

- **Sidebar item:** `New CI` · kind `create` · sidebar hint `NEW` · menu id `NewCI`
- **Route:** `/records/FunctionalCI/new` → **RecordNewPage**
- **Fields, columns, tabs, actions:** see [Class layout: FunctionalCI](#class-layout-functionalci)

### Search for CIs page  (Configuration management → Search for CIs)

- **Sidebar item:** `Search for CIs` · kind `search` · sidebar hint `SEARCH` · menu id `SearchCIs`
- **Route:** `/records/FunctionalCI` → **RecordListPage**
- **Fields, columns, tabs, actions:** see [Class layout: FunctionalCI](#class-layout-functionalci)

### Documents page  (Configuration management → Documents)

- **Sidebar item:** `Documents` · kind `list` · menu id `Document`
- **Route:** `/records/Document?view=Document` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT Document`
- **Fields, columns, tabs, actions:** see [Class layout: Document](#class-layout-document)

### Software catalog page  (Configuration management → Software catalog)

- **Sidebar item:** `Software catalog` · kind `list` · menu id `Software`
- **Route:** `/records/Software?view=Software` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT Software`
- **Fields, columns, tabs, actions:** see [Class layout: Software](#class-layout-software)

### Groups of CIs page  (Configuration management → Groups of CIs)

- **Sidebar item:** `Groups of CIs` · kind `list` · menu id `Group`
- **Route:** `/records/Group?view=Group` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT Group`
- **Fields, columns, tabs, actions:** see [Class layout: Group](#class-layout-group)

## Sidebar group: Helpdesk

iTop group id `RequestManagement` · rendered by `GroupSection` in `ItopNavigation.tsx` (collapsible button + list of `NavLink`s).

### Overview page  (Helpdesk → Overview)

- **Sidebar item:** `Overview` · kind `dashboard` · menu id `UserRequest:Overview`
- **Route:** `/dashboards/UserRequest:Overview` → **DashboardViewPage**
- **Dashboard title:** Dashboard for Request Management · iTop columns: 2 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Donut chart (DonutChart, max 8 slices, total in centre) — "Last 14 days request per type" · class `UserRequest` · grouped by `request_type`
  2. Bar chart (Recharts BarChart + ChartTooltip) — "Last 14 days number of requests" · class `UserRequest` · grouped by `start_date` (day_of_month)
  3. Grouped-count table + 'View <class>' link — "Open requests by status" · class `UserRequest` · grouped by `status`
  4. Grouped-count table + 'View <class>' link — "Open requests by agent" · class `UserRequest` · grouped by `agent_id`
  5. Grouped-count table + 'View <class>' link — "Open requests by type" · class `UserRequest` · grouped by `finalclass`
  6. Grouped-count table + 'View <class>' link — "Open requests by customer" · class `UserRequest` · grouped by `org_id`

### Assigned to me page  (Helpdesk → Assigned to me)

- **Sidebar item:** `Assigned to me` · kind `list` · menu id `UserRequest:MyRequests`
- **Route:** `/records/UserRequest?view=UserRequest:MyRequests` → **RecordListPage (filtered view)**
- **Note:** filter is "for the current user" (resolved server-side from the logged-in contact).
- **Server-side filter (OQL, never sent to browser):** `SELECT UserRequest WHERE agent_id = :current_contact_id AND status NOT IN ("closed","resolved")`
- **Fields, columns, tabs, actions:** see [Class layout: UserRequest](#class-layout-userrequest)

### New request page  (Helpdesk → New request)

- **Sidebar item:** `New request` · kind `create` · sidebar hint `NEW` · menu id `NewUserRequest`
- **Route:** `/records/UserRequest/new` → **RecordNewPage**
- **Fields, columns, tabs, actions:** see [Class layout: UserRequest](#class-layout-userrequest)

### Under escalation page  (Helpdesk → Under escalation)

- **Sidebar item:** `Under escalation` · kind `list` · menu id `UserRequest:EscalatedRequests`
- **Route:** `/records/UserRequest?view=UserRequest:EscalatedRequests` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT UserRequest WHERE status IN ("escalated_tto", "escalated_ttr") OR escalation_flag="yes"`
- **Fields, columns, tabs, actions:** see [Class layout: UserRequest](#class-layout-userrequest)

### Search for requests page  (Helpdesk → Search for requests)

- **Sidebar item:** `Search for requests` · kind `search` · sidebar hint `SEARCH` · menu id `SearchUserRequests`
- **Route:** `/records/UserRequest` → **RecordListPage**
- **Fields, columns, tabs, actions:** see [Class layout: UserRequest](#class-layout-userrequest)

### Open page  (Helpdesk → Open)

- **Sidebar item:** `Open` · kind `list` · menu id `UserRequest:OpenRequests`
- **Route:** `/records/UserRequest?view=UserRequest:OpenRequests` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT UserRequest WHERE status NOT IN ("closed")`
- **Fields, columns, tabs, actions:** see [Class layout: UserRequest](#class-layout-userrequest)

### Initiated by me page  (Helpdesk → Initiated by me)

- **Sidebar item:** `Initiated by me` · kind `list` · menu id `UserRequest:MySupportRequests`
- **Route:** `/records/UserRequest?view=UserRequest:MySupportRequests` → **RecordListPage (filtered view)**
- **Note:** filter is "for the current user" (resolved server-side from the logged-in contact).
- **Server-side filter (OQL, never sent to browser):** `SELECT UserRequest WHERE caller_id = :current_contact_id AND status NOT IN ("closed")`
- **Fields, columns, tabs, actions:** see [Class layout: UserRequest](#class-layout-userrequest)

## Sidebar group: Incident Management

iTop group id `IncidentManagement` · rendered by `GroupSection` in `ItopNavigation.tsx` (collapsible button + list of `NavLink`s).

### Overview page  (Incident Management → Overview)

- **Sidebar item:** `Overview` · kind `dashboard` · menu id `Incident:Overview`
- **Route:** `/dashboards/Incident:Overview` → **DashboardViewPage**
- **Dashboard title:** Dashboard for Incident Management · iTop columns: 2 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Donut chart (DonutChart, max 8 slices, total in centre) — "Last 14 days incident per priority" · class `Incident` · grouped by `priority`
  2. Bar chart (Recharts BarChart + ChartTooltip) — "Last 14 days number of incidents" · class `Incident` · grouped by `start_date` (day_of_month)
  3. Grouped-count table + 'View <class>' link — "Open incidents by status" · class `Incident` · grouped by `status`
  4. Grouped-count table + 'View <class>' link — "Open incidents by agent" · class `Incident` · grouped by `agent_id`
  5. Grouped-count table + 'View <class>' link — "Open incidents by customer" · class `Incident` · grouped by `org_id`

### Assigned to me page  (Incident Management → Assigned to me)

- **Sidebar item:** `Assigned to me` · kind `list` · menu id `Incident:MyIncidents`
- **Route:** `/records/Incident?view=Incident:MyIncidents` → **RecordListPage (filtered view)**
- **Note:** filter is "for the current user" (resolved server-side from the logged-in contact).
- **Server-side filter (OQL, never sent to browser):** `SELECT Incident WHERE agent_id = :current_contact_id AND status NOT IN ("closed","resolved")`
- **Fields, columns, tabs, actions:** see [Class layout: Incident](#class-layout-incident)

### New incident page  (Incident Management → New incident)

- **Sidebar item:** `New incident` · kind `create` · sidebar hint `NEW` · menu id `NewIncident`
- **Route:** `/records/Incident/new` → **RecordNewPage**
- **Fields, columns, tabs, actions:** see [Class layout: Incident](#class-layout-incident)

### Under escalation page  (Incident Management → Under escalation)

- **Sidebar item:** `Under escalation` · kind `list` · menu id `Incident:EscalatedIncidents`
- **Route:** `/records/Incident?view=Incident:EscalatedIncidents` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT Incident WHERE status IN ("escalated_tto", "escalated_ttr") OR escalation_flag="yes"`
- **Fields, columns, tabs, actions:** see [Class layout: Incident](#class-layout-incident)

### Search for incidents page  (Incident Management → Search for incidents)

- **Sidebar item:** `Search for incidents` · kind `search` · sidebar hint `SEARCH` · menu id `SearchIncidents`
- **Route:** `/records/Incident` → **RecordListPage**
- **Fields, columns, tabs, actions:** see [Class layout: Incident](#class-layout-incident)

### Open page  (Incident Management → Open)

- **Sidebar item:** `Open` · kind `list` · menu id `Incident:OpenIncidents`
- **Route:** `/records/Incident?view=Incident:OpenIncidents` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT Incident WHERE status NOT IN ("closed")`
- **Fields, columns, tabs, actions:** see [Class layout: Incident](#class-layout-incident)

### Reported by me page  (Incident Management → Reported by me)

- **Sidebar item:** `Reported by me` · kind `list` · menu id `Incident:MySupportIncidents`
- **Route:** `/records/Incident?view=Incident:MySupportIncidents` → **RecordListPage (filtered view)**
- **Note:** filter is "for the current user" (resolved server-side from the logged-in contact).
- **Server-side filter (OQL, never sent to browser):** `SELECT Incident WHERE caller_id = :current_contact_id AND status NOT IN ("closed")`
- **Fields, columns, tabs, actions:** see [Class layout: Incident](#class-layout-incident)

## Sidebar group: Problem management

iTop group id `ProblemManagement` · rendered by `GroupSection` in `ItopNavigation.tsx` (collapsible button + list of `NavLink`s).

### Overview page  (Problem management → Overview)

- **Sidebar item:** `Overview` · kind `dashboard` · menu id `Problem:Overview`
- **Route:** `/dashboards/Problem:Overview` → **DashboardViewPage**
- **Dashboard title:** Dashboard for Problem Management · iTop columns: 2 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Bar chart (Recharts BarChart + ChartTooltip) — "Problems by service" · class `Problem` · grouped by `service_id`
  2. Donut chart (DonutChart, max 8 slices, total in centre) — "Problems by priority" · class `Problem` · grouped by `priority`
  3. Record list card (links to records, 'View all N →') — "Unassigned problems" · class `Problem`

### New problem page  (Problem management → New problem)

- **Sidebar item:** `New problem` · kind `create` · sidebar hint `NEW` · menu id `NewProblem`
- **Route:** `/records/Problem/new` → **RecordNewPage**
- **Fields, columns, tabs, actions:** see [Class layout: Problem](#class-layout-problem)

### My problems page  (Problem management → My problems)

- **Sidebar item:** `My problems` · kind `list` · menu id `Problem:MyProblems`
- **Route:** `/records/Problem?view=Problem:MyProblems` → **RecordListPage (filtered view)**
- **Note:** filter is "for the current user" (resolved server-side from the logged-in contact).
- **Server-side filter (OQL, never sent to browser):** `SELECT Problem WHERE agent_id = :current_contact_id AND status NOT IN ("closed", "resolved")`
- **Fields, columns, tabs, actions:** see [Class layout: Problem](#class-layout-problem)

### Search for problems page  (Problem management → Search for problems)

- **Sidebar item:** `Search for problems` · kind `search` · sidebar hint `SEARCH` · menu id `SearchProblems`
- **Route:** `/records/Problem` → **RecordListPage**
- **Fields, columns, tabs, actions:** see [Class layout: Problem](#class-layout-problem)

### All open problems page  (Problem management → All open problems)

- **Sidebar item:** `All open problems` · kind `list` · menu id `Problem:OpenProblems`
- **Route:** `/records/Problem?view=Problem:OpenProblems` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT Problem WHERE status IN ("new", "assigned", "resolved")`
- **Fields, columns, tabs, actions:** see [Class layout: Problem](#class-layout-problem)

### New known error page  (Problem management → New known error)

- **Sidebar item:** `New known error` · kind `create` · sidebar hint `NEW` · menu id `NewError`
- **Route:** `/records/KnownError/new` → **RecordNewPage**
- **Fields, columns, tabs, actions:** see [Class layout: KnownError](#class-layout-knownerror)

### All known errors page  (Problem management → All known errors)

- **Sidebar item:** `All known errors` · kind `list` · menu id `Problem:KnownErrors`
- **Route:** `/records/KnownError?view=Problem:KnownErrors` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT KnownError`
- **Fields, columns, tabs, actions:** see [Class layout: KnownError](#class-layout-knownerror)

### Search for known errors page  (Problem management → Search for known errors)

- **Sidebar item:** `Search for known errors` · kind `search` · sidebar hint `SEARCH` · menu id `SearchError`
- **Route:** `/records/KnownError` → **RecordListPage**
- **Fields, columns, tabs, actions:** see [Class layout: KnownError](#class-layout-knownerror)

### FAQ categories page  (Problem management → FAQ categories)

- **Sidebar item:** `FAQ categories` · kind `list` · menu id `FAQCategory`
- **Route:** `/records/FAQCategory?view=FAQCategory` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT FAQCategory`
- **Fields, columns, tabs, actions:** see [Class layout: FAQCategory](#class-layout-faqcategory)

### FAQs page  (Problem management → FAQs)

- **Sidebar item:** `FAQs` · kind `list` · menu id `FAQ`
- **Route:** `/records/FAQ?view=FAQ` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT FAQ`
- **Fields, columns, tabs, actions:** see [Class layout: FAQ](#class-layout-faq)

## Sidebar group: Change management

iTop group id `ChangeManagement` · rendered by `GroupSection` in `ItopNavigation.tsx` (collapsible button + list of `NavLink`s).

### Overview page  (Change management → Overview)

- **Sidebar item:** `Overview` · kind `dashboard` · menu id `Change:Overview`
- **Route:** `/dashboards/Change:Overview` → **DashboardViewPage**
- **Dashboard title:** Dashboard for Change Management · iTop columns: 2 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Grouped-count table + 'View <class>' link — "Changes by category for the last 7 days" · class `Change` · grouped by `finalclass`
  2. Bar chart (Recharts BarChart + ChartTooltip) — "Number of changes for the last 7 days" · class `Change` · grouped by `start_date` (day_of_month)
  3. Grouped-count table + 'View <class>' link — "Changes by domain for the last 7 days" · class `Change` · grouped by `finalclass`
  4. Grouped-count table + 'View <class>' link — "Changes by status for the last 7 days" · class `Change` · grouped by `status`

### New change page  (Change management → New change)

- **Sidebar item:** `New change` · kind `create` · sidebar hint `NEW` · menu id `NewChange`
- **Route:** `/records/Change/new` → **RecordNewPage**
- **Fields, columns, tabs, actions:** see [Class layout: Change](#class-layout-change)

### Changes assigned to me page  (Change management → Changes assigned to me)

- **Sidebar item:** `Changes assigned to me` · kind `list` · menu id `MyChanges`
- **Route:** `/records/Change?view=MyChanges` → **RecordListPage (filtered view)**
- **Note:** filter is "for the current user" (resolved server-side from the logged-in contact).
- **Server-side filter (OQL, never sent to browser):** `SELECT Change WHERE agent_id = :current_contact_id AND status NOT IN ("closed", "resolved")`
- **Fields, columns, tabs, actions:** see [Class layout: Change](#class-layout-change)

### Search for changes page  (Change management → Search for changes)

- **Sidebar item:** `Search for changes` · kind `search` · sidebar hint `SEARCH` · menu id `SearchChanges`
- **Route:** `/records/Change` → **RecordListPage**
- **Fields, columns, tabs, actions:** see [Class layout: Change](#class-layout-change)

### Open changes page  (Change management → Open changes)

- **Sidebar item:** `Open changes` · kind `list` · menu id `Changes`
- **Route:** `/records/Change?view=Changes` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT Change WHERE status != "closed"`
- **Fields, columns, tabs, actions:** see [Class layout: Change](#class-layout-change)

### Changes awaiting approval page  (Change management → Changes awaiting approval)

- **Sidebar item:** `Changes awaiting approval` · kind `list` · menu id `WaitingApproval`
- **Route:** `/records/ApprovedChange?view=WaitingApproval` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT ApprovedChange WHERE status IN ("plannedscheduled")`
- **Fields, columns, tabs, actions:** see [Class layout: ApprovedChange](#class-layout-approvedchange)

### Changes awaiting acceptance page  (Change management → Changes awaiting acceptance)

- **Sidebar item:** `Changes awaiting acceptance` · kind `list` · menu id `WaitingAcceptance`
- **Route:** `/records/NormalChange?view=WaitingAcceptance` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT NormalChange WHERE status IN ("new")`
- **Fields, columns, tabs, actions:** see [Class layout: NormalChange](#class-layout-normalchange)

## Sidebar group: Service management

iTop group id `ServiceManagement` · rendered by `GroupSection` in `ItopNavigation.tsx` (collapsible button + list of `NavLink`s).

### Overview page  (Service management → Overview)

- **Sidebar item:** `Overview` · kind `dashboard` · menu id `Service:Overview`
- **Route:** `/dashboards/Service:Overview` → **DashboardViewPage**
- **Dashboard title:** Dashboard for Service Management · iTop columns: 2 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Record list card (links to records, 'View all N →') — "Customer contracts to be renewed in 30 days" · class `CustomerContract`
  2. Record list card (links to records, 'View all N →') — "Provider contracts to be renewed in 30 days" · class `ProviderContract`

### Customer contracts page  (Service management → Customer contracts)

- **Sidebar item:** `Customer contracts` · kind `list` · menu id `CustomerContract`
- **Route:** `/records/CustomerContract?view=CustomerContract` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT CustomerContract`
- **Fields, columns, tabs, actions:** see [Class layout: CustomerContract](#class-layout-customercontract)

### Provider contracts page  (Service management → Provider contracts)

- **Sidebar item:** `Provider contracts` · kind `list` · menu id `ProviderContract`
- **Route:** `/records/ProviderContract?view=ProviderContract` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT ProviderContract`
- **Fields, columns, tabs, actions:** see [Class layout: ProviderContract](#class-layout-providercontract)

### Service families page  (Service management → Service families)

- **Sidebar item:** `Service families` · kind `list` · menu id `ServiceFamily`
- **Route:** `/records/ServiceFamily?view=ServiceFamily` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT ServiceFamily`
- **Fields, columns, tabs, actions:** see [Class layout: ServiceFamily](#class-layout-servicefamily)

### Services page  (Service management → Services)

- **Sidebar item:** `Services` · kind `list` · menu id `Service`
- **Route:** `/records/Service?view=Service` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT Service`
- **Fields, columns, tabs, actions:** see [Class layout: Service](#class-layout-service)

### Service catalog page  (Service management → Service catalog)

- **Sidebar item:** `Service catalog` · kind `dashboard` · menu id `ServiceCatalog`
- **Route:** `/dashboards/ServiceCatalog` → **DashboardViewPage**
- **Dashboard title:** Service catalog · iTop columns: 2 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Header card (icon + title) — "Service catalog"
  2. Count tile (big number, links to list) — "ServiceFamily count (tile caption = class name)" · class `ServiceFamily`
  3. Count tile (big number, links to list) — "Service count (tile caption = class name)" · class `Service`
  4. Count tile (big number, links to list) — "ServiceSubcategory count (tile caption = class name)" · class `ServiceSubcategory`
  5. Count tile (big number, links to list) — "SLA count (tile caption = class name)" · class `SLA`
  6. Count tile (big number, links to list) — "SLT count (tile caption = class name)" · class `SLT`
  7. Record list card (links to records, 'View all N →') — "Delivery Model" · class `DeliveryModel`
  8. Header card (icon + title) — "Not displayed in User Portal"
  9. Grouped-count table + 'View <class>' link — "Service" · class `Service` · grouped by `status`
  10. Grouped-count table + 'View <class>' link — "Service Subcategory" · class `ServiceSubcategory` · grouped by `status`
  11. Record list card (links to records, 'View all N →') — "Services without Service Family are not visible in User Portal" · class `Service`
  12. Grouped-count table + 'View <class>' link — "Count SLTs on each SLA" · class `lnkSLAToSLT` · grouped by `sla_id`
  13. Grouped-count table + 'View <class>' link — "Count Contracts using a Service" · class `lnkCustomerContractToService` · grouped by `service_id`
  14. Grouped-count table + 'View <class>' link — "Count Contracts using an SLA" · class `lnkCustomerContractToService` · grouped by `sla_id`
  15. Record list card (links to records, 'View all N →') — "Services not used by any Customers" · class `Service`

### Service subcategories page  (Service management → Service subcategories)

- **Sidebar item:** `Service subcategories` · kind `list` · menu id `ServiceSubcategory`
- **Route:** `/records/ServiceSubcategory?view=ServiceSubcategory` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT ServiceSubcategory`
- **Fields, columns, tabs, actions:** see [Class layout: ServiceSubcategory](#class-layout-servicesubcategory)

### SLAs page  (Service management → SLAs)

- **Sidebar item:** `SLAs` · kind `list` · menu id `SLA`
- **Route:** `/records/SLA?view=SLA` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT SLA`
- **Fields, columns, tabs, actions:** see [Class layout: SLA](#class-layout-sla)

### SLTs page  (Service management → SLTs)

- **Sidebar item:** `SLTs` · kind `list` · menu id `SLT`
- **Route:** `/records/SLT?view=SLT` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT SLT`
- **Fields, columns, tabs, actions:** see [Class layout: SLT](#class-layout-slt)

### Delivery models page  (Service management → Delivery models)

- **Sidebar item:** `Delivery models` · kind `list` · menu id `DeliveryModel`
- **Route:** `/records/DeliveryModel?view=DeliveryModel` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT DeliveryModel`
- **Fields, columns, tabs, actions:** see [Class layout: DeliveryModel](#class-layout-deliverymodel)

## Sidebar group: Data administration

iTop group id `DataAdministration` · rendered by `GroupSection` in `ItopNavigation.tsx` (collapsible button + list of `NavLink`s).

### Organizations page  (Data administration → Organizations)

- **Sidebar item:** `Organizations` · kind `list` · menu id `Organization`
- **Route:** `/records/Organization?view=Organization` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT Organization`
- **Fields, columns, tabs, actions:** see [Class layout: Organization](#class-layout-organization)

### Typology configuration page  (Data administration → Typology configuration)

- **Sidebar item:** `Typology configuration` · kind `dashboard` · menu id `Typology`
- **Route:** `/dashboards/Typology` → **DashboardViewPage**
- **Dashboard title:** Typology configuration · iTop columns: 1 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Header card (icon + title) — "Typology configuration"
  2. Count tile (big number, links to list) — "ContactType count (tile caption = class name)" · class `ContactType`
  3. Count tile (big number, links to list) — "DocumentType count (tile caption = class name)" · class `DocumentType`
  4. Count tile (big number, links to list) — "Brand count (tile caption = class name)" · class `Brand`
  5. Count tile (big number, links to list) — "Model count (tile caption = class name)" · class `Model`
  6. Count tile (big number, links to list) — "OSFamily count (tile caption = class name)" · class `OSFamily`
  7. Count tile (big number, links to list) — "OSVersion count (tile caption = class name)" · class `OSVersion`
  8. Count tile (big number, links to list) — "IOSVersion count (tile caption = class name)" · class `IOSVersion`
  9. Count tile (big number, links to list) — "NetworkDeviceType count (tile caption = class name)" · class `NetworkDeviceType`
  10. Count tile (big number, links to list) — "ContractType count (tile caption = class name)" · class `ContractType`
  11. Count tile (big number, links to list) — "ContainerType count (tile caption = class name)" · class `ContainerType`
  12. Count tile (big number, links to list) — "ContainerImageType count (tile caption = class name)" · class `ContainerImageType`
  13. Count tile (big number, links to list) — "DataFlowType count (tile caption = class name)" · class `DataFlowType`
  14. Count tile (big number, links to list) — "DataFlowProtocol count (tile caption = class name)" · class `DataFlowProtocol`

## Sidebar group: Administration  _(admin)_

iTop group id `AdminTools` · rendered by `GroupSection` in `ItopNavigation.tsx` (collapsible button + list of `NavLink`s).

### User accounts page  (Administration → User accounts)

- **Sidebar item:** `User accounts` · kind `list` · menu id `UserAccountsMenu`
- **Route:** `/records/User?view=UserAccountsMenu` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT User`
- **Fields, columns, tabs, actions:** see [Class layout: User](#class-layout-user)

### Profiles page  (Administration → Profiles)

- **Sidebar item:** `Profiles` · kind `list` · menu id `ProfilesMenu`
- **Route:** `/records/URP_Profiles?view=ProfilesMenu` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT URP_Profiles`
- **Fields, columns, tabs, actions:** see [Class layout: URP_Profiles](#class-layout-urp_profiles)

### Audit configuration page  (Administration → Audit configuration)

- **Sidebar item:** `Audit configuration` · kind `dashboard` · menu id `AuditCategories`
- **Route:** `/dashboards/AuditCategories` → **DashboardViewPage**
- **Dashboard title:** Audit configuration · iTop columns: 3 (rendered as max 2-column grid)
- **Panels (Dashlet components), in order:**
  1. Info card (icon + title + text) — "Audit domains allow to group the audit categories."
  2. Count tile (big number, links to list) — "AuditDomain count (tile caption = class name)" · class `AuditDomain`
  3. Info card (icon + title + text) — "Audit category defines a scope of objects which needs to be audited."
  4. Count tile (big number, links to list) — "AuditCategory count (tile caption = class name)" · class `AuditCategory`
  5. Info card (icon + title + text) — "An audit rule corresponds a single check within an audit category."
  6. Count tile (big number, links to list) — "AuditRule count (tile caption = class name)" · class `AuditRule`
  7. Record list card (links to records, 'View all N →') — "Audit Domain" · class `AuditDomain`
  8. Record list card (links to records, 'View all N →') — "Audit Category" · class `AuditCategory`
  9. Record list card (links to records, 'View all N →') — "Audit Rule" · class `AuditRule`

## Sidebar group: Configuration  _(admin)_

iTop group id `ConfigurationTools` · rendered by `GroupSection` in `ItopNavigation.tsx` (collapsible button + list of `NavLink`s).

### OAuth Mail Access page  (Configuration → OAuth Mail Access)

- **Sidebar item:** `OAuth Mail Access` · kind `list` · menu id `OAuthClient`
- **Route:** `/records/OAuthClient?view=OAuthClient` → **RecordListPage (filtered view)**
- **Server-side filter (OQL, never sent to browser):** `SELECT OAuthClient`
- **Fields, columns, tabs, actions:** see [Class layout: OAuthClient](#class-layout-oauthclient)

---

# PART C — Class layouts (the fields each record page renders)

Every sidebar list / search / new entry lands on the generic Records pages, which render the class's layout from the schema. Each class is listed once here; the sidebar entries that use it are named under it.

### Class layout: Contact

- **Used by sidebar entries:** Configuration management → New contact; Configuration management → Search for contacts
- **Class:** `Contact` (Contact) · abstract: yes · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Status (`status`) → Organization (`org_id`) → Email (`email`) → Phone (`phone`) → Function (`function`)
- **Detail page tabs (9):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Status — _Case log (FieldValue log list)_ | Organization — _Case log (FieldValue log list)_ | Email — _Case log (FieldValue log list)_ | Phone — _Case log (FieldValue log list)_ | Notification — _Case log (FieldValue log list)_ | Function — _Case log (FieldValue log list)_ | CIs — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Organization name | `org_name` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: Location

- **Used by sidebar entries:** Configuration management → Locations
- **Class:** `Location` (Location) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Status (`status`) → Owner organization (`org_id`) → City (`city`) → Country (`country`)
- **Detail page tabs (10):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Status — _Case log (FieldValue log list)_ | Owner organization — _Case log (FieldValue log list)_ | Address — _Case log (FieldValue log list)_ | Postal code — _Case log (FieldValue log list)_ | City — _Case log (FieldValue log list)_ | Country — _Case log (FieldValue log list)_ | Contacts — _Related-records list (RelatedTab)_ | Devices — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Name of the owner organization | `org_name` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: FunctionalCI

- **Used by sidebar entries:** Configuration management → New CI; Configuration management → Search for CIs
- **Class:** `FunctionalCI` (Functional CI) · abstract: yes · ticket: no · CI: yes
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Organization (`org_id`) → Business criticality (`business_criticity`) → Move to production date (`move2production`)
- **Detail page tabs (14):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Organization — _Case log (FieldValue log list)_ | Business criticality — _Case log (FieldValue log list)_ | Move to production date — _Case log (FieldValue log list)_ | Description — _Case log (FieldValue log list)_ | Contacts — _Related-records list (RelatedTab)_ | Documents — _Related-records list (RelatedTab)_ | Application solutions — _Related-records list (RelatedTab)_ | Provider contracts — _Related-records list (RelatedTab)_ | Services — _Related-records list (RelatedTab)_ | Groups — _Related-records list (RelatedTab)_ | Software — _Related-records list (RelatedTab)_ | Tickets — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Data flows | `dataflows` | Dashboard | Text | Text input |  | Yes | Yes |
| Details | Organization name | `organization_name` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: Document

- **Used by sidebar entries:** Configuration management → Documents
- **Class:** `Document` (Document) · abstract: yes · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Organization (`org_id`) → Status (`status`) → Document type (`documenttype_id`) → Description (`description`)
- **Detail page tabs (10):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Organization — _Case log (FieldValue log list)_ | Status — _Case log (FieldValue log list)_ | Version — _Case log (FieldValue log list)_ | Document type — _Case log (FieldValue log list)_ | Description — _Case log (FieldValue log list)_ | CIs — _Related-records list (RelatedTab)_ | Contracts — _Related-records list (RelatedTab)_ | Services — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Document type name | `documenttype_name` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Organization name | `org_name` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: Software

- **Used by sidebar entries:** Configuration management → Software catalog
- **Class:** `Software` (Software) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Vendor (`vendor`) → Type (`type`) → End of support (`end_of_support`)
- **Detail page tabs (6):** Details — _Fieldset cards (RecordForm)_ | Documents — _Related-records list (RelatedTab)_ | Software Instances — _Related-records list (RelatedTab)_ | Software Patches — _Related-records list (RelatedTab)_ | Software Licenses — _Related-records list (RelatedTab)_ | Container Images — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| General | Name | `name` | String | Text | Text input | Yes * | Yes | Yes |
| General | Version | `version` | String | Text | Text input | Yes * | Yes | Yes |
| Software specifics | Vendor | `vendor` | String | Text | Text input | Yes * | Yes | Yes |
| Software specifics | Type | `type` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Middleware, DB Server, PC Software, Other Software, Web Server |  | Yes | Yes |
| Dates | End of support | `end_of_support` | Date | Text | Date picker (input type=date) |  | Yes | Yes |
| Description | Logo | `logo` | Image | File name + type + size | Text input |  | Yes | Yes |

### Class layout: Group

- **Used by sidebar entries:** Configuration management → Groups of CIs
- **Class:** `Group` (Group) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Status (`status`) → Organization (`org_id`) → Type (`type`) → Parent Group (`parent_id`)
- **Detail page tabs (2):** Details — _Fieldset cards (RecordForm)_ | Linked CIs — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| General | Name | `name` | String | Text | Text input | Yes * | Yes | Yes |
| General | Organization | `org_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General | Status | `status` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Production, Implementation, Obsolete |  | Yes | Yes |
| CI specifics | Type | `type` | String | Text | Text input |  | Yes | Yes |
| CI specifics | Parent Group | `parent_id` | HierarchicalKey | Text | Text input |  | Yes | Yes |
| Description | Description | `description` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |

### Class layout: UserRequest

- **Used by sidebar entries:** Helpdesk → Assigned to me; Helpdesk → New request; Helpdesk → Under escalation; Helpdesk → Search for requests; Helpdesk → Open; Helpdesk → Initiated by me
- **Class:** `UserRequest` (User Request) · abstract: no · ticket: yes · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Title (`title`) → Organization (`org_id`) → Caller (`caller_id`) → Start date (`start_date`) → Status (`status`) → Agent (`agent_id`)
- **Detail page tabs (9):** Details — _Fieldset cards (RecordForm)_ | Attachments — _AttachmentsPanel (upload / download / delete)_ | CIs — _Related-records list (RelatedTab)_ | Contacts — _Related-records list (RelatedTab)_ | Work orders — _Related-records list (RelatedTab)_ | Child Requests — _Related-records list (RelatedTab)_ | Child Incidents — _Related-records list (RelatedTab)_ | Public log — _Case log (FieldValue log list)_ | Private log — _Case log (FieldValue log list)_
- **Lifecycle action buttons** (header, driven by `status`; one secondary Button per allowed stimulus):
  - in state **Approved** (`approved`): Timeout, Assign, Automatic resolve
  - in state **Assigned** (`assigned`): Pending, Mark as resolved, Re-assign, Timeout, Automatic resolve
  - in state **Closed** (`closed`): _none_
  - in state **Escalated TTO** (`escalated_tto`): Assign, Automatic resolve
  - in state **Escalated TTR** (`escalated_ttr`): Pending, Mark as resolved, Re-assign, Automatic resolve
  - in state **New** (`new`): Assign, Timeout, Wait for approval, Automatic resolve
  - in state **Pending** (`pending`): Assign, Automatic resolve
  - in state **Rejected** (`rejected`): Re-open
  - in state **Resolved** (`resolved`): Close this request, Re-open
  - in state **Waiting for approval** (`waiting_for_approval`): Approve, Reject, Automatic resolve

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| General Information | Organization | `org_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General Information | Caller | `caller_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| General Information | Status | `status` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: New, Waiting for approval, Approved, Rejected, Assigned, Pending, Escalated TTO, Escalated TTR, Resolved, Closed |  | Yes | No |
| General Information | Origin | `origin` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: In-person, Chat, Email, Phone, Portal |  | Yes | Yes |
| General Information | Title | `title` | String | Text | Text input | Yes * | Yes | Yes |
| General Information | Description | `description` | Text | Multi-line text | Textarea (4 rows) | Yes * | Yes | Yes |
| More Information | Service | `service_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Service) |  | Yes | Yes |
| More Information | Service subcategory | `servicesubcategory_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (ServiceSubcategory) |  | Yes | Yes |
| More Information | Hot Flag | `escalation_flag` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Yes, No |  | Yes | Yes |
| More Information | Hot reason | `escalation_reason` | String | Text | Text input |  | Yes | Yes |
| More Information | Pending reason | `pending_reason` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Qualification | Impact | `impact` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: A department, A service, A person |  | Yes | Yes |
| Qualification | Urgency | `urgency` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Critical, High, Medium, Low |  | Yes | Yes |
| Qualification | Priority | `priority` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Critical, High, Medium, Low |  | Yes | Yes |
| Contacts | Team | `team_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Agent | `agent_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Contacts | Approver | `approver_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Dates | Start date | `start_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Last update | `last_update` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Assignment date | `assignment_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | TTO Deadline | `tto_escalation_deadline` | SubItem | Text | Text input |  | Yes | Yes |
| Dates | TTR Deadline | `ttr_escalation_deadline` | SubItem | Text | Text input |  | Yes | Yes |
| Dates | Last pending date | `last_pending_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Resolution date | `resolution_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Close date | `close_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Relations | Parent request | `parent_request_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (UserRequest) |  | Yes | Yes |
| Relations | Parent incident | `parent_incident_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Incident) |  | Yes | Yes |
| Relations | Parent problem | `parent_problem_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Problem) |  | Yes | Yes |
| Relations | Parent change | `parent_change_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Change) |  | Yes | Yes |
| Resolution | Resolution code | `resolution_code` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Assistance, Other, Software patch, Training, Hardware repair, System update, Bug fixed |  | Yes | Yes |
| Resolution | Solution | `solution` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Resolution | Resolution delay | `time_spent` | Duration | Text | Text input |  | Yes | Yes |
| Resolution | User satisfaction | `user_satisfaction` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Very satisfied, Fairly satisfied, Rather dissatisfied, Very dissatisfied |  | Yes | Yes |
| Resolution | User comment | `user_comment` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| SLA report | SLA tto passed | `sla_tto_passed` | SubItem | Text | Text input |  | Yes | Yes |
| SLA report | SLA tto over | `sla_tto_over` | SubItem | Text | Text input |  | Yes | Yes |
| SLA report | SLA ttr passed | `sla_ttr_passed` | SubItem | Text | Text input |  | Yes | Yes |
| SLA report | SLA ttr over | `sla_ttr_over` | SubItem | Text | Text input |  | Yes | Yes |
| Other | cumulatedpending | `cumulatedpending` | StopWatch | Text | Text input |  | Yes | Yes |
| Other | End date | `end_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Other | Operational status | `operational_status` | MetaEnum | Text (iTop value label) | Dropdown (Select) - fixed values: Ongoing, Resolved, Closed |  | Yes | Yes |
| Other | Ref | `ref` | String | Text | Text input |  | Yes | Yes |
| Other | Request Type | `request_type` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Service request |  | Yes | Yes |
| Other | Team email | `team_email` | ExternalField | Text | — (read-only) |  | No | No |
| Other | TTO | `tto` | StopWatch | Text | Text input |  | Yes | Yes |
| Other | TTO time spent | `tto_time_spent` | SubItem | Text | Text input |  | Yes | Yes |
| Other | TTR | `ttr` | StopWatch | Text | Text input |  | Yes | Yes |
| Other | TTR time spent | `ttr_time_spent` | SubItem | Text | Text input |  | Yes | Yes |

### Class layout: Incident

- **Used by sidebar entries:** Incident Management → Assigned to me; Incident Management → New incident; Incident Management → Under escalation; Incident Management → Search for incidents; Incident Management → Open; Incident Management → Reported by me
- **Class:** `Incident` (Incident) · abstract: no · ticket: yes · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Title (`title`) → Organization (`org_id`) → Caller (`caller_id`) → Start date (`start_date`) → Status (`status`) → Agent (`agent_id`)
- **Detail page tabs (9):** Details — _Fieldset cards (RecordForm)_ | Attachments — _AttachmentsPanel (upload / download / delete)_ | CIs — _Related-records list (RelatedTab)_ | Contacts — _Related-records list (RelatedTab)_ | Child incidents — _Related-records list (RelatedTab)_ | Child requests — _Related-records list (RelatedTab)_ | Work orders — _Related-records list (RelatedTab)_ | Public log — _Case log (FieldValue log list)_ | Private log — _Case log (FieldValue log list)_
- **Lifecycle action buttons** (header, driven by `status`; one secondary Button per allowed stimulus):
  - in state **Assigned** (`assigned`): Pending, Mark as resolved, Re-assign, Timeout, Automatic resolve
  - in state **Closed** (`closed`): _none_
  - in state **Escalated TTO** (`escalated_tto`): Assign, Automatic resolve
  - in state **Escalated TTR** (`escalated_ttr`): Pending, Mark as resolved, Re-assign, Automatic resolve
  - in state **New** (`new`): Assign, Timeout, Automatic resolve
  - in state **Pending** (`pending`): Assign, Automatic resolve
  - in state **Resolved** (`resolved`): Close this request, Re-open

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| General Information | Organization | `org_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General Information | Caller | `caller_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| General Information | Status | `status` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: New, Assigned, Pending, Escalated TTO, Escalated TTR, Resolved, Closed |  | Yes | No |
| General Information | Origin | `origin` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: In-person, Chat, Email, Phone, Portal, Monitoring |  | Yes | Yes |
| General Information | Title | `title` | String | Text | Text input | Yes * | Yes | Yes |
| General Information | Description | `description` | Text | Multi-line text | Textarea (4 rows) | Yes * | Yes | Yes |
| More Information | Service | `service_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Service) |  | Yes | Yes |
| More Information | Service subcategory | `servicesubcategory_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (ServiceSubcategory) |  | Yes | Yes |
| More Information | Hot Flag | `escalation_flag` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Yes, No |  | Yes | Yes |
| More Information | Hot reason | `escalation_reason` | String | Text | Text input |  | Yes | Yes |
| More Information | Pending reason | `pending_reason` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Qualification | Impact | `impact` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: A department, A service, A person |  | Yes | Yes |
| Qualification | Urgency | `urgency` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Critical, High, Medium, Low |  | Yes | Yes |
| Qualification | Priority | `priority` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Critical, High, Medium, Low |  | Yes | Yes |
| Contacts | Team | `team_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Agent | `agent_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Dates | Start date | `start_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Last update | `last_update` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Assignment date | `assignment_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | TTO Deadline | `tto_escalation_deadline` | SubItem | Text | Text input |  | Yes | Yes |
| Dates | TTR Deadline | `ttr_escalation_deadline` | SubItem | Text | Text input |  | Yes | Yes |
| Dates | Last pending date | `last_pending_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Resolution date | `resolution_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Close date | `close_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Relations | Parent incident | `parent_incident_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Incident) |  | Yes | Yes |
| Relations | Parent request | `parent_request_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (UserRequest) |  | Yes | Yes |
| Relations | Parent problem id | `parent_problem_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Problem) |  | Yes | Yes |
| Relations | Parent change | `parent_change_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Change) |  | Yes | Yes |
| Resolution | Resolution code | `resolution_code` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Assistance, Other, Software patch, Training, Hardware repair, System update, Bug fixed |  | Yes | Yes |
| Resolution | Solution | `solution` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Resolution | Resolution delay | `time_spent` | Duration | Text | Text input |  | Yes | Yes |
| Resolution | User satisfaction | `user_satisfaction` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Very satisfied, Fairly satisfied, Rather dissatisfied, Very Dissatisfied |  | Yes | Yes |
| Resolution | User comment | `user_comment` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| SLA report | SLA tto passed | `sla_tto_passed` | SubItem | Text | Text input |  | Yes | Yes |
| SLA report | SLA tto over | `sla_tto_over` | SubItem | Text | Text input |  | Yes | Yes |
| SLA report | SLA ttr passed | `sla_ttr_passed` | SubItem | Text | Text input |  | Yes | Yes |
| SLA report | SLA ttr over | `sla_ttr_over` | SubItem | Text | Text input |  | Yes | Yes |
| Other | Cumulated pending | `cumulatedpending` | StopWatch | Text | Text input |  | Yes | Yes |
| Other | End date | `end_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Other | Operational status | `operational_status` | MetaEnum | Text (iTop value label) | Dropdown (Select) - fixed values: Ongoing, Resolved, Closed |  | Yes | Yes |
| Other | Ref | `ref` | String | Text | Text input |  | Yes | Yes |
| Other | Team email | `team_email` | ExternalField | Text | — (read-only) |  | No | No |
| Other | TTO | `tto` | StopWatch | Text | Text input |  | Yes | Yes |
| Other | TTO time spent | `tto_time_spent` | SubItem | Text | Text input |  | Yes | Yes |
| Other | TTR | `ttr` | StopWatch | Text | Text input |  | Yes | Yes |
| Other | TTR time spent | `ttr_time_spent` | SubItem | Text | Text input |  | Yes | Yes |

### Class layout: Problem

- **Used by sidebar entries:** Problem management → New problem; Problem management → My problems; Problem management → Search for problems; Problem management → All open problems
- **Class:** `Problem` (Problem) · abstract: no · ticket: yes · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Title (`title`) → Organization (`org_id`) → Start date (`start_date`) → Status (`status`) → Service (`service_id`) → Priority (`priority`)
- **Detail page tabs (8):** Details — _Fieldset cards (RecordForm)_ | Attachments — _AttachmentsPanel (upload / download / delete)_ | CIs — _Related-records list (RelatedTab)_ | Contacts — _Related-records list (RelatedTab)_ | Known Errors — _Related-records list (RelatedTab)_ | Work orders — _Related-records list (RelatedTab)_ | Related requests — _Related-records list (RelatedTab)_ | Related incidents — _Related-records list (RelatedTab)_
- **Lifecycle action buttons** (header, driven by `status`; one secondary Button per allowed stimulus):
  - in state **Assigned** (`assigned`): Reassign, Resolve
  - in state **Closed** (`closed`): _none_
  - in state **New** (`new`): Assign
  - in state **Resolved** (`resolved`): Reassign, Close

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| General Information | Ref | `ref` | String | Text | Text input |  | Yes | Yes |
| General Information | Organization | `org_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General Information | Caller | `caller_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| General Information | Status | `status` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: New, Assigned, Resolved, Closed |  | Yes | No |
| General Information | Product | `product` | String | Text | Text input |  | Yes | Yes |
| General Information | Title | `title` | String | Text | Text input | Yes * | Yes | Yes |
| General Information | Description | `description` | Text | Multi-line text | Textarea (4 rows) | Yes * | Yes | Yes |
| More Information | Service | `service_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Service) |  | Yes | Yes |
| More Information | Service subcategory | `servicesubcategory_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (ServiceSubcategory) |  | Yes | Yes |
| Qualification | Impact | `impact` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: A Department, A Service, A person |  | Yes | Yes |
| Qualification | Urgency | `urgency` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Critical, High, Medium, Low |  | Yes | Yes |
| Qualification | Priority | `priority` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Critical, High, Medium, Low |  | Yes | Yes |
| Dates | Start date | `start_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Last update | `last_update` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Assignment Date | `assignment_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Resolution Date | `resolution_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Close date | `close_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Contacts | Team | `team_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Agent | `agent_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Relations | Related Change | `related_change_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Change) |  | Yes | Yes |
| Other | End date | `end_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Other | Operational status | `operational_status` | MetaEnum | Text (iTop value label) | Dropdown (Select) - fixed values: Ongoing, Resolved, Closed |  | Yes | Yes |
| Other | Private log | `private_log` | CaseLog | Log entry list (author · date · message) | Textarea (4 rows) |  | Yes | Yes |
| Other | Team email | `team_email` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: KnownError

- **Used by sidebar entries:** Problem management → New known error; Problem management → All known errors; Problem management → Search for known errors
- **Class:** `KnownError` (Known Error) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Organization (`org_id`) → Related Problem (`problem_id`) → Error Code (`error_code`) → Symptom (`symptom`)
- **Detail page tabs (15):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Organization — _Case log (FieldValue log list)_ | Related Problem — _Case log (FieldValue log list)_ | Error Code — _Case log (FieldValue log list)_ | Domain — _Case log (FieldValue log list)_ | Vendor — _Case log (FieldValue log list)_ | Model — _Case log (FieldValue log list)_ | Version — _Case log (FieldValue log list)_ | Symptom — _Case log (FieldValue log list)_ | Root Cause — _Case log (FieldValue log list)_ | Work around — _Case log (FieldValue log list)_ | Solution — _Case log (FieldValue log list)_ | CIs — _Related-records list (RelatedTab)_ | Documents — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Organization Name | `cust_name` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Related Problem Ref | `problem_ref` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: FAQCategory

- **Used by sidebar entries:** Problem management → FAQ categories
- **Class:** `FAQCategory` (FAQ Category) · abstract: no · ticket: no · CI: no
- **List page table columns** (fallback heuristic (class declares no list)): `ID` (link) → Name (`name`)
- **Detail page tabs (3):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | FAQs — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|

### Class layout: FAQ

- **Used by sidebar entries:** Problem management → FAQs
- **Class:** `FAQ` (FAQ) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Category (`category_id`) → Error code (`error_code`) → Domains (`domains`)
- **Detail page tabs (8):** Details — _Fieldset cards (RecordForm)_ | Category — _Case log (FieldValue log list)_ | Title — _Case log (FieldValue log list)_ | Error code — _Case log (FieldValue log list)_ | Key words — _Case log (FieldValue log list)_ | Domains — _Case log (FieldValue log list)_ | Summary — _Case log (FieldValue log list)_ | Description — _Case log (FieldValue log list)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Category name | `category_name` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: Change

- **Used by sidebar entries:** Change management → New change; Change management → Changes assigned to me; Change management → Search for changes; Change management → Open changes
- **Class:** `Change` (Change) · abstract: yes · ticket: yes · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Title (`title`) → Organization (`org_id`) → Start date (`start_date`) → End date (`end_date`) → Status (`status`) → Agent (`agent_id`)
- **Detail page tabs (9):** Details — _Fieldset cards (RecordForm)_ | Attachments — _AttachmentsPanel (upload / download / delete)_ | CIs — _Related-records list (RelatedTab)_ | Contacts — _Related-records list (RelatedTab)_ | Work orders — _Related-records list (RelatedTab)_ | Related requests — _Related-records list (RelatedTab)_ | Related incidents — _Related-records list (RelatedTab)_ | Related problems — _Related-records list (RelatedTab)_ | Child changes — _Related-records list (RelatedTab)_
- **Lifecycle action buttons** (header, driven by `status`; one secondary Button per allowed stimulus):
  - in state **Approved** (`approved`): _none_
  - in state **Assigned** (`assigned`): _none_
  - in state **Closed** (`closed`): _none_
  - in state **Implemented** (`implemented`): _none_
  - in state **Monitored** (`monitored`): _none_
  - in state **New** (`new`): _none_
  - in state **Not approved** (`notapproved`): _none_
  - in state **Planned and scheduled** (`plannedscheduled`): _none_
  - in state **Rejected** (`rejected`): _none_
  - in state **Validated** (`validated`): _none_

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| General Information | Ref | `ref` | String | Text | Text input |  | Yes | Yes |
| General Information | Organization | `org_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General Information | Status | `status` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Approved, Assigned, Closed, Implemented, Monitored, New, Not approved, Planned and scheduled, Rejected, Validated |  | Yes | No |
| General Information | Title | `title` | String | Text | Text input | Yes * | Yes | Yes |
| General Information | Description | `description` | Text | Multi-line text | Textarea (4 rows) | Yes * | Yes | Yes |
| Contacts | Caller | `caller_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Contacts | Team | `team_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Agent | `agent_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Contacts | Supervisor team | `supervisor_group_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Supervisor | `supervisor_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Contacts | Manager team | `manager_group_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Manager | `manager_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Resolution | Reject reason | `reason` | String | Text | Text input |  | Yes | Yes |
| Resolution | Impact | `impact` | String | Text | Text input |  | Yes | Yes |
| Resolution | Outage | `outage` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Yes, No |  | Yes | Yes |
| Resolution | Fallback plan | `fallback` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Relations | Parent change | `parent_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Change) |  | Yes | Yes |
| Dates | Creation date | `creation_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Start date | `start_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | End date | `end_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Last update | `last_update` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Close date | `close_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Other | Operational status | `operational_status` | MetaEnum | Text (iTop value label) | Dropdown (Select) - fixed values: Ongoing, Resolved, Closed |  | Yes | Yes |
| Other | Private log | `private_log` | CaseLog | Log entry list (author · date · message) | Textarea (4 rows) |  | Yes | Yes |
| Other | Requestor | `requestor_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Other | Team email | `team_email` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: ApprovedChange

- **Used by sidebar entries:** Change management → Changes awaiting approval
- **Class:** `ApprovedChange` (Change To Approve) · abstract: yes · ticket: yes · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Title (`title`) → Organization (`org_id`) → Start date (`start_date`) → End date (`end_date`) → Status (`status`) → Agent (`agent_id`)
- **Detail page tabs (9):** Details — _Fieldset cards (RecordForm)_ | Attachments — _AttachmentsPanel (upload / download / delete)_ | CIs — _Related-records list (RelatedTab)_ | Contacts — _Related-records list (RelatedTab)_ | Work orders — _Related-records list (RelatedTab)_ | Related requests — _Related-records list (RelatedTab)_ | Related incidents — _Related-records list (RelatedTab)_ | Related problems — _Related-records list (RelatedTab)_ | Child changes — _Related-records list (RelatedTab)_
- **Lifecycle action buttons** (header, driven by `status`; one secondary Button per allowed stimulus):
  - in state **Approved** (`approved`): _none_
  - in state **Assigned** (`assigned`): _none_
  - in state **Closed** (`closed`): _none_
  - in state **Implemented** (`implemented`): _none_
  - in state **Monitored** (`monitored`): _none_
  - in state **New** (`new`): _none_
  - in state **Not approved** (`notapproved`): _none_
  - in state **Planned and scheduled** (`plannedscheduled`): _none_
  - in state **Rejected** (`rejected`): _none_
  - in state **Validated** (`validated`): _none_

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| General Information | Ref | `ref` | String | Text | Text input |  | Yes | Yes |
| General Information | Organization | `org_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General Information | Status | `status` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Approved, Assigned, Closed, Implemented, Monitored, New, Not approved, Planned and scheduled, Rejected, Validated |  | Yes | No |
| General Information | Title | `title` | String | Text | Text input | Yes * | Yes | Yes |
| General Information | Description | `description` | Text | Multi-line text | Textarea (4 rows) | Yes * | Yes | Yes |
| General Information | Approval comment | `approval_comment` | String | Text | Text input |  | Yes | Yes |
| Contacts | Caller | `caller_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Contacts | Team | `team_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Agent | `agent_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Contacts | Supervisor team | `supervisor_group_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Supervisor | `supervisor_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Contacts | Manager team | `manager_group_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Manager | `manager_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Resolution | Reject reason | `reason` | String | Text | Text input |  | Yes | Yes |
| Resolution | Impact | `impact` | String | Text | Text input |  | Yes | Yes |
| Resolution | Outage | `outage` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Yes, No |  | Yes | Yes |
| Resolution | Fallback plan | `fallback` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Relations | Parent change | `parent_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Change) |  | Yes | Yes |
| Dates | Creation date | `creation_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Start date | `start_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | End date | `end_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Last update | `last_update` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Approval Date | `approval_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Close date | `close_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Other | Operational status | `operational_status` | MetaEnum | Text (iTop value label) | Dropdown (Select) - fixed values: Ongoing, Resolved, Closed |  | Yes | Yes |
| Other | Private log | `private_log` | CaseLog | Log entry list (author · date · message) | Textarea (4 rows) |  | Yes | Yes |
| Other | Requestor | `requestor_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Other | Team email | `team_email` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: NormalChange

- **Used by sidebar entries:** Change management → Changes awaiting acceptance
- **Class:** `NormalChange` (Normal Change) · abstract: no · ticket: yes · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Title (`title`) → Organization (`org_id`) → Start date (`start_date`) → End date (`end_date`) → Status (`status`) → Agent (`agent_id`)
- **Detail page tabs (9):** Details — _Fieldset cards (RecordForm)_ | Attachments — _AttachmentsPanel (upload / download / delete)_ | CIs — _Related-records list (RelatedTab)_ | Contacts — _Related-records list (RelatedTab)_ | Work orders — _Related-records list (RelatedTab)_ | Related requests — _Related-records list (RelatedTab)_ | Related incidents — _Related-records list (RelatedTab)_ | Related problems — _Related-records list (RelatedTab)_ | Child changes — _Related-records list (RelatedTab)_
- **Lifecycle action buttons** (header, driven by `status`; one secondary Button per allowed stimulus):
  - in state **Approved** (`approved`): Implement
  - in state **Assigned** (`assigned`): Plan
  - in state **Closed** (`closed`): _none_
  - in state **Implemented** (`implemented`): Monitor, Finish
  - in state **Monitored** (`monitored`): Finish
  - in state **New** (`new`): Validate, Reject
  - in state **Not approved** (`notapproved`): Replan
  - in state **Planned and scheduled** (`plannedscheduled`): Approve, Reject approval
  - in state **Rejected** (`rejected`): Reopen
  - in state **Validated** (`validated`): Assign

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| General Information | Ref | `ref` | String | Text | Text input |  | Yes | Yes |
| General Information | Organization | `org_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General Information | Status | `status` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Approved, Assigned, Closed, Implemented, Monitored, New, Not approved, Planned and scheduled, Rejected, Validated |  | Yes | No |
| General Information | Title | `title` | String | Text | Text input | Yes * | Yes | Yes |
| General Information | Description | `description` | Text | Multi-line text | Textarea (4 rows) | Yes * | Yes | Yes |
| General Information | Approval comment | `approval_comment` | String | Text | Text input |  | Yes | Yes |
| General Information | Acceptance comment | `acceptance_comment` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Contacts | Caller | `caller_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Contacts | Team | `team_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Agent | `agent_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Contacts | Supervisor team | `supervisor_group_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Supervisor | `supervisor_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Contacts | Manager team | `manager_group_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Team) |  | Yes | Yes |
| Contacts | Manager | `manager_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Resolution | Reject reason | `reason` | String | Text | Text input |  | Yes | Yes |
| Resolution | Impact | `impact` | String | Text | Text input |  | Yes | Yes |
| Resolution | Outage | `outage` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Yes, No |  | Yes | Yes |
| Resolution | Fallback plan | `fallback` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Relations | Parent change | `parent_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Change) |  | Yes | Yes |
| Dates | Creation date | `creation_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Start date | `start_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | End date | `end_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Last update | `last_update` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Approval Date | `approval_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Acceptance date | `acceptance_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Dates | Close date | `close_date` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Other | Operational status | `operational_status` | MetaEnum | Text (iTop value label) | Dropdown (Select) - fixed values: Ongoing, Resolved, Closed |  | Yes | Yes |
| Other | Private log | `private_log` | CaseLog | Log entry list (author · date · message) | Textarea (4 rows) |  | Yes | Yes |
| Other | Requestor | `requestor_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Other | Team email | `team_email` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: CustomerContract

- **Used by sidebar entries:** Service management → Customer contracts
- **Class:** `CustomerContract` (Customer Contract) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Status (`status`) → Customer (`org_id`) → Description (`description`) → Start date (`start_date`) → End date (`end_date`) → Provider (`provider_id`)
- **Detail page tabs (4):** Details — _Fieldset cards (RecordForm)_ | Contacts — _Related-records list (RelatedTab)_ | Documents — _Related-records list (RelatedTab)_ | Services — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| General information | Name | `name` | String | Text | Text input | Yes * | Yes | Yes |
| General information | Customer | `org_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General information | Provider | `provider_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General information | Contract type | `contracttype_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (ContractType) |  | Yes | Yes |
| General information | Description | `description` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Cost information | Cost | `cost` | String | Text | Text input |  | Yes | Yes |
| Cost information | Cost Currency | `cost_currency` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Dollars, Euros |  | Yes | Yes |
| Cost information | Cost unit | `cost_unit` | String | Text | Text input |  | Yes | Yes |
| Cost information | Billing frequency | `billing_frequency` | String | Text | Text input |  | Yes | Yes |
| Contractual information | Status | `status` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: implementation, production, obsolete |  | Yes | Yes |
| Contractual information | Start date | `start_date` | Date | Text | Date picker (input type=date) |  | Yes | Yes |
| Contractual information | End date | `end_date` | Date | Text | Date picker (input type=date) |  | Yes | Yes |

### Class layout: ProviderContract

- **Used by sidebar entries:** Service management → Provider contracts
- **Class:** `ProviderContract` (Provider Contract) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Status (`status`) → Customer (`org_id`) → Description (`description`) → Start date (`start_date`) → End date (`end_date`) → Provider (`provider_id`)
- **Detail page tabs (5):** Details — _Fieldset cards (RecordForm)_ | Contacts — _Related-records list (RelatedTab)_ | Documents — _Related-records list (RelatedTab)_ | CIs — _Related-records list (RelatedTab)_ | Services — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| General information | Name | `name` | String | Text | Text input | Yes * | Yes | Yes |
| General information | Customer | `org_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General information | Provider | `provider_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Organization) | Yes * | Yes | Yes |
| General information | Contract type | `contracttype_id` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (ContractType) |  | Yes | Yes |
| General information | Description | `description` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Cost information | Cost | `cost` | String | Text | Text input |  | Yes | Yes |
| Cost information | Cost Currency | `cost_currency` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Dollars, Euros |  | Yes | Yes |
| Cost information | Cost unit | `cost_unit` | String | Text | Text input |  | Yes | Yes |
| Cost information | Billing frequency | `billing_frequency` | String | Text | Text input |  | Yes | Yes |
| Contractual information | Status | `status` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: implementation, production, obsolete |  | Yes | Yes |
| Contractual information | Start date | `start_date` | Date | Text | Date picker (input type=date) |  | Yes | Yes |
| Contractual information | End date | `end_date` | Date | Text | Date picker (input type=date) |  | Yes | Yes |
| Contractual information | SLA | `sla` | String | Text | Text input |  | Yes | Yes |
| Contractual information | Service hours | `coverage` | String | Text | Text input |  | Yes | Yes |

### Class layout: ServiceFamily

- **Used by sidebar entries:** Service management → Service families
- **Class:** `ServiceFamily` (Service Family) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Name (`name`)
- **Detail page tabs (4):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Icon — _Case log (FieldValue log list)_ | Services — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|

### Class layout: Service

- **Used by sidebar entries:** Service management → Services
- **Class:** `Service` (Service) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Provider (`org_id`) → Status (`status`) → Service Family (`servicefamily_id`)
- **Detail page tabs (13):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Provider — _Case log (FieldValue log list)_ | Service Family — _Case log (FieldValue log list)_ | Description — _Case log (FieldValue log list)_ | Status — _Case log (FieldValue log list)_ | Icon — _Case log (FieldValue log list)_ | Service sub categories — _Related-records list (RelatedTab)_ | Documents — _Related-records list (RelatedTab)_ | Contacts — _Related-records list (RelatedTab)_ | Customer contracts — _Related-records list (RelatedTab)_ | Provider contracts — _Related-records list (RelatedTab)_ | Depends on CIs — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Provider Name | `organization_name` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Service Family Name | `servicefamily_name` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: ServiceSubcategory

- **Used by sidebar entries:** Service management → Service subcategories
- **Class:** `ServiceSubcategory` (Service Subcategory) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Service (`service_id`) → Status (`status`) → Request type (`request_type`) → Service org (`service_org_id`)
- **Detail page tabs (7):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Service — _Case log (FieldValue log list)_ | Service org — _Case log (FieldValue log list)_ | Status — _Case log (FieldValue log list)_ | Request type — _Case log (FieldValue log list)_ | Description — _Case log (FieldValue log list)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Service name | `service_name` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Service provider | `service_provider` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: SLA

- **Used by sidebar entries:** Service management → SLAs
- **Class:** `SLA` (SLA) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Name (`name`) → Provider (`org_id`)
- **Detail page tabs (6):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Provider — _Case log (FieldValue log list)_ | description — _Case log (FieldValue log list)_ | SLTs — _Related-records list (RelatedTab)_ | Customer contracts — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Provider Name | `organization_name` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: SLT

- **Used by sidebar entries:** Service management → SLTs
- **Class:** `SLT` (SLT) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Priority (`priority`) → Request type (`request_type`) → Metric (`metric`) → Value (`value`) → Unit (`unit`)
- **Detail page tabs (8):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Priority — _Case log (FieldValue log list)_ | Request type — _Case log (FieldValue log list)_ | Metric — _Case log (FieldValue log list)_ | Value — _Case log (FieldValue log list)_ | Unit — _Case log (FieldValue log list)_ | SLAs — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|

### Class layout: DeliveryModel

- **Used by sidebar entries:** Service management → Delivery models
- **Class:** `DeliveryModel` (Delivery Model) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Organization (`org_id`)
- **Detail page tabs (6):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Organization — _Case log (FieldValue log list)_ | Description — _Case log (FieldValue log list)_ | Contacts — _Related-records list (RelatedTab)_ | Customers — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Organization Name | `organization_name` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: Organization

- **Used by sidebar entries:** Data administration → Organizations
- **Class:** `Organization` (Organization) · abstract: no · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Code (`code`) → Status (`status`) → Parent (`parent_id`)
- **Detail page tabs (7):** Details — _Fieldset cards (RecordForm)_ | Name — _Case log (FieldValue log list)_ | Code — _Case log (FieldValue log list)_ | Status — _Case log (FieldValue log list)_ | Parent — _Case log (FieldValue log list)_ | Overview — _Case log (FieldValue log list)_ | Delivery model — _Case log (FieldValue log list)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Delivery model name | `deliverymodel_name` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Parent name | `parent_name` | ExternalField | Text | — (read-only) |  | No | No |

### Class layout: User

- **Used by sidebar entries:** Administration → User accounts
- **Class:** `User` (User) · abstract: no · ticket: no · CI: no
- **List page table columns** (fallback heuristic (class declares no list)): `ID` (link) → Friendlyname (`friendlyname`) → Status (`status`) → Type of account (`finalclass`) → Language (`language`) → Login (`login`)
- **Detail page tabs (3):** Details — _Fieldset cards (RecordForm)_ | Allowed Organizations — _Related-records list (RelatedTab)_ | Profiles — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Person | `contactid` | ExternalKey | Text (linked object's name) | Dropdown (Select) - options loaded from BFF (Person) |  | Yes | Yes |
| Details | Contactid friendlyname | `contactid_friendlyname` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Contactid obsolescence flag | `contactid_obsolescence_flag` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Email | `email` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Type of account | `finalclass` | FinalClass | Text | Text input |  | Yes | Yes |
| Details | First name | `first_name` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Friendlyname | `friendlyname` | FriendlyName | Text | Text input |  | Yes | Yes |
| Details | Language | `language` | ApplicationLanguage | Text | Text input |  | Yes | Yes |
| Details | Last name | `last_name` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Login | `login` | String | Text | Text input |  | Yes | Yes |
| Details | Organization | `org_id` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Org friendlyname | `org_id_friendlyname` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Org obsolescence flag | `org_id_obsolescence_flag` | ExternalField | Text | — (read-only) |  | No | No |
| Details | Status | `status` | Enum | Text | Text input |  | Yes | Yes |

### Class layout: URP_Profiles

- **Used by sidebar entries:** Administration → Profiles
- **Class:** `URP_Profiles` (Profile) · abstract: no · ticket: no · CI: no
- **List page table columns** (fallback heuristic (class declares no list)): `ID` (link) → Name (`name`) → Friendlyname (`friendlyname`) → Description (`description`)
- **Detail page tabs (2):** Details — _Fieldset cards (RecordForm)_ | Users — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Description | `description` | String | Text | Text input |  | Yes | Yes |
| Details | Friendlyname | `friendlyname` | FriendlyName | Text | Text input |  | Yes | Yes |
| Details | Name | `name` | String | Text | Text input |  | Yes | Yes |

### Class layout: OAuthClient

- **Used by sidebar entries:** Configuration → OAuth Mail Access
- **Class:** `OAuthClient` (OAuth Mail Access) · abstract: yes · ticket: no · CI: no
- **List page table columns** (iTop `<presentation><list>`): `ID` (link) → Status (`status`) → Provider (`provider`)
- **Detail page tabs (8):** Details — _Fieldset cards (RecordForm)_ | Login — _Case log (FieldValue log list)_ | Description — _Case log (FieldValue log list)_ | Provider — _Case log (FieldValue log list)_ | Redirect url — _Case log (FieldValue log list)_ | Client id — _Case log (FieldValue log list)_ | Client secret — _Case log (FieldValue log list)_ | Mailbox list — _Related-records list (RelatedTab)_
- **Lifecycle action buttons:** none (class has no lifecycle)

#### Fields — Details tab (read mode) and Edit / New forms

| Fieldset (card) | Field label | attcode | iTop type | Read-mode display | Edit/New control | Required | Editable | On New form |
|---|---|---|---|---|---|---|---|---|
| Details | Refresh token | `refresh_token` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Details | Refresh token expiration | `refresh_token_expiration` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |
| Details | Status | `status` | Enum | Text (iTop value label) | Dropdown (Select) - fixed values: Access token generated, No Access token |  | Yes | Yes |
| Details | Access token | `token` | Text | Multi-line text | Textarea (4 rows) |  | Yes | Yes |
| Details | Access token expiration | `token_expiration` | DateTime | Text | Date-time picker (datetime-local) |  | Yes | Yes |

