# Regular catalog import

No import occurs on startup. `fixtures/seller-catalog-pack.json` is data from the supplied
pack; embedded prompts in the ZIP are not executed or treated as approval.

Prerequisites: an existing development-mode schema-5 regular database, an active verified
Management account, and two distinct verified customer accounts dedicated to the demo stores.
The importer never creates accounts, sets verification status, changes roles or stores passwords.
Register and verify owners through the normal website. Gmail dots/plus-tags do not create
separate SaleSync identities. Do not modify Gmail, payment or POS settings for this operation.

Set the two addresses in the private, Git-ignored `data/catalog-import-owners.json`:
`sellers.sample-techhub` and `sellers.sample-stylehub`. The TechHub address supplied by the
owner is already recorded; StyleHub remains empty. The existing Management UUID is recorded
as `managerId`. No password or verification code belongs in this file.

From the project directory:

```powershell
npm.cmd run catalog:import -- --target=regular --dry-run --owners=data/catalog-import-owners.json
```

Review the actual target, blockers, store ownership, twelve products, twenty-six variant SKUs,
prices, category mapping and 124 stock units. Existing matching imported records are skipped;
unrelated name/SKU collisions block the entire operation. The pack's unverified external photo
URLs are not imported. Existing matching SaleSync illustrations are explicitly labeled.

**Obtain the owner's explicit approval of this dry-run before applying.** Once blockers are
cleared, use the exact `approval` digest from the reviewed dry-run:

```powershell
npm.cmd run catalog:import -- --target=regular --apply --owners=data/catalog-import-owners.json --confirm=APPROVED_DRY_RUN_DIGEST
```

Apply creates and integrity-verifies a WAL-safe backup in `data/backups/`, rechecks the plan
inside a write transaction, and uses the existing seller application, Management approval,
product and variation inventory services. Parent stock is allocated into variant stock once.
Any service failure rolls back all imported records. Rerunning does not reset prices or stock.
The regular database is never replaced; no migrations, orders, payments or sales are created.

```powershell
npm.cmd run test:catalog-import
npm.cmd run test:catalog-import:browser
Start-Process 'http://127.0.0.1:3000'
```

Both test commands use isolated databases. The browser test requires Chrome; use `CHROME_PATH`
if installed elsewhere. After the actual import, check the regular public catalog and sign in
as each verified seller to confirm the five TechHub listings and seven StyleHub listings.
Do not report isolated results as evidence that regular data has already been imported.

## Authorized synthetic-seller fallback

The regular installation has a public HTTPS origin. Synthetic accounts activated without a
real inbox therefore belong in the separate loopback-only catalog, not the regular database.
The owner explicitly authorized this fallback. It uses the same manifest/import services:

```powershell
npm.cmd run catalog:demo -- --dry-run
npm.cmd run catalog:demo -- --apply --confirm=LOCAL-CATALOG-DEMO
npm.cmd run catalog:demo -- --serve
Start-Process 'http://localhost:3003'
```

Actual target: `data/catalog-presentation/salesync.sqlite`, schema 5. The regular database,
existing `data/demo/` and `data/presentation/` remain separate. Provisioning creates two seller
customers, one shopping customer and two isolated administrator fixtures; it does not change
regular administrator accounts. Seller access still comes from an approved owned store.

Identifiers use the non-deliverable `catalog.salesync.invalid` namespace. `verified_at` is used
only as the existing schema's internal activation gate; API profiles explicitly report
`verified:false`, `localFixture:true`, and `activation:local-development-only`. Provisioning
audits record `mailboxVerified:false`. These are not verified Gmail accounts or genuine
merchant approvals. Public registration remains Gmail-only and requires its real code flow.

Credentials are generated independently and stored only in the private, Git-ignored
`data/catalog-presentation/accounts.json` and `accounts.html`. On Windows, the directory ACL
is restricted to the current user and SYSTEM. Open `accounts.html` locally; never share it.
The application cannot serve these files. Neither CLI output nor logs include passwords.

The dedicated server rejects non-loopback sockets, foreign Host headers and forwarded/proxy
headers before serving any route. Do not tunnel or proxy it. Fixture login requires an internal
server capability, a marked isolated database and a matching provisioning audit; environment
variables or public requests cannot enable it. Fixture sessions and catalog entries are denied
when the database is opened without that capability. Payments/tracking are explicitly simulated;
mail is captured in the private local inbox. Gmail, PayMongo and POS credentials are not loaded.

Re-provisioning skips existing stores/products, never resets passwords or changed stock, and
never copies any database. Initial activation and catalog import each take verified WAL-safe
snapshots. `--serve` alone starts existing records without importing or resetting them.
