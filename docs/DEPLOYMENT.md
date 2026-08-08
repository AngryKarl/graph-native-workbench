# Reference deployment

The reference deployment runs the local Workbench, PostgreSQL persistence and a
durable Research Pack worker with Docker Compose. It is a reproducible starting
point for a private environment, not a hosted multi-tenant control plane.

```bash
cp deploy/.env.example deploy/.env
# replace POSTGRES_PASSWORD with a long URL-safe value
docker compose --env-file deploy/.env -f deploy/compose.yml up --build -d
```

Open `http://127.0.0.1:4311`. The port is bound to loopback by default because
the Workbench does not provide authentication or TLS. Put an authenticated HTTPS
reverse proxy in front before exposing it to a network.

Enqueue a run through the same image and database:

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml run --rm worker \
  pack enqueue research --set "goal=Review the operating model"
```

Inspect logs and stop the stack:

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml logs -f worker
docker compose --env-file deploy/.env -f deploy/compose.yml down
```

Named volumes preserve PostgreSQL and Workbench data. `down -v` deletes those
volumes and is intentionally not part of the normal shutdown path.

## Production boundary

- Use a managed PostgreSQL service with TLS, backups and least-privilege
  credentials; keep `GRAPHWORK_POSTGRES_URL` in a secret manager.
- Run multiple identical Worker replicas for capacity. pg-boss coordinates
  leases, heartbeats and retry recovery in PostgreSQL.
- Keep Registry signing keys outside the runtime. Mount only public trust keys.
- Use the container Pack adapter for untrusted installed Pack code and keep its
  network at `none` unless a reviewed Pack explicitly requires an approved
  network.
- Export logs and audit bundles to the organization's observability and evidence
  retention systems.

The Compose file does not claim high availability. Its purpose is to keep the
container image, health endpoint, database schema and multi-process execution
path continuously reproducible.
