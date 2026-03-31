create extension if not exists vector;

create table if not exists departments (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    employee_code text unique,
    full_name text not null,
    email text not null unique,
    role text not null,
    preferred_language text not null default 'en',
    department_id uuid references departments(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    code text unique,
    title text not null,
    document_type text not null,
    department_name text,
    source_filename text not null,
    sharepoint_url text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists document_revisions (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references documents(id) on delete cascade,
    revision_label text,
    version_number integer not null default 1,
    effective_from timestamptz,
    effective_to timestamptz,
    approval_status text,
    is_latest_approved boolean not null default false,
    file_path text,
    page_count integer,
    extraction_classification text,
    extraction_status text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists extraction_runs (
    id uuid primary key default gen_random_uuid(),
    source_directory text not null,
    output_directory text not null,
    document_count integer not null default 0,
    successful_docling_runs integer not null default 0,
    failed_docling_runs integer not null default 0,
    started_at timestamptz not null default now(),
    completed_at timestamptz
);

create table if not exists extracted_pages (
    id uuid primary key default gen_random_uuid(),
    revision_id uuid not null references document_revisions(id) on delete cascade,
    page_number integer not null,
    classification text not null,
    extracted_text_chars integer not null default 0,
    raw_text text,
    markdown_path text,
    image_path text,
    ocr_used boolean not null default false,
    ocr_confidence double precision,
    created_at timestamptz not null default now()
);

create table if not exists extracted_blocks (
    id uuid primary key default gen_random_uuid(),
    page_id uuid not null references extracted_pages(id) on delete cascade,
    block_type text not null default 'unknown',
    section_title text,
    text text not null,
    bbox_left double precision,
    bbox_top double precision,
    bbox_right double precision,
    bbox_bottom double precision,
    confidence double precision,
    reading_order integer,
    created_at timestamptz not null default now()
);

create table if not exists document_chunks (
    id uuid primary key default gen_random_uuid(),
    revision_id uuid not null references document_revisions(id) on delete cascade,
    chunk_index integer not null,
    chunk_type text not null,
    page_start integer,
    page_end integer,
    section_title text,
    citation_label text,
    content text not null,
    equipment_tags jsonb not null default '[]'::jsonb,
    safety_flags jsonb not null default '[]'::jsonb,
    block_ids jsonb not null default '[]'::jsonb,
    embedding vector(384),
    created_at timestamptz not null default now()
);

create index if not exists idx_document_chunks_revision on document_chunks(revision_id);
create index if not exists idx_document_chunks_chunk_type on document_chunks(chunk_type);

create table if not exists training_modules (
    id uuid primary key default gen_random_uuid(),
    source_document_id uuid references documents(id),
    source_revision_id uuid references document_revisions(id),
    title text not null,
    description text,
    language text not null default 'en',
    module_type text not null default 'mandatory',
    criticality text not null default 'normal',
    validity_days integer,
    total_steps integer not null default 0,
    is_published boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists training_steps (
    id uuid primary key default gen_random_uuid(),
    module_id uuid not null references training_modules(id) on delete cascade,
    step_number integer not null,
    title text not null,
    instruction text not null,
    voice_prompt text,
    operator_check text,
    source_chunk_id uuid references document_chunks(id),
    created_at timestamptz not null default now()
);

create table if not exists training_assignments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    module_id uuid not null references training_modules(id) on delete cascade,
    is_mandatory boolean not null default true,
    due_at timestamptz,
    status text not null default 'assigned',
    progress_percent double precision not null default 0,
    current_step integer,
    started_at timestamptz,
    completed_at timestamptz,
    last_activity_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists assessments (
    id uuid primary key default gen_random_uuid(),
    module_id uuid not null references training_modules(id) on delete cascade,
    title text not null,
    passing_score double precision not null default 80,
    time_limit_seconds integer,
    certification_label text,
    created_at timestamptz not null default now()
);

create table if not exists assessment_questions (
    id uuid primary key default gen_random_uuid(),
    assessment_id uuid not null references assessments(id) on delete cascade,
    question_order integer not null,
    concept_tag text,
    question_text text not null,
    options jsonb not null,
    correct_option text not null,
    explanation text,
    source_chunk_id uuid references document_chunks(id),
    created_at timestamptz not null default now()
);

create table if not exists assessment_attempts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    assessment_id uuid not null references assessments(id) on delete cascade,
    attempt_number integer not null default 1,
    score double precision,
    status text not null default 'in_progress',
    started_at timestamptz,
    completed_at timestamptz,
    responses jsonb,
    created_at timestamptz not null default now()
);

create table if not exists certifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    module_id uuid not null references training_modules(id) on delete cascade,
    status text not null,
    issued_at timestamptz,
    expires_at timestamptz,
    last_attempt_id uuid references assessment_attempts(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists retrieval_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references users(id),
    query_text text not null,
    language text,
    role text,
    lexical_hits jsonb not null default '[]'::jsonb,
    semantic_hits jsonb not null default '[]'::jsonb,
    graph_hits jsonb not null default '[]'::jsonb,
    verifier_status text,
    confidence double precision,
    latest_revision_enforced boolean not null default true,
    latency_ms integer,
    created_at timestamptz not null default now()
);

create table if not exists feedback_events (
    id uuid primary key default gen_random_uuid(),
    retrieval_event_id uuid references retrieval_events(id) on delete cascade,
    user_id uuid references users(id),
    feedback_type text not null,
    comment text,
    created_at timestamptz not null default now()
);
