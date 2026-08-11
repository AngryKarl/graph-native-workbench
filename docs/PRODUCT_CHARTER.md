# Product Charter

## Mission

Build the open-source foundation that lets organizations turn an SOP, a set of
roles, tools, knowledge sources, quality rules and deliverables into a governed,
executable and inspectable work graph.

## Primary users

The first creator is a developer or solution architect who authors an Industry
Pack. The first consumer is an operations or domain team that installs the Pack,
supplies real material, reviews important decisions and reuses the outputs.

## Core promise

Given a goal and a Pack, the Workbench can:

1. compile a valid work graph;
2. run deterministic steps, agent loops and human gates together;
3. expose progress, failure, cost and approval as serializable events that a
   persistence adapter can store;
4. turn outputs into versioned artifacts with evidence and provenance;
5. feed confirmed artifacts back into the organizational context graph.

## Non-goals

- A generic whiteboard whose primary value is drawing connections.
- A replacement for LangGraph, Temporal or every Agent SDK.
- A universal project-management, chat or file-storage suite.
- A system that turns every task into a multi-agent graph.
- A graph-database product. Storage engines are adapters, not the product model.

## Success test

A new user should be able to install the project, run a useful graph without a
model key, inspect why every node ran, pause at a human gate, resume, and obtain
a traceable artifact.

An Industry Pack should be independently installable and should contain enough
ontology, workflow and evaluation material to produce a useful domain-specific
experience without modifying the kernel.

## First reference Packs

1. Professional Software Delivery: governed issue-to-release work with parallel
   verification, independent approvals, deployment observation and rollback.
2. Data and MLOps Asset Release: governed partition quality, lineage, registry
   publication, bounded backfill and post-release recovery.
3. Cybersecurity Incident Response: attributable evidence, incident declaration,
   approved containment, verified recovery and post-incident improvement.
4. Evidence Research: a cross-industry demonstration of parallel research,
   synthesis, independent verification, approval and publication.
5. Architecture: the first deep vertical Pack for requirements, evidence,
   design decisions, review and deliverable production.
6. Customer Success Renewal: an enterprise operating workflow for attributable
   account evidence, renewal-risk decisions, owned interventions and approval.
