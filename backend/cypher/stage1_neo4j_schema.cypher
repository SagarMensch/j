CREATE CONSTRAINT document_id IF NOT EXISTS FOR (n:Document) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT document_revision_id IF NOT EXISTS FOR (n:DocumentRevision) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT equipment_id IF NOT EXISTS FOR (n:Equipment) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT subsystem_id IF NOT EXISTS FOR (n:Subsystem) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT procedure_id IF NOT EXISTS FOR (n:Procedure) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT procedure_step_id IF NOT EXISTS FOR (n:ProcedureStep) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT maintenance_task_id IF NOT EXISTS FOR (n:MaintenanceTask) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT alarm_id IF NOT EXISTS FOR (n:Alarm) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT interlock_id IF NOT EXISTS FOR (n:Interlock) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT instrument_tag_id IF NOT EXISTS FOR (n:InstrumentTag) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT safety_rule_id IF NOT EXISTS FOR (n:SafetyRule) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT ppe_id IF NOT EXISTS FOR (n:PPE) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT chemical_id IF NOT EXISTS FOR (n:Chemical) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT training_module_id IF NOT EXISTS FOR (n:TrainingModule) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT assessment_id IF NOT EXISTS FOR (n:Assessment) REQUIRE n.id IS UNIQUE;

MERGE (platform:Platform {name: 'Jubilant Ingrevia Stage 1'});

// Expected relationship patterns for ingestion:
// (:Document)-[:HAS_REVISION]->(:DocumentRevision)
// (:DocumentRevision)-[:DESCRIBES]->(:Equipment)
// (:Procedure)-[:APPLIES_TO]->(:Equipment)
// (:Procedure)-[:HAS_STEP]->(:ProcedureStep)
// (:ProcedureStep)-[:USES]->(:InstrumentTag)
// (:ProcedureStep)-[:REFERENCES]->(:Alarm)
// (:ProcedureStep)-[:REFERENCES]->(:Interlock)
// (:ProcedureStep)-[:REQUIRES]->(:PPE)
// (:ProcedureStep)-[:ENFORCES]->(:SafetyRule)
// (:MaintenanceTask)-[:APPLIES_TO]->(:Equipment)
// (:DocumentRevision)-[:SUPERSEDES]->(:DocumentRevision)
// (:TrainingModule)-[:DERIVES_FROM]->(:Procedure)
// (:Assessment)-[:TESTS]->(:TrainingModule)
