# Cybersecurity Incident Response Pack

This Pack governs the path from an attributable security signal to incident
declaration, approved containment, verified recovery and lessons learned. It
complements SIEM, EDR, identity, asset, forensic and response systems; it does
not replace their detection, evidence or technical-action authority.

The reference workflows include:

- typed signal ingress with a stable correlation key;
- bounded concurrent preservation of source evidence and immutable digests;
- explicit incident likelihood, severity, confidence and ATT&CK references;
- accountable incident-declaration, containment and recovery gates;
- parallel technical containment and stakeholder notification;
- post-incident findings and control improvements;
- recovery health events with visible escalation and rollback of a failed
  recovery change while containment remains active;
- typed context objects and relations for triage, incident and recovery runs.

Run every zero-key fixture:

```bash
pnpm graph-workbench pack test packs/cybersecurity-response/src/index.ts
```

Run the privileged credential compromise demo:

```bash
pnpm graph-workbench pack demo packs/cybersecurity-response/src/index.ts \
  --fixture privileged_credential_compromise
```

The bundled adapters are deterministic reference implementations. Production
teams connect their existing SIEM, EDR, asset inventory, identity provider,
forensic store, notification and containment platforms while keeping the Pack
contract, approval gates and context projection stable.

The lifecycle aligns with NIST SP 800-61 Rev. 3 and the operational phase
structure in the CISA Incident Response Playbook. MITRE ATT&CK identifiers are
portable classification references; this Pack does not copy or replace the
ATT&CK knowledge base.

References:

- [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final)
- [CISA Cybersecurity Incident and Vulnerability Response Playbooks](https://www.cisa.gov/topics/cybersecurity-best-practices/executive-order-improving-nations-cybersecurity)
- [MITRE ATT&CK Enterprise tactics](https://attack.mitre.org/tactics/enterprise/)
