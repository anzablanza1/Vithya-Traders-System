# Purchase Intelligence V2 — START HERE

This directory is the active, AI-readable memory for Purchase Intelligence V2.

Purchase V2 sits inside the wider Platform V2 clean redesign. Read `docs/platform-v2/PRINCIPLES.md` first. Any Purchase work involving Inventory, demand, stock, replenishment or shared product identity must also read `docs/shared/PURCHASE_INVENTORY_CONTRACT.md`.

## Purpose
The repo must let a completely new chat continue safely without relying on prior conversation memory. Git is the durable memory; chats are temporary.

## Current position
V1 is frozen and recoverable. V2 implementation has not started.

Immediate sequence:
1. finish V2 memory/navigation;
2. run a cold-start test from a new chat;
3. resolve open architecture decisions;
4. begin V2-01.

## What V2 solves
V1 models a "lot" inside one PO. Real shipments can contain lines from several POs, excess and off-PO items; bills and shipments are also not one-to-one.

V2 separates:
- PO / PO Line
- Shipment / Shipment Line
- Shipment-to-PO Allocation
- Bill / Bill Line
- Bill-to-Shipment Allocation
- Receipt / Goods Check
- Vasy upload

Never force `shipment.po_id` or `bill.shipment_id` as the business model.

## Required reading
Read `AGENTS.md`, then PROJECT_STATE, CURRENT_WORK, DECISIONS, ROADMAP, the active work item, TEST_PLAN, the V1 freeze verification, and only then relevant frozen V1 files.

## Frozen V1
`archive/purchase-intelligence-v1/` must not be edited. Where archived docs say NEEDS LIVE VERIFICATION but the newer freeze-verification doc resolves the point, the newer verified record wins.

## Memory rule
Every meaningful V2 decision or implementation change must be recorded in Git in the same development cycle.
