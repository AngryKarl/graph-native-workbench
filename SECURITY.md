# Security Policy

## Supported versions

Before 1.0, only the latest commit on the default branch and the latest tagged
release receive security fixes.

## Third-party Industry Packs

`.gpack` artifacts can contain executable JavaScript handlers. Local installation
requires `--trust`, verifies the engine range and SHA-256 integrity, and the
Workbench rechecks installed files before execution. Signed Registry installation
also verifies an Ed25519 publisher signature, expiry and the signed artifact
identity, checksum, engine range and permissions.

Third-party handlers and context projectors execute in a restricted child
process without inherited application secrets and with filesystem, child-process,
memory and time limits. For network denial, the Docker/Podman adapter adds a
read-only, non-root, capability-dropped container with `network=none` by default.
Only install Packs whose publisher you trust; isolation reduces impact but does
not prove code safe. See the
[trust and isolation model](docs/TRUST_AND_ISOLATION.md) and the project
[threat model](docs/THREAT_MODEL.md).

## Registry signing keys

Publisher private keys must be stored only in an approved secret manager. The
reference publishing workflow reads `REGISTRY_ED25519_PRIVATE_KEY` from GitHub
Actions secrets, writes it only to an ephemeral runner directory, and never
uploads it. Rotate the key and publish a new trusted key id if private material
is exposed in logs, artifacts or a Pack repository. See the
[Registry publishing guide](docs/REGISTRY_PUBLISHING.md).

The npm release workflow keeps publication manual, performs a full package dry
run first, refuses version replacement and reads `NPM_TOKEN` only from GitHub
Actions secrets. Never place npm
tokens in repository files, Pack sources or workflow artifacts.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub Private
Vulnerability Reporting on the repository's Security tab. Include the affected
contract or adapter, reproduction steps, impact and any suggested mitigation.

If private reporting has not yet been enabled, contact a maintainer privately
through the contact method on their GitHub profile. We will acknowledge a report,
coordinate a fix and disclose it after affected users have a reasonable update
window. Do not include real customer data, credentials or proprietary Packs.
