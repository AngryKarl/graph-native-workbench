# Reference deployment

The reference deployment runs the local Workbench, PostgreSQL persistence and a
durable Research Pack worker with Docker Compose. It is a reproducible starting
point for a private environment, not a hosted multi-tenant control plane.

```bash
cp deploy/.env.example deploy/.env
# replace both passwords/tokens with separate long random values
docker compose --env-file deploy/.env -f deploy/compose.yml up --build -d
```

Open `http://127.0.0.1:4311`. The browser prompts for HTTP Basic authentication;
use any username and `GRAPHWORK_AUTH_TOKEN` as the password. The port remains
bound to loopback by default. Put an HTTPS reverse proxy in front before exposing
it to a network because Basic credentials must not cross an unencrypted network.

The server rejects non-loopback listeners unless `GRAPH_WORKBENCH_AUTH_TOKEN`
contains at least 32 characters. It also rejects cross-origin requests and Host
headers that do not belong to a loopback listener. API clients may send the same
token as `Authorization: Bearer <token>`.

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
- Installed third-party Pack code uses the container adapter with `network=none`
  by default. Keep that boundary; the explicit `--unsafe-process-isolation`
  escape hatch is only for reviewed development fixtures.
- Export logs and audit bundles to the organization's observability and evidence
  retention systems.

The Compose file does not claim high availability. Its purpose is to keep the
container image, health endpoint, database schema and multi-process execution
path continuously reproducible.
