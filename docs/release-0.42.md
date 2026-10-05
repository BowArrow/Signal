# Signal 0.42: continuous acquisition and channel testing

Acquisition previously waited the full campaign interval after a successful
task and bypassed the channel allocation used by content publishing. It now
continues with fresh eligible requests after a one-minute pause while daily
capacity remains, and can use the saved channel-testing option to allocate work
across feasible selected destinations.

Successful searches refresh every 15 minutes while capacity remains. Rate-limited
or unavailable sources back off for an hour; failed or blocked agent tasks retain
the configured retry interval. Active tasks are serialized, unsuitable requests
remain excluded, and pending/uncertain deliveries continue reserving capacity.

Channel testing rotates destinations before concentrating on measured results,
retaining every fourth cycle for exploration. Acquisition uses the new person's
actual question, never a previous campaign's conversation. Up to ten permitted
accounts can be selected. The Operations channel inventory shows all 19 traction
channels, selected distribution tests, remaining public capacity and the setup,
funding or manual activity that other channels still need.

No daily limit, email permission, spending allowance or platform restriction is
increased by enabling testing. Automatic public-thread continuation remains a
separate unfinished capability. A social test does not establish an audience.

Research: marketing-research/bullseye-execution-2026-09-26.md.
Validation and installation evidence: data/operations-validation/release-0.42.json.

Validation: 787 tests across 33 files passed. The final acquisition prompt
adjustment was followed by a passing 110-test rerun of the affected marketing
and operations files. Type checking and targeted lint passed. The final packaged
Windows app passed business isolation, persistence, offline enforcement and
populated channel/conversation UI checks at 1440x900 and 720x800, with zero
renderer errors. Screenshots were visually inspected. These checks do not claim
that a live channel has acquired a customer or validate every model judgment.

The owner's Lemonade configuration change is prepared in
scripts/enable-owner-channel-tests.mjs. It requires the verified 0.42 package,
Signal fully quit, and no pending marketing work. It enables feasible verified
destinations, preserves limits and Run state, and retains declined-finding
history. It does not launch agents or make external requests itself.
