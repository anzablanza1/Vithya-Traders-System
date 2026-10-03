# V2-05 — Bill / Material Inward

Status: PENDING
Depends on: V2-03

## Goal
Make Bill a first-class object separate from physical shipment and PO.

## Requirements
- Select billable quantities from one or many shipments.
- Allow one shipment to be split across multiple bills.
- Bill may be prepared before arrival.
- Preserve W/WO split.
- Preserve rates, GST, discounts where applicable, freight/packing/additional charges, round-off, totals, Vasy item-code mapping, Vasy bill number and upload preparation.
- Preserve frozen V1 additional-charge allocation behaviour unless a deliberate later decision changes it.
- Support additional/off-PO/charge lines with explicit treatment.

## Acceptance
- Many shipments -> one bill works.
- One shipment -> multiple bills works.
- Totals reconcile by lane and overall.
- Shipment quantities remain unchanged by bill edits.
- TEST_PLAN B, C and G pass.
