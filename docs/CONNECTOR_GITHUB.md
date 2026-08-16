# GitHub connector

The Professional Software Delivery Pack ships two interchangeable sets of tool
adapters behind the same Pack contract:

| Mode | When it is active | What the tools do |
| --- | --- | --- |
| Deterministic (default) | Always, unless the connector is configured | Return fixed reference values so the Pack runs without credentials |
| GitHub | `GITHUB_TOKEN` **and** `GRAPH_WORKBENCH_GITHUB_REPOSITORY` are both set | Call the GitHub REST API |

Switching modes changes no Pack contract, graph, role, policy or approval path.
The Pack declares what a tool means; the connector decides how it reaches a
real system.

## Configuration

```bash
export GITHUB_TOKEN=ghp_your_token
export GRAPH_WORKBENCH_GITHUB_REPOSITORY=acme/billing-api
npx graph-workbench
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `GITHUB_TOKEN` | yes | Fine-grained or classic token. Read-only scope is enough until writes are enabled. |
| `GRAPH_WORKBENCH_GITHUB_REPOSITORY` | yes | Target repository as `owner/repo`. Also the default for work items that do not name one. |
| `GRAPH_WORKBENCH_GITHUB_WRITE` | no | `true` allows command tools to change GitHub. Anything else keeps them in dry-run. |
| `GRAPH_WORKBENCH_GITHUB_API` | no | Base URL for GitHub Enterprise Server. |

### Two deliberate safety defaults

**A token alone does not activate the connector.** `GITHUB_TOKEN` is ambient on
many developer machines because the `gh` CLI and CI both export it. If that were
enough, the credential-free first run would silently start making live calls
against a repository the bundled fixture does not own. Naming the repository is
the explicit act that turns the connector on.

**Command tools describe rather than act until writes are enabled.** With the
connector on but `GRAPH_WORKBENCH_GITHUB_WRITE` unset, `change_request_upsert`
reports the pull request it *would* open (or the one that already exists), and
`deployment_execute` reports the deployment it *would* request. This lets a team
run the whole governed journey against a real repository and inspect every
decision before granting write access.

The Workbench reports the active mode in its bootstrap payload under
`connectors.github`, including the reason the connector is inactive.

## Tool mapping

| Pack tool | Risk | GitHub call |
| --- | --- | --- |
| `work_item_read` | read | `GET /repos/{owner}/{repo}/issues/{number}`, or issue-title search for an external tracker key |
| `repository_read` | read | `GET /repos/{owner}/{repo}/commits/{ref}` — returns the real commit SHA |
| `change_request_upsert` | write | `GET /pulls` to find an open request for the same head/base, then `PATCH` or `POST` |
| `deployment_execute` | external | `POST /repos/{owner}/{repo}/deployments` |
| `deployment_rollback` | external | `POST /repos/{owner}/{repo}/deployments/{id}/statuses` with state `inactive` |

### Work item identifiers

`work_item_read` accepts three forms:

- `acme/billing-api#42` — a specific issue in a specific repository;
- `42` or `#42` — that issue in the configured default repository;
- `PLAT-142` — an external tracker key, resolved by searching issue titles in
  the default repository. A key that matches nothing fails with a stated reason
  instead of returning an empty work item.

### Idempotency is real, not advisory

The Pack declares `idempotency: keyed` with an `idempotency_key` field, and the
runtime passes the validated key to the adapter. The connector does not simply
trust it: before creating a pull request it looks for an open one with the same
head and base, because that pull request already *is* this change whatever the
key says. A newly created request also carries the key as a marker in its body.

### Rollback has no native GitHub API

GitHub cannot revert a deployment. `deployment_rollback` marks the deployment
inactive, which is the accountable record; the deployment platform performs the
actual revert. The Pack keeps the rollback decision, its approver and its
evidence regardless of which system executes it.

## Failure behavior

Failures are classified so the graph's existing retry, escalation and
compensation paths react correctly rather than treating every error the same:

| Situation | Classification | Runtime behavior |
| --- | --- | --- |
| `401` bad credentials | `auth` | Fails immediately — a bad token is never retried, so a misconfigured run cannot burn the rate limit |
| `403` without rate-limit headers | `forbidden` | Fails immediately; this is a permission problem, not a wait |
| `403`/`429` with `x-ratelimit-remaining: 0` | `rate_limit` | Waits until `x-ratelimit-reset`, then retries |
| Rate-limit reset beyond the wait ceiling | `permanent` | Fails with the reset time stated, instead of blocking the run |
| `404` | `not_found` | Fails with the resource named |
| `5xx` or network error | `transient` | Retried with exponential backoff |

`retry-after` takes precedence over the reset header when GitHub sends it, which
is how secondary rate limits are signalled.

## Credential handling

The connector declares `requiredSecrets: ['GITHUB_TOKEN']`. The runtime resolves
exactly that name immediately before the call and passes it to the adapter only
(see [Runtime adapters](RUNTIME_ADAPTERS.md#secret-boundary)). The Workbench
narrows this further: it builds the secret provider from the names the active
Pack's own adapters declare, so a Pack cannot read an unrelated variable such as
`OPENAI_API_KEY`.

Tokens never enter graph state, runtime events, context objects or audit
bundles. `tests/secret-boundary.test.ts` asserts this rather than assuming it.

## Required token permissions

| Operation | Fine-grained permission |
| --- | --- |
| Read issues and search | Issues: read |
| Read commits | Contents: read |
| Create or update pull requests | Pull requests: read and write |
| Create deployments and statuses | Deployments: read and write |

Grant only what the workflow uses. Read-only access is enough to run the entire
journey in dry-run mode.
