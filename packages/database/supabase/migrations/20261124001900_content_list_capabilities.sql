-- FlightDeck content workspace, stage 2c (ADR-015): fd_content_list also says what the caller may DO, because the single
-- "role" (admin > reviewer > author) hides that someone can hold two roles. canWrite = author or admin; canReview = reviewer or admin.
-- Same signature and visibility rules as before; only two keys are added. Grants are unchanged (create or replace keeps them).
create or replace function public.fd_content_list(p_actor uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_role text := app_private.content_role(p_actor);
begin
  if v_role is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'role', v_role,
    'canWrite', app_private.content_has_role(p_actor, 'author') or app_private.content_has_role(p_actor, 'admin'),
    'canReview', app_private.content_has_role(p_actor, 'reviewer') or app_private.content_has_role(p_actor, 'admin'),
    'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'slug', i.slug, 'revision', i.revision, 'status', i.status, 'track', i.track, 'code', i.code, 'title', i.title,
             'level', i.level, 'authorId', i.author_id, 'reviewerId', i.reviewer_id, 'changeNote', i.change_note,
             'reviewNote', i.review_note, 'liveSynced', i.live_synced, 'updatedAt', i.updated_at,
             'submittedAt', i.submitted_at, 'publishedAt', i.published_at,
             'mine', i.author_id is not distinct from p_actor)
           order by i.code, i.revision desc)
      from app_private.content_items i
     where v_role in ('admin', 'reviewer')
        or i.status = 'published'
        or i.author_id is not distinct from p_actor), '[]'::jsonb));
end;
$$;
