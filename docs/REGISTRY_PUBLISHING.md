# Publishing a Pack Registry

Registry publishing has two separate inputs: a release definition containing
public Pack sources, and an Ed25519 private key held by the publisher. The
private key never belongs in the repository or a `.gpack` artifact.

## Release definition

[`registry/reference.json`](../registry/reference.json) is the release
definition for the Graphwork Reference Registry. Paths are relative to the
definition file. Each Pack may optionally override its Graphwork engine range
and declared permissions.

Build the same static bundle locally:

```bash
pnpm graphwork pack registry build registry/reference.json \
  --artifact-base-url https://packs.example.com/registry/ \
  --expires-in-days 30 \
  --output-dir registry-dist
```

This produces versioned `.gpack` files under `registry-dist/packs` and a
`registry-payload.json` whose URLs, checksums, compatibility ranges,
permissions and display metadata are derived from those artifacts. It does not
sign or publish anything.

## Publisher key setup

Create a dedicated Ed25519 key pair in an approved secrets environment:

```bash
openssl genpkey -algorithm Ed25519 -out registry-private.pem
openssl pkey -in registry-private.pem -pubout -out registry-public.pem
gh secret set REGISTRY_ED25519_PRIVATE_KEY < registry-private.pem
openssl pkey -pubin -in registry-public.pem -outform DER | openssl sha256
```

Back up or rotate the private key according to the publisher's key-management
policy. Distribute the public key and its fingerprint through a channel
independent of the Registry endpoint. A public key downloaded from the same
site as the signed Registry is convenient key material, but is not by itself a
trust root.

The reference workflow signs with key id `graphwork.reference.v1`. Changing
that id is a trust migration and requires consumers to configure the new public
key before the old catalog expires.

The current reference publisher key is committed at
[`registry/reference-public.pem`](../registry/reference-public.pem). Its SPKI
SHA-256 fingerprint is:

```text
668bf759e6d1c90e6a1e6104b4ec7149df2e693fc79c43ddce8a56992e893385
```

Consumers should verify this value through the source repository before adding
the key to `.graphwork/trust.json`. The Registry deployment publishes the same
public key beside the signed catalog so automated checks can detect a mismatch.

## GitHub Pages workflow

[`publish-registry.yml`](../.github/workflows/publish-registry.yml) runs the
following release gates on a manually selected commit:

1. install from the lockfile, type-check and run all tests;
2. build every configured Pack and the Registry payload;
3. sign with the repository secret and derive the matching public key;
4. verify the signed document using the public key;
5. generate checksums and retain the complete static bundle as an Actions
   artifact;
6. optionally deploy the verified bundle to GitHub Pages.

Run a non-publishing rehearsal first:

```bash
gh workflow run publish-registry.yml \
  -f expires_in_days=30 \
  -f publish=false
```

After inspecting the workflow artifact, enable GitHub Pages with **GitHub
Actions** as its source and deploy:

```bash
gh workflow run publish-registry.yml \
  -f expires_in_days=30 \
  -f publish=true
```

For this repository the resulting endpoint will be:

```text
https://angrykarl.github.io/graph-native-workbench/registry/registry.json
```

Do not advertise that endpoint while the repository or Pages site is private.
Catalogs have a mandatory expiry, so schedule or manually run a verified
refresh before the current document expires. Never rebuild and republish an
existing Pack version with different bytes; increment the Pack version instead.
