# Signal interface refresh

Signal is an operator's workspace: start marketing, follow conversations, review outcomes, and adjust the setup. The interface should make these tasks easier to find without changing delivery permissions.

## Direction

- Keep the existing identity: navy background `#161826`, raised surface `#232532`, text `#e9e9ed`, secondary text `#b2b6ca`, lavender `#b5abfc`, warning `#c9b46a`. Resolve styles through the existing Nocturne tokens.
- Keep the bundled Inter family for offline reliability. Use 26px page headings, 19px sections, 15px subsection headings, and 14px interface text. Numbers use tabular figures.
- Left-aligned working layout: grouped navigation, a consistent page heading and business selector, then a compact status/action area. Detailed research and configuration get their own Operations views.
- Reserve the solid accent for the main action. Secondary actions have quiet borders; selected navigation and keyboard focus remain distinct.

```
Signal             Operations                         Business
Work               Status + Run / Pause
  Operations       Results summary
  Sales            Overview | Research | Conversations | Deliveries | Settings
  Review queue     Active view
Create
Measure
Setup
Advanced tools
```

The first draft would have merely added more cards. Instead, retain the existing surfaces, reduce large headings, move advanced tools into a disclosure, and separate tasks. This addresses the current navigation and reading burden instead of decorating it.

## Acceptance

- All existing screens remain reachable, including advanced tools at short window heights.
- Text inputs, native checkboxes, buttons, tabs, and headings share consistent sizing.
- Operations settings remain mounted when switching views so unsaved edits survive.
- Keyboard navigation has visible focus, meaningful control names, and a skip link.
- Check real renderer screenshots at desktop and compact sizes, plus offline action guards and product isolation.
- No changes to account credentials, live operations policies, publishing, or spend limits.

## Implemented and verified

- Grouped sidebar with scrollable navigation and a collapsible Advanced tools section. Removed the static footer message that implied reviews had occurred.
- Operations now separates overview, research, conversations, delivery history, and settings. Hidden panels retain draft form state. Tabs support arrow keys and Home/End.
- Shared sizing, contrast, spacing, wrapping, native checkbox treatment, action states, and dark native controls across screens. Reduced motion is respected.
- Connections prioritizes linked accounts, with an Add an account shortcut and expandable setup guide.
- Screen navigation resets the content scroll position. A keyboard skip link reaches the main content.
- The screen audit found an existing SQL alias error in the Guardrails community query. Added the explicit alias, handled load errors, and corrected outdated descriptions that contradicted automatic Operations.

Validation on September 27, 2026:

- TypeScript and targeted ESLint passed.
- Ten primary screens checked at 1440, 960, 720, and 480px. No content overflow, stretched checkboxes, or renderer exceptions. All eight advanced screens also opened successfully.
- Keyboard tab navigation, unsaved settings across Operations views, and access to advanced navigation in a 720x550 window passed.
- Connections tests passed: encrypted fixture credentials, rename and shared accounts, disconnect, provider filtering, and business isolation.
- Packaged Operations and Analytics UI checks passed at 1440x900 and 720x800, including offline guards, persistence, and product isolation.
- Actual desktop and compact renderer screenshots reviewed under `data/workspace-ui-validation/`; all tests use isolated offline profiles.

Build: `release/Signal Setup 0.45.0.exe`. Installation status and hashes are recorded separately in `data/operations-validation/release-0.45.json`. The installer helper refuses to replace the app while the owner's Signal process is running.
