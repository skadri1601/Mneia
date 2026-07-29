---
name: milestone-gate
description: Run the milestone-boundary ritual before opening the next project. Use when a milestone is ending, when a GATE ticket needs running, when the user asks whether we can start the next milestone, or at the M0-M1-M2-M3-M4-M5 transitions.
---

# Milestone gate

`ROADMAP.md` §4. Four steps, all of them, before the next project opens.

The point of a gate is that it can fail. A gate that always passes is a checklist item, not a control.

## 1. Run the GATE ticket

| Milestone | Gate | The test |
|---|---|---|
| M1 | **MNE-88** | Did the founder use it daily for 7 days without turning it off? |
| M2 | **MNE-108** | Did 5 external people use it for a week without hand-holding? |
| M3 | **MNE-125** | 100+ installs, week-2 retention, **and first inbound "can my team use this"** |

Write the ruling into the ticket. **If it failed, the next milestone does not open** — schedule the
remediation instead. §18 names the failure this catches: *"workflow change is too costly, retention
collapses after week 2."* Discovering that at M1 costs a week; discovering it at M4 costs the company.

For M3 specifically: the third clause is the real one. Installs and retention with zero team interest
is the §18 primary kill criterion arriving early, not a partial pass.

## 2. Walk S0

Review all five RISK tickets (MNE-157 to MNE-161). Comment on any indicator that moved. **These never
close** — a kill criterion marked Done has stopped doing its job.

Check the open DECISION tickets too: has anything been drifted into rather than decided? §20 is
explicit that decisions get resolved deliberately.

Read carefully before firing a criterion. RISK 2 in particular has a precise bar — cross-vendor
**and** multi-human. Single-vendor memory launches are frequent, will feel threatening, and almost
never meet it.

## 3. Check the north-star

Percentage of rehydrated items referenced, **per team**, trended.

§17: *"If this climbs over time on a per-team basis, the moat is real and compounding. If it stays
flat, we are a nicer markdown file."*

Report the number honestly, including when it is flat. A trend that is not moving is the single most
important thing the founder needs to know, and the easiest to quietly not mention.

## 4. Update the documents

If any ruling changed the plan, update `vision.md` and `ROADMAP.md` in the same pass. A vision
document that no longer matches reality stops being read, and shortly after that stops being followed.

## Then report

Give the founder: gate outcome, any risk indicators that moved, the north-star number, and a
recommendation on whether to open the next milestone. Their call, your evidence.
