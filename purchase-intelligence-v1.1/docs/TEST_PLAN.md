# Purchase Intelligence V1.1 — Test Plan

V1.1 must preserve the current working system while adding transitional behaviour.

## Regression baseline

Before and after each release verify:
- existing PO creation still works;
- existing V1 historical Lots remain readable;
- existing purchase-register primary/fallback paths still work;
- GST/Non-GST logic still works;
- current W/WO bill calculation still reconciles;
- Vasy upload output remains correct;
- Goods Check does not expose supplier/rate/amount on the requester-facing screen;
- existing live users can continue normal work.

## V1.1 behaviour tests

Test at minimum:
- one Shipment allocated to two or more POs;
- one PO partially fulfilled by multiple Shipments;
- FIFO suggestion can be edited/reduced;
- Shipment quantity may exceed selected PO quantity without silently changing PO ordered quantity;
- Excess and Off-PO remain distinguishable;
- Shipment save means In Transit, not Received;
- Bill can be prepared before receipt;
- Bill/Shipment/Receipt quantities remain independent;
- partial receipt;
- rejection/damage/short exception;
- existing V1 Lot/history still opens correctly;
- Vasy upload validation catches duplicate/missing/mismatch cases.

## Release rule

Do not replace the current production deployment until the owner has tested the changed workflow.

After production deployment:
- record deployment version;
- perform one known-good transaction;
- perform one edge case relevant to the release;
- update CHANGE_REGISTER_V1_1.md;
- commit/push the exact live source.
