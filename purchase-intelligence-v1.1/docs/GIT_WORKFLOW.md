# Purchase Intelligence V1.1 — Git / Live Workflow

## Source-of-truth rule

During V1.1 development there are three different things:

1. **Frozen V1** — immutable reference under `archive/purchase-intelligence-v1/`.
2. **V1.1 Git source** — active source under `purchase-intelligence-v1.1/`.
3. **Live Apps Script / live HTML** — production runtime.

The frozen V1 archive is never edited.

After a V1.1 change is proven live, Git must be updated to match the exact working source **except secret values**. Secrets must remain in Script Properties/private recovery locations, never committed.

## Development cycle

1. Work only on branch `purchase-v1.1-transition`.
2. Read `PROJECT_STATE.md`, `CHANGE_REGISTER_V1_1.md`, `TEST_PLAN.md` and the real V1 source.
3. Have the build chat state exactly which files/functions it wants changed and why.
4. Make the change in the live/test Apps Script or HTML as instructed.
5. Test before production deployment.
6. After the working version is confirmed, pull/copy the exact live source back into:
   - `purchase-intelligence-v1.1/apps-script/`
   - `purchase-intelligence-v1.1/frontend/`
7. Update `CHANGE_REGISTER_V1_1.md` with implementation details, deployment and tests.
8. Review `git diff`.
9. Commit code + documentation together.
10. Push `purchase-v1.1-transition`.
11. Only after a stable milestone, create a release tag such as `purchase-v1.1.0`.

## Important

Never rely on the AI's generated code as proof of what is live.

Git must ultimately contain the **exact tested/deployed functional source**, not merely the draft that the AI originally suggested. The only allowed difference is secret material: hard-coded secret values must be redacted or, preferably, moved to Script Properties before the Git copy is committed.

If the owner manually changes a line while testing, that final live line must also be reflected in Git.

## V2 handoff

Do not merge the V1.1 branch wholesale into clean V2.

When V1.1 validates a useful behaviour, record that learning in V2 documentation separately. Reuse V1.1 code only after explicit V2 architectural review.
