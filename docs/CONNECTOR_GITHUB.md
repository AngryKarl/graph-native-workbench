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
| `GRAPH_WORKBENCH_GITHUB_WEBHOOK_SECRET` | no | When set, every `/hooks` delivery must carry a valid `X-Hub-Signature-256`. |

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

## Webhook ingress: the build, not the issue

The Software Delivery graph accepts a delivery request at:

```text
POST /hooks/software-delivery/delivery-request
```

**Why this is not driven by `issues.opened`.** The graph requires ten fields
before it will start, two of which — `artifact_digest` and `release_version` —
do not exist when an issue is opened. Triggering on issue creation would mean
inventing them, and the release record produced at the end would then cite an
artifact digest that never identified anything. The whole point of the record is
that it is checkable, so the ingress is the job that *produced* the artifact.

A request missing any required field is refused at ingress with `400` rather
than starting a run that cannot produce a valid record.

### Posting from GitHub Actions

```yaml
- name: Request governed release
  env:
    WORKBENCH_URL: ${{ secrets.WORKBENCH_URL }}
    WEBHOOK_SECRET: ${{ secrets.GRAPH_WORKBENCH_WEBHOOK_SECRET }}
  run: |
    payload=$(jq -nc \
      --arg issue "${{ github.repository }}#${{ github.event.number }}" \
      --arg title "${{ github.event.pull_request.title }}" \
      --arg repo "${{ github.repository }}" \
      --arg base "${{ github.event.pull_request.base.ref }}" \
      --arg version "${{ steps.build.outputs.version }}" \
      --arg digest "${{ steps.build.outputs.digest }}" \
      '{issue_id:$issue, title:$title, repository:$repo, base_ref:$base,
        target_environment:"production", release_version:$version,
        artifact_digest:$digest, acceptance_criteria:[], affected_components:[],
        risk_flags:[]}')
    signature="sha256=$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')"
    curl -sSf "$WORKBENCH_URL/hooks/software-delivery/delivery-request" \
      -H 'content-type: application/json' \
      -H "x-hub-signature-256: $signature" \
      -H "idempotency-key: ${{ github.sha }}" \
      -d "$payload"
```

Using the commit SHA as the `Idempotency-Key` makes a re-run of the workflow
resolve to the same governed run rather than opening a second one.

### Signature verification

Set `GRAPH_WORKBENCH_GITHUB_WEBHOOK_SECRET` on the Workbench and every `/hooks`
delivery must carry a matching `X-Hub-Signature-256`, or it is rejected with
`401` before reaching a graph. Verification runs over the exact received bytes:
parsing and re-serializing JSON changes key order and whitespace, so the digest
would never match a round-tripped copy. `tests/connector-github.test.ts` asserts
that property directly.

With the variable unset, `/hooks` stays open — appropriate for a loopback
Workbench, not for an internet-facing one. Combine it with
`GRAPH_WORKBENCH_AUTH_TOKEN`, which any non-loopback listener already requires.

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

## Verified identity and code ownership

Without a connector the acting identity is whatever the operator picked from a
list, so an approval records a claim. When the connector is configured the
Workbench asks GitHub who the token belongs to (`GET /user`), binds the
workspace to that account, and locks the identity selector. Approvals then carry
a login GitHub confirmed.

**What this does not do.** It authenticates the *token holder*, not every person
who can reach the Workbench. A shared or internet-facing deployment still needs
per-user authentication in front of it, and a workspace owner can still resolve
any checkpoint. Multi-user sign-in remains open work.

### Code ownership

`resolveReviewAuthority` answers whether GitHub would ask a given login to
review a given pull request. It reads CODEOWNERS from the first of
`.github/CODEOWNERS`, `CODEOWNERS` or `docs/CODEOWNERS`, lists the paths the
pull request touches, and resolves ownership with GitHub's own precedence:

- **within one path, the last matching rule wins** — a later, more specific line
  is meant to override an earlier catch-all, so treating the matches as a union
  would grant authority GitHub never would;
- **across the changed paths, owners are unioned** — a change that reaches two
  owned areas concerns both owners.

A login can approve the change alone only when it owns *every* changed path.
Owning part of a change is not enough: GitHub would still require the other
owners, so accepting a partial owner would release code nobody responsible had
seen.

Two cases are reported rather than silently denied:

- a path no rule claims, which means the change has no declared owner;
- a team owner such as `@acme/platform`, whose membership CODEOWNERS does not
  expose. Claiming a login is authorised when membership was never checked is
  the failure that matters, so the team is named instead.

The supported pattern subset is `*` within a segment, `**` across segments, a
leading `/` to anchor at the repository root, a trailing `/` for everything
beneath a directory, and unanchored patterns matching at any depth.

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
