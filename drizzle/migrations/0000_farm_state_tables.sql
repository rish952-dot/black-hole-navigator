CREATE TABLE public.farm_runs (
  run_key text PRIMARY KEY CHECK (run_key ~ '^[A-Za-z0-9_-]{6,64}$'),
  seed int NOT NULL,
  mode text NOT NULL CHECK (mode IN ('DRY_RUN','SIMULATION','PAPER_MODE')),
  generation int NOT NULL DEFAULT 0 CHECK (generation >= 0),
  halted text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  health jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.farm_runs TO service_role;
ALTER TABLE public.farm_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX farm_runs_updated_idx ON public.farm_runs(updated_at DESC);

CREATE TABLE public.farm_generations (
  run_key text NOT NULL REFERENCES public.farm_runs(run_key) ON DELETE CASCADE,
  index int NOT NULL CHECK (index >= 0),
  record jsonb NOT NULL,
  metrics jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_key, index)
);
GRANT ALL ON public.farm_generations TO service_role;
ALTER TABLE public.farm_generations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.farm_ledger (
  id bigserial PRIMARY KEY,
  run_key text NOT NULL REFERENCES public.farm_runs(run_key) ON DELETE CASCADE,
  agent_id text NOT NULL,
  generation int NOT NULL,
  type text NOT NULL,
  amount numeric NOT NULL,
  description text NOT NULL DEFAULT '',
  ts timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.farm_ledger TO service_role;
GRANT USAGE ON SEQUENCE public.farm_ledger_id_seq TO service_role;
ALTER TABLE public.farm_ledger ENABLE ROW LEVEL SECURITY;
CREATE INDEX farm_ledger_run_idx ON public.farm_ledger(run_key, id DESC);