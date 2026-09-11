# Design: Private LLM Gateway Project Dossier

## 1. Boundary

This task produces a sanitized, evidence-backed interview dossier. It does not modify the application. Planning remains in the repository; generated interview material lives under:

```text
~/Documents/interview-prep/private-llm-gateway/
```

## 2. Evidence Model

Every non-trivial claim will carry one of these provenance classes during drafting:

- `Repo` — source, test, config, README, or design document.
- `Git` — commit history, author, date, or diff.
- `GitHub` — public repository/package snapshot with observation date.
- `User` — facts explicitly confirmed by the user.
- `Inference` — analysis derived from evidence; never presented as measured fact.

Final prose may omit repetitive labels, but an evidence ledger will retain the mapping. Unknown metrics remain unknown.

## 3. Analysis Layers

### 3.1 Repository inventory

Group files by responsibility rather than list every UI primitive individually:

- Reverse proxy entry and request routing.
- Scanner pipeline: secrets, contextual keys, PII, JSON masking, multipart, filenames, exclusions, mask tags.
- Policy engine and bypass rules.
- Proxy forwarding, SSE streaming, and mask disambiguation.
- Audit storage, logging, raw-value reveal, statistics, and SSE updates.
- Runtime and hot-reloadable configuration.
- Admin authentication, APIs, dashboard, rules, settings, i18n, and UI.
- Automated tests, mock upstream, Docker/Compose, CI build, and GHCR publishing.
- Public documentation, security guidance, design notes, and declared limitations.

### 3.2 Architecture reconstruction

Reconstruct the end-to-end request flow and control flow from public code:

```text
Client -> Next.js catch-all API -> request parsing/scanning -> policy decision
       -> block or mask/bypass -> upstream forwarding -> SSE/non-SSE response
       -> SQLite audit -> admin APIs/dashboard/SSE
```

Document trust boundaries, sensitive-data lifecycle, configuration flow, failure behavior, and operational constraints.

### 3.3 Evolution reconstruction

Use all 43 commits to build phases, not a raw commit dump. Each phase records the problem, decision, implementation area, and resulting capability. Commit hashes remain as evidence anchors.

### 3.4 Senior-role mapping

Map facts to capability dimensions without inventing management scope:

- AI infrastructure and provider compatibility.
- Privacy/security architecture and threat modeling.
- Streaming, latency, and compatibility trade-offs.
- Configurability, auditability, and operational design.
- Quality, deployment, CI/CD, and open-source delivery.
- Technical leadership through independent scope, decision, risk, and delivery governance.

People-management evidence will be marked unavailable for this project rather than fabricated.

## 4. Output Structure

```text
private-llm-gateway/
├── 00-evidence-ledger.md
├── 01-project-overview.md
├── 02-architecture-and-data-flow.md
├── 03-capabilities-and-boundaries.md
├── 04-evolution-and-decisions.md
├── 05-quality-security-and-operations.md
├── 06-contribution-and-leadership.md
├── 07-resume-material.md
├── 08-interview-narratives.md
├── 09-deep-dive-question-bank.md
├── 10-gaps-risks-and-next-actions.md
└── project-dossier-template.md
```

The evidence ledger is authoritative. Other documents optimize the same facts for different interview uses.

## 5. Content Contracts

- `00`: evidence source, path/commit/URL, date, supported claims, confidence.
- `01`: concise but complete project card and factual overview.
- `02`: components, data flow, trust boundaries, configuration flow, diagrams in Mermaid/text.
- `03`: complete feature inventory plus explicit non-goals and limitations.
- `04`: chronological phases and architectural decisions with commit anchors.
- `05`: tests, failure handling, security controls, deployment, CI/CD, observability, known gaps.
- `06`: independent ownership, architecture/management competency mapping, and honest limits.
- `07`: resume bullets at several detail levels; no fabricated metrics.
- `08`: 30-second, 2-minute, and deep-dive narratives plus STAR/CARE candidates.
- `09`: likely architecture, security, performance, product, and management follow-ups with evidence-based answers.
- `10`: missing adoption/performance evidence, risks, improvement roadmap, and optional validation work.
- Template: neutral structure reusable for later projects.

## 6. Safety and Quality Controls

- Run repository validation to distinguish documented intent from currently working behavior.
- Do not expose `.env`, credentials, local databases, raw audit values, or browser/session data.
- Quote public code only when necessary; prefer paths, symbols, and summarized behavior.
- Mark GHCR `111 downloads` as a dated package metric, not user adoption.
- Separate technical leadership from people management.
- Preserve limitations such as no upload-content parsing, OCR, PDF/Office parsing, or semantic name/address detection.

## 7. Compatibility and Rollback

No product code changes are planned. The generated directory can be deleted without affecting the repository. If a claim fails verification, remove or downgrade that claim in the evidence ledger and regenerate dependent prose.
