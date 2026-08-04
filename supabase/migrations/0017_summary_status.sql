-- 0017 — Server-owned summary generation status.
--
-- Summary generation used to be a client-side await: the Recorder POSTed
-- /summary and sat on the response, so navigating away orphaned the run and
-- the meeting never got notes. Generation now runs server-side after the
-- response (Next's after()), and these columns are how the client observes
-- it: 'generating' while the job runs, null when idle/done (the summary
-- column itself says whether one exists), 'error' + summary_error on failure.

alter table meetings add column if not exists summary_status text;
alter table meetings add column if not exists summary_error text;
