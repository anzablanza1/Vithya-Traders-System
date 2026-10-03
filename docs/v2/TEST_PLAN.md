# Purchase Intelligence V2 — TEST PLAN

## A. Memory cold-start test
Before coding, a brand-new chat with no project history must accurately explain:
- V1 location and immutability;
- current Purchase architecture;
- V2 problem and object model;
- current work item;
- approved/open decisions;
- next safe action;
- major do-not-break rules.

Failure means docs need improvement before coding.

## B. General regression rules
Every implementation stage must verify:
- frozen V1 archive unchanged;
- existing V1 flow still works until explicitly migrated;
- no secrets committed;
- no fixed-index V1 sheet reader broken by column reordering;
- GST/Non-GST behaviour remains correct;
- PO-Request Goods Check exposes no supplier/rate/amount;
- server-authoritative identifiers remain server-authoritative.

## C. Data-model tests
Prove:
- one shipment -> multiple POs;
- one PO -> multiple shipments;
- shipment line may be partially allocated;
- suggested allocation can be manually reduced/changed;
- unallocated, Excess and Off-PO remain distinct;
- one bill -> multiple shipments;
- one shipment -> multiple bills;
- receipt can differ from shipment/bill without data loss.

## D. Quantity tests
Verify Ordered, In Transit, Received, Pending, Rejected and Accepted = Received - Rejected. Cancellation affects only applicable outstanding qty. Excess never silently increases PO ordered qty.

## E. Migration/back-compat tests
- Existing V1 lots remain readable.
- Migration is idempotent or explicitly one-time with guardrails.
- V1 identifiers stay traceable.
- No historical lot/bill/receipt data silently disappears.
- Old/new rollups reconcile for cases V1 can represent.

## F. Shipment-entry tests
- FIFO suggestion chooses oldest eligible PO first.
- User can edit/reduce suggested allocation.
- Multi-PO shipment works.
- Explicit Excess and Off-PO work.
- Creating shipment sets In Transit, not Received.

## G. Bill tests
- Bill before receipt works.
- Many shipments -> one bill.
- One shipment -> multiple bills.
- W/WO outputs remain separate.
- Rates, GST, charges, round-off reconcile.
- Existing charge allocation behaviour is preserved unless intentionally changed.

## H. Goods Check tests
- Normal confirmation is quick.
- Rejected/short/damaged are explicit.
- Accepted is derived.
- Receipt never overwrites shipment/bill.
- Request-side Goods Check remains quantity/status only.

## I. Vasy validation tests
Block Ready for Vasy on duplicate invoice, missing item code, total mismatch, invalid W/WO split, GST error, unresolved quantity discrepancy, unresolved Excess/Off-PO where policy requires resolution, missing accounting data or rate error.

## J. Documentation completion test
Before a work item is DONE:
- work-item status/implementation notes updated;
- PROJECT_STATE updated if architecture/state changed;
- CURRENT_WORK updated;
- DECISIONS updated for new choices;
- ROADMAP status updated;
- test results recorded;
- deployment verification recorded if deployed.
