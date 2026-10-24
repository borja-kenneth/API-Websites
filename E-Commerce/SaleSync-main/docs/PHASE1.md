Phase 1 retains schema version 4. Existing account/store foreign keys, inventory ledger, shopping JSON, reservations, payments and item-aware refund tables support the current features; no new tables are required. Fulfillable quantities are derived from immutable purchased quantities minus recorded refund quantities. Dispatch rejects empty shipments. Historical prices and quantities remain unchanged.

Back up a running WAL database with:
node scripts/backup-database.cjs data/demo/salesync.sqlite checkpoints/UNIQUE-NAME.sqlite
Create the destination directory first. The command uses SQLite online backup, refuses an existing destination, and checks integrity and foreign keys. Back up uploads separately. To restore, stop the application and validate the snapshot in a separate directory; never overwrite newer live records casually. A failed backup is retained for diagnosis and must not be used.
