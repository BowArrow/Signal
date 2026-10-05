# Signal 0.31.1 — repeated Sales handoff sections

Switching the Sales business selector left extra “Needs you” sections in the page.
The handoff and outreach components used the same sibling React key, so switching
businesses could leave the old handoff DOM behind. Each component now has a
distinct key that includes its business ID.

The regression check reproduced two handoff sections after the first business
switch in 0.31.0. It now switches businesses six times, checks that both handoffs
and outreach appear exactly once, confirms conversation isolation, and waits for
the automatic refresh to confirm the duplicate does not return.

Validation: typecheck, lint, production build, Sales UI at desktop and narrow
widths, and handoff approval/reminder/resolution workflows with synthetic offline
data. No customer data, connections, or sending policies are changed by this fix.

The Sales regression also passed against the packaged and installed 0.31.1 app.
The patch was installed successfully and the owner's Signal window reopened.
