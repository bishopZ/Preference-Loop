import type { Request, Response } from 'express';
import { query } from '../db';

// Closed enum: only these event values are accepted.
type SignalEvent = 'shown' | 'trial' | 'positive';

const EVENT_TO_COLUMN: Record<SignalEvent, string> = {
  shown: 'shown_count',
  trial: 'trial_count',
  positive: 'positive_count',
};

const VALID_EVENTS = new Set<SignalEvent>(['shown', 'trial', 'positive']);

const isSignalEvent = (value: unknown): value is SignalEvent =>
  typeof value === 'string' && VALID_EVENTS.has(value as SignalEvent);

// Postgres error codes surfaced by the CRUD handlers.
const PG_UNIQUE_VIOLATION = '23505';
const PG_INVALID_TEXT_REPRESENTATION = '22P02'; // e.g. malformed UUID

const getPgErrorCode = (err: unknown): string | undefined =>
  (err as { code?: string }).code;

const PERSON_COLUMNS = `
  id,
  name,
  imdb_name_id,
  slug,
  wikipedia_article_title,
  wikipedia_page_url,
  wikipedia_image_url,
  shown_count,
  trial_count,
  positive_count,
  last_updated
`;

const SIGNAL_COUNT_COLUMNS = 'id, shown_count, trial_count, positive_count';

/** Validates an optional URL-ish text field: undefined, null, or non-empty string. */
const normalizeOptionalText = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return undefined; // signals invalid — callers treat non-null invalids as 400
};

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; status: number; error: string };
type Result<T> = Ok<T> | Err;

const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = (status: number, error: string): Err => ({ ok: false, status, error });

const sendResultError = (res: Response, result: Err): void => {
  res.status(result.status).json({ error: result.error });
};

// --- postSignal helpers ----------------------------------------------------

type SignalById = {
  mode: 'id';
  id: string;
  column: string;
};

type SignalByTitle = {
  mode: 'title';
  column: string;
  name: string;
  wikipediaArticleTitle: string | null;
  wikipediaPageUrl: unknown;
  wikipediaImageUrl: unknown;
};

type ParsedSignal = SignalById | SignalByTitle;

const parseSignalBody = (body: Record<string, unknown>): Result<ParsedSignal> => {
  const { id, wikipedia_article_title, name, wikipedia_page_url, wikipedia_image_url, event } =
    body;

  if (!isSignalEvent(event)) {
    return err(400, 'event must be "shown", "trial", or "positive"');
  }

  const column = EVENT_TO_COLUMN[event];
  const hasId = typeof id === 'string' && id.trim().length > 0;
  const hasTitle =
    typeof wikipedia_article_title === 'string' || typeof name === 'string';

  if (hasId && hasTitle) {
    return err(400, 'Provide either id or wikipedia fields, not both');
  }
  if (!hasId && !hasTitle) {
    return err(400, 'Must provide either id or wikipedia_article_title + name');
  }

  if (hasId) {
    return ok({ mode: 'id', id: id as string, column });
  }

  if (typeof name !== 'string' || name.trim().length === 0) {
    return err(400, 'name is required');
  }

  let wikipediaArticleTitle: string | null = null;
  if (typeof wikipedia_article_title === 'string') {
    const trimmed = wikipedia_article_title.trim();
    if (trimmed.length === 0) {
      return err(400, 'wikipedia_article_title cannot be empty');
    }
    wikipediaArticleTitle = trimmed;
  }

  return ok({
    mode: 'title',
    column,
    name: name.trim(),
    wikipediaArticleTitle,
    wikipediaPageUrl: wikipedia_page_url,
    wikipediaImageUrl: wikipedia_image_url,
  });
};

const incrementSignalById = async (id: string, column: string) => {
  const sql = `
    UPDATE people
    SET ${column} = ${column} + 1,
        last_updated = now()
    WHERE id = $1
    RETURNING ${SIGNAL_COUNT_COLUMNS}
  `;
  return query(sql, [id]);
};

const upsertSignalByTitle = async (input: SignalByTitle) => {
  const sql = `
    INSERT INTO people (
      wikipedia_article_title,
      name,
      wikipedia_page_url,
      wikipedia_image_url,
      ${input.column},
      last_updated
    )
    VALUES ($1, $2, $3, $4, 1, now())
    ON CONFLICT (wikipedia_article_title)
    DO UPDATE SET
      ${input.column} = people.${input.column} + 1,
      last_updated = now()
    RETURNING ${SIGNAL_COUNT_COLUMNS}
  `;
  return query(sql, [
    input.wikipediaArticleTitle,
    input.name,
    input.wikipediaPageUrl ?? null,
    input.wikipediaImageUrl ?? null,
  ]);
};

/**
 * POST /api/people/signal
 *
 * Two request shapes:
 *   1. Update by UUID:  { id, event }
 *   2. Upsert by title: { wikipedia_article_title, name, wikipedia_page_url?,
 *                         wikipedia_image_url?, event }
 *
 * Returns: { id, shown_count, trial_count, positive_count }
 */
export const postSignal = async (req: Request, res: Response): Promise<void> => {
  const parsed = parseSignalBody(req.body as Record<string, unknown>);
  if (!parsed.ok) {
    sendResultError(res, parsed);
    return;
  }

  try {
    if (parsed.value.mode === 'id') {
      const result = await incrementSignalById(parsed.value.id, parsed.value.column);
      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Person not found' });
        return;
      }
      res.json(result.rows[0]);
      return;
    }

    const result = await upsertSignalByTitle(parsed.value);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('postSignal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- updatePerson helpers --------------------------------------------------

type PersonUpdateSets = {
  sets: string[];
  values: unknown[];
};

const addPersonUpdateField = (
  sets: string[],
  values: unknown[],
  column: string,
  value: unknown
): void => {
  values.push(value);
  sets.push(`${column} = $${String(values.length)}`);
};

const parseNameUpdate = (
  body: Record<string, unknown>,
  sets: string[],
  values: unknown[]
): Result<void> => {
  if (!('name' in body)) return ok(undefined);
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return err(400, 'name must be a non-empty string');
  }
  addPersonUpdateField(sets, values, 'name', body.name.trim());
  return ok(undefined);
};

const parseWikipediaTitleUpdate = (
  body: Record<string, unknown>,
  sets: string[],
  values: unknown[]
): Result<void> => {
  if (!('wikipedia_article_title' in body)) return ok(undefined);

  const title = body.wikipedia_article_title;
  if (title === null) {
    addPersonUpdateField(sets, values, 'wikipedia_article_title', null);
    return ok(undefined);
  }
  if (typeof title === 'string' && title.trim().length > 0) {
    addPersonUpdateField(sets, values, 'wikipedia_article_title', title.trim());
    return ok(undefined);
  }
  return err(400, 'wikipedia_article_title must be a non-empty string or null');
};

const OPTIONAL_UPDATE_FIELDS = [
  'imdb_name_id',
  'slug',
  'wikipedia_page_url',
  'wikipedia_image_url',
] as const;

const parseOptionalFieldUpdates = (
  body: Record<string, unknown>,
  sets: string[],
  values: unknown[]
): Result<void> => {
  for (const field of OPTIONAL_UPDATE_FIELDS) {
    if (!(field in body)) continue;
    const normalized = normalizeOptionalText(body[field]);
    if (normalized === undefined && body[field] !== null) {
      return err(400, `${field} must be a non-empty string or null`);
    }
    addPersonUpdateField(sets, values, field, normalized ?? null);
  }
  return ok(undefined);
};

const buildPersonUpdate = (body: Record<string, unknown>): Result<PersonUpdateSets> => {
  const sets: string[] = [];
  const values: unknown[] = [];

  const nameResult = parseNameUpdate(body, sets, values);
  if (!nameResult.ok) return nameResult;

  const titleResult = parseWikipediaTitleUpdate(body, sets, values);
  if (!titleResult.ok) return titleResult;

  const optionalResult = parseOptionalFieldUpdates(body, sets, values);
  if (!optionalResult.ok) return optionalResult;

  if (sets.length === 0) {
    return err(400, 'No updatable fields provided');
  }

  return ok({ sets, values });
};

const executePersonUpdate = async (id: string, update: PersonUpdateSets) => {
  const values = [...update.values, id];
  const sql = `
    UPDATE people
    SET ${update.sets.join(', ')},
        last_updated = now()
    WHERE id = $${String(values.length)}
    RETURNING ${PERSON_COLUMNS}
  `;
  return query(sql, values);
};

const sendUpdatePersonDbError = (res: Response, error: unknown): void => {
  const code = getPgErrorCode(error);
  if (code === PG_INVALID_TEXT_REPRESENTATION) {
    res.status(400).json({ error: 'id must be a valid UUID' });
    return;
  }
  if (code === PG_UNIQUE_VIOLATION) {
    res.status(409).json({ error: 'A person with that unique field already exists' });
    return;
  }
  console.error('updatePerson error:', error);
  res.status(500).json({ error: 'Internal server error' });
};

/**
 * GET /api/people/random
 *
 * Returns one eligible person (wikipedia_article_title IS NOT NULL),
 * fairness-weighted toward lower shown_count (F-11). 404 when the
 * eligible pool is empty. Public — no auth, no rate limiter (NFR-05/06).
 */
export const getRandomPerson = async (_req: Request, res: Response): Promise<void> => {
  try {
    const sql = `
      SELECT ${PERSON_COLUMNS}
      FROM people
      WHERE wikipedia_article_title IS NOT NULL
      ORDER BY (1.0 / (shown_count + 1)) * random() DESC
      LIMIT 1
    `;
    const result = await query(sql);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'No eligible people yet' });
      return;
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('getRandomPerson error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/admin/people
 *
 * Creates a person. Body: { name (required), imdb_name_id?, slug?,
 * wikipedia_article_title?, wikipedia_page_url?, wikipedia_image_url? }.
 * Returns 201 with the full person row. Requires ensureAuthenticatedApi.
 */
export const createPerson = async (req: Request, res: Response): Promise<void> => {
  const {
    name,
    imdb_name_id,
    slug,
    wikipedia_article_title,
    wikipedia_page_url,
    wikipedia_image_url,
  } = req.body as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  let normalizedTitle: string | null = null;
  if (wikipedia_article_title !== undefined && wikipedia_article_title !== null) {
    if (
      typeof wikipedia_article_title !== 'string' ||
      wikipedia_article_title.trim().length === 0
    ) {
      res
        .status(400)
        .json({ error: 'wikipedia_article_title must be a non-empty string when provided' });
      return;
    }
    normalizedTitle = wikipedia_article_title.trim();
  }

  const imdbNameId = normalizeOptionalText(imdb_name_id) ?? null;
  const slugValue = normalizeOptionalText(slug) ?? null;
  const pageUrl = normalizeOptionalText(wikipedia_page_url) ?? null;
  const imageUrl = normalizeOptionalText(wikipedia_image_url) ?? null;

  try {
    const sql = `
      INSERT INTO people (
        name,
        imdb_name_id,
        slug,
        wikipedia_article_title,
        wikipedia_page_url,
        wikipedia_image_url,
        last_updated
      )
      VALUES ($1, $2, $3, $4, $5, $6, now())
      RETURNING ${PERSON_COLUMNS}
    `;
    const result = await query(sql, [
      name.trim(),
      imdbNameId,
      slugValue,
      normalizedTitle,
      pageUrl,
      imageUrl,
    ]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (getPgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      res
        .status(409)
        .json({ error: 'A person with that unique field already exists' });
      return;
    }
    console.error('createPerson error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PUT /api/admin/people/:id
 *
 * Partial update. Updatable fields: name, imdb_name_id, slug,
 * wikipedia_article_title (null clears eligibility), wikipedia_page_url,
 * wikipedia_image_url.
 * Returns 200 with the full updated row. Requires ensureAuthenticatedApi.
 */
export const updatePerson = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const parsed = buildPersonUpdate(req.body as Record<string, unknown>);
  if (!parsed.ok) {
    sendResultError(res, parsed);
    return;
  }

  try {
    const result = await executePersonUpdate(id, parsed.value);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (error) {
    sendUpdatePersonDbError(res, error);
  }
};

/**
 * DELETE /api/admin/people/:id
 *
 * Returns 204 on success, 404 when the person does not exist.
 * Requires ensureAuthenticatedApi.
 */
export const deletePerson = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const result = await query('DELETE FROM people WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    if (getPgErrorCode(error) === PG_INVALID_TEXT_REPRESENTATION) {
      res.status(400).json({ error: 'id must be a valid UUID' });
      return;
    }
    console.error('deletePerson error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/admin/people
 *
 * Returns aggregate list (up to 200 rows, ordered by trial_count DESC).
 * Requires ensureAuthenticatedApi middleware on the route.
 */
export const getPeopleAdmin = async (_req: Request, res: Response): Promise<void> => {
  try {
    const sql = `
      SELECT
        id,
        name,
        imdb_name_id,
        slug,
        wikipedia_article_title,
        wikipedia_page_url,
        wikipedia_image_url,
        shown_count,
        trial_count,
        positive_count,
        positive_count::float / NULLIF(trial_count, 0) AS positive_rate,
        last_updated
      FROM people
      ORDER BY trial_count DESC
      LIMIT 200
    `;
    const result = await query(sql);
    res.json({ people: result.rows });
  } catch (error) {
    console.error('getPeopleAdmin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
