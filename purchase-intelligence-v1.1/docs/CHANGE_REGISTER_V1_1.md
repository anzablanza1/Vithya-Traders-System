# VT Purchase Intelligence — CHANGE REGISTER · V1.1

> V1 is frozen. V1.1 is the transitional live-maintenance release.
> Clean V2 continues separately and may use a different implementation.

Owner: Anu / build-side AI
Status: ✅ Done · 🔧 In progress · ⏳ Pending · 🧊 Deferred · ❌ Dropped

---

## V1.1 goal

Fix the V1 limitation that assumes one Lot belongs to one PO.

The required live behaviour is:

- one physical Shipment may contain quantities from multiple POs;
- one PO may be fulfilled by multiple Shipments;
- Shipment entry is product-first;
- FIFO oldest-open-PO-first is a suggestion only;
- allocations are manually editable;
- Excess and Off-PO remain distinct;
- Shipment creation means In Transit, not Received;
- Bill is separate from Shipment;
- one Bill may draw from multiple Shipments and one Shipment may be split across Bills where required;
- Bill may be prepared before physical arrival;
- Goods Check / Receipt remains a separate arrival-verification step;
- Shipment Qty, Bill Qty and Receipt Qty remain independent;
- Accepted = Received - Rejected;
- existing W/WO, GST, charges, round-off, Vasy mapping and upload behaviour must continue unless explicitly changed.

## Important V1.1 implementation rule

The behaviours above are the target.

The **implementation does not have to reproduce the clean V2 architecture** if doing so would create unnecessary risk inside the existing V1 codebase.

V1.1 should use the smallest backward-compatible changes that safely deliver the behaviour.

Any V1.1 technical shortcut must be documented so future V2 work can distinguish:
- validated business behaviour;
- temporary V1.1 implementation compromise.

---

## V1.1 build plan

| ID | Work item | Status |
|---|---|---|
| V1.1-00 | Freeze V1 and create V1.1 branch/source/docs | ✅ Done |
| V1.1-01 | Data structures + server support for multi-PO Shipment allocations; preserve V1 compatibility | ⏳ |
| V1.1-02 | Backward compatibility / mapping for existing V1 Lots | ⏳ |
| V1.1-03 | Shipment Entry: product-first, FIFO suggestion, editable PO allocation, Excess/Off-PO | ⏳ |
| V1.1-04 | Derive Ordered / In Transit / Received / Pending without breaking current views | ⏳ |
| V1.1-05 | Bill / Material Inward separated from Shipment while preserving W/WO/Vasy logic | ⏳ |
| V1.1-06 | Goods Check / Receipt separation and exception handling | ⏳ |
| V1.1-07 | Vasy validation/generation from the V1.1 Bill workflow | ⏳ |
| V1.1-08 | Central operational exceptions where practical in V1.1 | ⏳ |
| V1.1-09 | User-facing Lot → Shipment terminology where safe | ⏳ |

## Sequencing

Default order:

`V1.1-01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09`

The old Purchase Dashboard chat may recommend combining or simplifying steps if that is safer in the existing V1 architecture. Any such change must be recorded here before implementation.

---

## V1.1 change log

For every live change add:

### YYYY-MM-DD — V1.1-x
- Requirement:
- Files changed:
- Data/Sheet/API changes:
- Backward-compatibility impact:
- Deployment version / deployment ID reference:
- Tests performed:
- Result:
- Known issues:
- V2 learning / reference value:

No production change is complete until this log is updated.
