# Jubilant Ingrevia Plant Assistant: Comprehensive Cost Breakdown & Justification

This document provides a detailed item-by-item breakdown of the commercial pricing structure for the Jubilant Ingrevia Plant Assistant deployment. It is designed to equip leadership and commercial teams with a clear, defensible narrative to explain every component of the costs.

---

## 1. Executive Commercial Summary

The proposed model comprises a mix of foundational one-time investments and recurring operational costs. The total pricing is structured into three primary timeframes:

*   **One-Time Setup:** ₹ 24,00,000
*   **Year 1 Commercial Total:** ₹ 51,24,000 (Includes setup + annual licensing + query usage)
*   **Year 2+ Commercial (Recurring):** ₹ 29,64,000 (Includes annual licensing, query usage, and AMC)

> **Important:** The pricing is framed as a **governed operational intelligence platform**, rather than a generic AI chatbot. The costs reflect a tailored multi-plant rollout, strict role-based data governance, secure document grounding, and enterprise-grade support.

---

## 2. One-Time Setup Costs (₹ 24,00,000)

The setup fee represents the foundational engineering and deployment effort required to roll out the AI Assistant across 50 manufacturing plants.

### Platform & Infrastructure Setup
*   **Platform Deployment (₹ 3,50,000):** Establishes the multi-tenant architecture for 50 isolated plant workspaces. Ensures secure deployment, robust scaling, and secure access boundaries.
*   **Cloud Setup & Configuration (₹ 2,00,000):** Initial staging of the necessary environments. Covers network segmentation, access policy setup, deployment templates, and overall infrastructure readiness.

### Data & Access Engineering
*   **Document Ingestion & Vectorization (₹ 4,50,000):** Processing an estimated 1,000 documents (~20,000 pages). This includes secure extraction, text chunking, metadata indexing, AI embedding, retrieval configuration, and quality assurance.
*   **Role-Based Access Control (RBAC) (₹ 2,00,000):** Admin and standard-user control structures managed uniformly across plants. Guarantees auditability and strict data isolation so users only see permitted documents.
*   **Plant-Wise Configuration (₹ 2,50,000):** The overhead of customizing the agent per plant. Covers deploying branded workspaces, maintaining isolated data contexts, and adjusting plant-specific workflows.

### Enterprise Readiness
*   **Integration Layer (₹ 2,50,000):** Setting up connectivity to existing enterprise systems (Identity providers, ERP endpoints, webhooks) and ensuring API governance.
*   **Security & Compliance (₹ 1,50,000):** Implementation of encryption standards, audit logging systems, vulnerability testing, and ensuring strict enterprise deployment controls.
*   **Testing & QA (₹ 1,50,000):** Rigorous validation cycles including functional checks, system load testing, regression testing, and final production readiness sign-offs.

### Training & Handover
*   **Admin Training (₹ 1,50,000):** Structured, batch-wise training for plant administrators to ensure internal teams can independently manage the platform post go-live.
*   **User Documentation (₹ 1,00,000):** Creation of tailored operational manuals, admin guides, workflow aids, and adoption-support materials.
*   **Go-Live Support (₹ 1,50,000):** A dedicated two-week stabilization window post-launch, providing technical coverage during the critical early days of production.

---

## 3. Recurring Commercial Costs

Recurring costs cover user access, system consumption, and ongoing maintenance.

### Annual User Licensing (₹ 25,80,000)
To ensure absolute accountability and audit traceability within plant operations, we use a **named-user model**, not concurrent pricing. This means every action is mapped to a specific user history.
*   **Admin User Annual Fee:** ₹ 30,000
*   **Standard User Annual Fee:** ₹ 21,600
*   **Total Expected User Base:** 100 users across 50 plants.

### Annual Query Reference (₹ 1,44,000)
Query pricing is designed for transparency and is strictly usage-linked. A simple SOP search uses fewer computing resources than complex cross-document data synthesis.
*   **Included Package:** Standard Bundle (₹ 12,000 / month)
*   **Rationale:** Provides predictable cost scaling. Heavy analytical workloads are priced proportionally.

### Annual AMC & Support (₹ 2,40,000)
*   **Calculation Basis:** 10% of the total One-Time Setup cost.
*   **Coverage:** Routine maintenance, bug lifecycle management, operational tweaks, and system continuity.
*   **Commercial Defense:** A clean, fixed percentage is procurement-friendly and prevents reopening large budgetary negotiations yearly.

---

## 4. Cloud Infrastructure Reference (₹ 19,33,684 annually)

> **Note:** This figure should be treated as an **operational baseline** and handled separately from core product pricing. Presenting it separately ensures commercial transparency unless the client specifically requests bundled managed hosting.

This covers the pure AWS infrastructure needed to maintain a highly available (HA), secure, India-region deployment:
*   **Compute:** Supports application traffic, heavy ingestion throughput, and real-time document processing loads.
*   **Database & Storage:** Managed databases for operational logs, vector retrieval indices, the primary document repository, and scalable growth headroom.
*   **Networking & Security:** Costs for bandwidth, threat monitoring, secure VPNS, and observability toolsets.

---

## 5. Optional Expansions & Add-Ons

These modules are categorized by when they should be introduced in commercial discussions:

**Only discuss if specifically requested for phase 1:**
*   **Custom Model Fine-Tuning (₹ 4,50,000 one-time):** If they require domain-specialized LLM behavior beyond standard contextual retrieval.
*   **On-Premise Deployment (₹ 8,00,000 one-time + ₹ 3,00,000 annual support):** If data-residency/IT policies explicitly forbid cloud delivery.
*   **99.9% SLA Upgrade (₹ 2,00,000 annual):** If the client enforces aggressive, enterprise-high-availability uptime contracts.

**Discuss as Phase 2 expansion levers:**
*   **Multi-Language Support (₹ 2,00,000 one-time):** Excellent upsell when discussing wider adoption by plant floor operators.
*   **Advanced Analytics Dashboard (₹ 1,50,000 annual):** For leadership seeking cross-site intelligence and reporting.
*   **Messaging Channel Integration (₹ 1,50,000 one-time):** Integrating the bot into WhatsApp or internal comms software.
*   **Mobile App Package (₹ 3,50,000 one-time):** Dedicated iOS/Android native applications.
*   **Dedicated Account Manager (₹ 3,00,000 annual):** For heavy governance frameworks.

---

## 6. Key Negotiation Guardrails

When defending this pricing structure, adhere to the following principles:

1.  **Protect the Setup Fee:** Avoid heavy discounting on the ₹24L setup. This is where the core engineering, deployment accountability, and integration effort sit. 
2.  **Flexible Levers:** If procurement demands savings, concede via:
    *   Payment milestones.
    *   Using phased rollouts (e.g., scoping a smaller pilot of 10 plants first, lowering the Year 1 invoice).
    *   Adjusting the initial query bundle sizing.
3.  **Avoid Licensing Cuts:** Deeply discounting the named-user license fee sets a dangerous precedent and weakens long-term revenue discipline.
4.  **Emphasize ROI:** Frame the Year 1 deployment cost against the speed of multi-plant adoption, massive reduction in document search time, and cleaner audit readiness.
