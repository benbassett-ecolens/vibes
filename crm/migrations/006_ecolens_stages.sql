-- Ecolens's real sales stages. Applied only when the default pipeline has no deals yet
-- (i.e. a fresh deployment); existing data is left alone and stages can be edited in Settings.
DO $$
DECLARE pid uuid;
BEGIN
  SELECT id INTO pid FROM pipelines ORDER BY is_default DESC, position LIMIT 1;
  IF pid IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM deals WHERE pipeline_id = pid) THEN RETURN; END IF;

  DELETE FROM stages WHERE pipeline_id = pid;
  INSERT INTO stages (pipeline_id, name, position, probability, kind, forecast_category, rot_after_days, color) VALUES
    (pid, 'Cold Prospect',     0, 5,   'open', 'omitted',   30,   '#8a8985'),
    (pid, 'Introduction Made', 1, 10,  'open', 'pipeline',  14,   '#6250d6'),
    (pid, 'Demo of Ecolens',   2, 30,  'open', 'pipeline',  14,   '#2a78d6'),
    (pid, 'Proposal',          3, 50,  'open', 'best_case', 21,   '#1baf7a'),
    (pid, 'Contract Sent',     4, 80,  'open', 'commit',    14,   '#eda100'),
    (pid, 'Closed Won',        5, 100, 'won',  'closed',    NULL, '#008300'),
    (pid, 'Closed Lost',       6, 0,   'lost', 'omitted',   NULL, '#e34948'),
    (pid, 'Deferred',          7, 10,  'open', 'omitted',   NULL, '#eb6834');
END $$;
