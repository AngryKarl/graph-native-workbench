# Security Policy

## Supported versions

Before 1.0, only the latest commit on the default branch and the latest tagged
release receive security fixes.

## Third-party Industry Packs

`.gpack` artifacts can contain executable JavaScript handlers. Installation
requires `--trust`, verifies the engine range and SHA-256 integrity, and the
Workbench rechecks installed files before importing them. These checks detect
damage or modification; they do not sandbox code or establish author identity.

Only install Packs whose source and publisher you trust. Run unknown Packs in a
separate OS account or container without credentials or access to sensitive
files. Signed publisher metadata and isolated Pack workers are planned but are
not part of format v1.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub Private
Vulnerability Reporting on the repository's Security tab. Include the affected
contract or adapter, reproduction steps, impact and any suggested mitigation.

If private reporting has not yet been enabled, contact a maintainer privately
through the contact method on their GitHub profile. We will acknowledge a report,
coordinate a fix and disclose it after affected users have a reasonable update
window. Do not include real customer data, credentials or proprietary Packs.
