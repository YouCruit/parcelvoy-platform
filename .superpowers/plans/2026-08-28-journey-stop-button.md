# Journey Stop Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Stop" action to each running-journey row on a user's Journeys tab that ends every active entrance the user has in that journey.

**Architecture:** Two production TypeScript files (`api.ts`, `UserDetailJourneys.tsx`) plus three locale data files: a new `journeys.exit` method on the existing API client wrapping the already-existing backend route `DELETE /admin/projects/:project/journeys/:journeyId/users/:userId`, and a new per-row action column in `UserDetailJourneys.tsx` that calls it after a `confirm()` guard, gated to rows where `ended_at` is empty.

**Tech Stack:** React + TypeScript (CRA via react-app-rewired), axios-based API client, react-i18next for strings, existing `SearchTable`/`DataTable`/`Button`/icon components.

**Spec:** none — classified as Bounded during brainstorming (see conversation history). Design was approved in-chat; no written spec doc for this scope.

## Global Constraints

- Use the **all-active-entrances** route, `DELETE /admin/projects/:project/journeys/:journeyId/users/:userId` — NOT the single-entrance route. User's explicit choice.
- Icon: `ForbiddenIcon` — matches `CampaignDetail.tsx`'s `abort_campaign` action, the established "abort something in-progress" icon in this codebase.
- The stop button only renders when `item.ended_at` is falsy (row shows "Running").
- `event.stopPropagation()` MUST be called synchronously, as the first statement in the click handler — before `confirm()` and before any `await`. `DataTable`'s row click and an in-cell button's click both fire on the bubble phase, and native DOM event propagation finishes synchronously before an async function's post-`await` continuation runs — calling `stopPropagation()` after an `await` (as `apps/ui/src/views/settings/ApiKeys.tsx`'s `handleCopy` does) does not reliably prevent the row's `onSelectRow` from also firing. Do not copy that pattern.
- Confirm via `confirm(t('stop_journey_confirmation'))` before calling the API — matches the majority row-action convention in this codebase (`ApiKeys.tsx`, `Admins.tsx`, `Locales.tsx`, `UserDetail.tsx`'s `deleteUser`), not `CampaignDetail.tsx`'s confirm-less page-level abort.
- New i18n keys (`stop_journey`, `stop_journey_confirmation`) go in all three locale files (`apps/ui/public/locales/en.json`, `es.json`, `zh.json`), inserted alphabetically, matching each file's existing key ordering. The Spanish/Chinese strings are machine-translated by the plan author and should get a native-speaker review before this reaches non-English users — flagged, not blocking.
- No test files exist anywhere under `apps/ui/src` (confirmed: zero `*.test.ts*` matches) despite a configured `test` script. Do not invent new test infrastructure for this change. Verification is `npm run lint` + `npm run build` (both from `apps/ui`), plus a documented manual verification pass — that is this codebase's actual practice for UI changes, not a shortcut.
- This repo (`parcelvoy-platform`) has no `CLAUDE.md`/`AGENTS.md` of its own. The `parcelvoy-k8s` repo's "fork changes ship via a `PLATFORM_REF` bump, never by merging the fork's `main`" rule governs a LATER, separate, explicit-ask step (bumping the pin in `parcelvoy-k8s` once this is merged) — out of scope for this plan.
- Plan/task files live at `.superpowers/plans/` (this repo's root), not `docs/superpowers/plans/` — this repo's `docs/` directory is the public Docusaurus documentation site (confirmed: `docusaurus.config.js`, `sidebars.js`, its own `package.json` live there), so the skill's literal default path was deliberately not used to avoid dropping an internal planning doc into the public docs site's source tree.

**User decisions (already made):**
- Stop button ends ALL active entrances the user has in that journey, not just the row's single entrance.
- Button placement: a new column immediately after "Ended At" in the Journeys tab table (`UserDetailJourneys.tsx`).
- Button only appears on rows currently "Running" (i.e. `ended_at` is empty).
- Scope limited to `UserDetailJourneys.tsx` only — `EntranceDetails.tsx` (the per-entrance detail page) is explicitly out of scope for this plan.

---

## Task 1: `journeys.exit` API client method + i18n strings

**Goal:** Add the API client method the UI will call, and the two new translation keys it needs, so Task 2 has everything it needs to wire up the button.

**Non-goals:**
- Do not add or change the Stop button UI in this task.
- Do not modify the backend route or introduce test infrastructure.

**Context:**
- Task 2 consumes `api.journeys.exit`, `stop_journey`, and `stop_journey_confirmation`.
- Changes are limited to the existing API client and the three locale JSON files.
- Validation runs from `apps/ui` with `npm run lint` and `npm run build`.
- The `es`/`zh` strings inserted here are machine-translated and not blocking for this task's completion — flag them to Patrick as a pending native-speaker review before this feature is exposed to non-English-locale users; do not hold up landing this task on that review.

**Files:**
- Modify: `apps/ui/src/api.ts:176-200` (the `journeys` client object)
- Modify: `apps/ui/public/locales/en.json`
- Modify: `apps/ui/public/locales/es.json`
- Modify: `apps/ui/public/locales/zh.json`

**Acceptance Criteria:**
- [ ] `api.journeys.exit(projectId, journeyId, userId)` exists, typed `(projectId: number | string, journeyId: number | string, userId: number | string) => Promise<number>`, and issues `DELETE ${projectUrl(projectId)}/journeys/${journeyId}/users/${userId}` via the shared `client` axios instance, returning `r.data`.
- [ ] `en.json`, `es.json`, `zh.json` each gain exactly two new keys, `stop_journey` and `stop_journey_confirmation`, inserted in alphabetical position among each file's existing keys.
- [ ] `npm run lint` (from `apps/ui`) passes with no new errors.
- [ ] `npm run build` (from `apps/ui`) completes without TypeScript errors.

**Verify:** `cd apps/ui && npm run lint && npm run build` → both exit 0.

**Steps:**

- [ ] **Step 1: Add the `exit` method to the `journeys` client object**

In `apps/ui/src/api.ts`, inside the `journeys: { ... }` object, add a new `exit` method after the existing `entrances: { ... }` block (before the closing brace that ends `journeys`). The full object should read:

```ts
    journeys: {
        ...createProjectEntityPath<Journey>('journeys'),
        duplicate: async (projectId: number | string, journeyId: number | string) => await client
            .post<Campaign>(`${projectUrl(projectId)}/journeys/${journeyId}/duplicate`)
            .then(r => r.data),
        steps: {
            get: async (projectId: number | string, journeyId: number | string) => await client
                .get<JourneyStepMap>(`/admin/projects/${projectId}/journeys/${journeyId}/steps`)
                .then(r => r.data),
            set: async (projectId: number | string, journeyId: number | string, stepData: JourneyStepMap) => await client
                .put<JourneyStepMap>(`/admin/projects/${projectId}/journeys/${journeyId}/steps`, stepData)
                .then(r => r.data),
            searchUsers: async (projectId: number | string, journeyId: number | string, stepId: number | string, params: SearchParams) => await client
                .get<SearchResult<JourneyUserStep>>(`/admin/projects/${projectId}/journeys/${journeyId}/steps/${stepId}/users`, { params })
                .then(r => r.data),
        },
        entrances: {
            search: async (projectId: number | string, journeyId: number | string, params: SearchParams) => await client
                .get<SearchResult<JourneyUserStep>>(`/admin/projects/${projectId}/journeys/${journeyId}/entrances`, { params })
                .then(r => r.data),
            log: async (projectId: number | string, entranceId: number | string) => await client
                .get<JourneyEntranceDetail>(`${projectUrl(projectId)}/journeys/entrances/${entranceId}`)
                .then(r => r.data),
        },
        exit: async (projectId: number | string, journeyId: number | string, userId: number | string) => await client
            .delete<number>(`${projectUrl(projectId)}/journeys/${journeyId}/users/${userId}`)
            .then(r => r.data),
    },
```

- [ ] **Step 2: Add the i18n keys to `en.json`**

In `apps/ui/public/locales/en.json`, find the alphabetically correct position among the existing keys (the file is sorted alphabetically by key throughout) and insert, matching the surrounding lines' exact indentation and trailing-comma style:

```json
    "stop_journey": "Stop Journey",
    "stop_journey_confirmation": "Are you sure you want to stop this journey for this user? They will not receive any further steps in this journey.",
```

- [ ] **Step 3: Add the i18n keys to `es.json`**

Same alphabetical position, in `apps/ui/public/locales/es.json`:

```json
    "stop_journey": "Detener Recorrido",
    "stop_journey_confirmation": "¿Estás seguro de que deseas detener este recorrido para este usuario? No recibirá ningún paso adicional de este recorrido.",
```

- [ ] **Step 4: Add the i18n keys to `zh.json`**

Same alphabetical position, in `apps/ui/public/locales/zh.json`:

```json
    "stop_journey": "停止旅程",
    "stop_journey_confirmation": "您确定要为此用户停止此旅程吗？他们将不会收到此旅程的任何后续步骤。",
```

- [ ] **Step 5: Verify**

Run: `cd apps/ui && npm run lint`
Expected: exits 0, no new lint errors.

Run: `cd apps/ui && npm run build`
Expected: exits 0, no TypeScript errors. This also validates all three JSON files still parse — a malformed locale file fails the build.

- [ ] **Step 6: Commit**

```bash
git add apps/ui/src/api.ts apps/ui/public/locales/en.json apps/ui/public/locales/es.json apps/ui/public/locales/zh.json
git commit -m "feat(ui): add journeys.exit API client method and stop_journey i18n strings"
```

---

## Task 2: Stop button on the Journeys tab

**Goal:** Render a "Stop Journey" button on every "Running" row of a user's Journeys tab; clicking it (after confirmation) ends every active entrance the user has in that journey and refreshes the table.

**Non-goals:**
- Do not add this action to `EntranceDetails.tsx` or any other journey view.
- Do not change the backend route, the API client contract, or the locale strings established by Task 1.
- Do not introduce new automated test infrastructure.

**Context:**
- This task depends on Task 1 providing `api.journeys.exit`, `stop_journey`, and `stop_journey_confirmation`.
- The action belongs in `apps/ui/src/views/users/UserDetailJourneys.tsx`, immediately after the "Ended At" column.
- `event.stopPropagation()` must fire before `confirm()`/any `await`, so the row's own navigation doesn't also trigger.

**Files:**
- Modify: `apps/ui/src/views/users/UserDetailJourneys.tsx`

**Acceptance Criteria:**
- [ ] A new `actions` column renders after the "Ended At" column.
- [ ] The new column's cell renders a `Button` (icon `ForbiddenIcon`, `variant="destructive"`, `size="small"`, label `t('stop_journey')`) ONLY when `item.ended_at` is falsy; renders nothing when `item.ended_at` is set.
- [ ] Clicking the button calls `event.stopPropagation()` synchronously as the first statement in the handler — before `confirm()`, before any `await` — so it does not also trigger `onSelectRow`'s navigation to the entrance detail page.
- [ ] Clicking the button shows `confirm(t('stop_journey_confirmation'))`; if the user cancels, nothing else happens (no API call, no reload).
- [ ] On confirm, calls `api.journeys.exit(projectId, item.journey!.id, userId)` exactly once — the all-active-entrances route, not the single-entrance route — then `await state.reload()`.
- [ ] The DELETE request the button fires has the URL shape `/admin/projects/<projectId>/journeys/<journeyId>/users/<userId>` — three path segments after `/admin/projects/<projectId>/journeys/`, ending in `/users/<userId>`, with NO `entrances/<entranceId>` segment anywhere in the path. This is what makes it the all-active-entrances route rather than the single-entrance one; it's a UI-layer property, provable on any single click, independent of how many entrances the test user actually has (the backend route's own multi-entrance behavior is already implemented and out of scope for this plan — see `Non-goals`).
- [ ] `npm run lint` (from `apps/ui`) passes with no new errors.
- [ ] `npm run build` (from `apps/ui`) completes without TypeScript errors.

**Verify:** `cd apps/ui && npm run lint && npm run build` → both exit 0. Then the manual verification pass in Step 4 below (this repo has no automated UI test infrastructure — see Global Constraints).

**Steps:**

- [ ] **Step 1: Update imports**

In `apps/ui/src/views/users/UserDetailJourneys.tsx`, change the imports to:

```tsx
import { useCallback, useContext } from 'react'
import { ProjectContext, UserContext } from '../../contexts'
import { SearchTable, useSearchTableQueryState } from '../../ui/SearchTable'
import api from '../../api'
import { Button, Tag } from '../../ui'
import { ForbiddenIcon } from '../../ui/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PreferencesContext } from '../../ui/PreferencesContext'
import { formatDate } from '../../utils'
```

This adds `Button` to the existing `'../../ui'` import and adds the new `ForbiddenIcon` import from `'../../ui/icons'`.

- [ ] **Step 2: Add the stop handler and the new column**

Replace the component body so the full file reads:

```tsx
import { useCallback, useContext } from 'react'
import { ProjectContext, UserContext } from '../../contexts'
import { SearchTable, useSearchTableQueryState } from '../../ui/SearchTable'
import api from '../../api'
import { Button, Tag } from '../../ui'
import { ForbiddenIcon } from '../../ui/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PreferencesContext } from '../../ui/PreferencesContext'
import { formatDate } from '../../utils'

export default function UserDetailJourneys() {

    const { t } = useTranslation()
    const navigate = useNavigate()

    const [project] = useContext(ProjectContext)
    const [user] = useContext(UserContext)

    const projectId = project.id
    const userId = user.id

    const [preferences] = useContext(PreferencesContext)
    const state = useSearchTableQueryState(useCallback(async params => await api.users.journeys.search(projectId, userId, params), [projectId, userId]))

    const stopJourney = async (event: React.MouseEvent<HTMLButtonElement, MouseEvent>, journeyId: number) => {
        event.stopPropagation()
        if (confirm(t('stop_journey_confirmation'))) {
            await api.journeys.exit(projectId, journeyId, userId)
            await state.reload()
        }
    }

    return (
        <SearchTable
            {...state}
            title={t('journeys')}
            columns={[
                {
                    key: 'journey',
                    title: t('journey'),
                    cell: ({ item }) => item.journey!.name,
                },
                {
                    key: 'created_at',
                    title: t('created_at'),
                },
                {
                    key: 'ended_at',
                    title: t('ended_at'),
                    cell: ({ item }) => item.ended_at
                        ? formatDate(preferences, item.ended_at, 'Ppp')
                        : <Tag variant="info">{t('running')}</Tag>,
                },
                {
                    key: 'actions',
                    cell: ({ item }) => !item.ended_at && (
                        <Button
                            icon={<ForbiddenIcon />}
                            size="small"
                            variant="destructive"
                            onClick={async (event) => await stopJourney(event, item.journey!.id)}
                        >{t('stop_journey')}</Button>
                    ),
                },
            ]}
            onSelectRow={e => navigate(`../../entrances/${e.entrance_id}`)}
        />
    )
}
```

- [ ] **Step 3: Verify build and lint**

Run: `cd apps/ui && npm run lint`
Expected: exits 0.

Run: `cd apps/ui && npm run build`
Expected: exits 0.

- [ ] **Step 4: Manual verification pass** (no automated UI test infrastructure exists in this repo — see Global Constraints)

Run: `cd apps/ui && npm start`, then in a browser:
1. Navigate to a user with at least one running journey entrance (e.g. `/projects/1/users/690048/journeys`).
2. Confirm a "Stop Journey" button with a forbidden-sign icon appears next to the "Running" tag, in a new column after "Ended At".
3. Confirm a row whose entrance already has an `Ended At` timestamp shows NO button in that column.
4. Click the button, then click "Cancel" on the confirm dialog. Confirm nothing happens: no navigation, no network request, the row still shows "Running".
5. Open the browser's Network tab. Click the button again, then click "OK". Confirm: no navigation happened; the fired `DELETE` request's URL is `/admin/projects/<projectId>/journeys/<journeyId>/users/<userId>` — ending in `/users/<userId>`, with NO `entrances/<entranceId>` segment anywhere in the path (this is what makes it the all-active-entrances route rather than the single-entrance one — a UI-layer property, checkable on this one request regardless of how many entrances the test user has; the backend's own "ends every active entrance" behavior is already implemented and verified server-side, see Non-goals); and after the request resolves, the row shows a real `Ended At` timestamp instead of "Running" (the table reloaded).
6. Click a row in a column OTHER than the new one — confirm normal navigation to that entrance's detail page still works (the row click isn't broken by the new column).

- [ ] **Step 5: Commit**

```bash
git add apps/ui/src/views/users/UserDetailJourneys.tsx
git commit -m "feat(ui): add Stop Journey button to user journeys table"
```
