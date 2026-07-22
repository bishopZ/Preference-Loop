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

function isSignalEvent(value: unknown): value is SignalEvent {
  return typeof value === 'string' && VALID_EVENTS.has(value as SignalEvent);
}

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
  const { id, wikipedia_article_title, name, wikipedia_page_url, wikipedia_image_url, event } =
    req.body as Record<string, unknown>;

  // Validate event
  if (!isSignalEvent(event)) {
    res.status(400).json({ error: 'event must be "shown", "trial", or "positive"' });
    return;
  }

  const column = EVENT_TO_COLUMN[event];

  // Must provide exactly one of: id OR (wikipedia_article_title + name)
  const hasId = typeof id === 'string' && id.trim().length > 0;
  const hasTitle =
    typeof wikipedia_article_title === 'string' ||
    typeof name === 'string';

  if (hasId && hasTitle) {
    res.status(400).json({ error: 'Provide either id or wikipedia fields, not both' });
    return;
  }

  if (!hasId && !hasTitle) {
    res.status(400).json({ error: 'Must provide either id or wikipedia_article_title + name' });
    return;
  }

  try {
    if (hasId) {
      // --- Update by UUID ---
      const sql = `
        UPDATE people
        SET ${column} = ${column} + 1,
            last_updated = now()
        WHERE id = $1
        RETURNING id, shown_count, trial_count, positive_count
      `;
      const result = await query(sql, [id]);
      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Person not found' });
        return;
      }
      res.json(result.rows[0]);
    } else {
      // --- Upsert by Wikipedia title ---
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      // Normalize title: trim, reject empty
      let normalizedTitle: string | null = null;
      if (typeof wikipedia_article_title === 'string') {
        const trimmed = wikipedia_article_title.trim();
        if (trimmed.length === 0) {
          res.status(400).json({ error: 'wikipedia_article_title cannot be empty' });
          return;
        }
        normalizedTitle = trimmed;
      }

      const sql = `
        INSERT INTO people (
          wikipedia_article_title,
          name,
          wikipedia_page_url,
          wikipedia_image_url,
          ${column},
          last_updated
        )
        VALUES ($1, $2, $3, $4, 1, now())
        ON CONFLICT (wikipedia_article_title)
        DO UPDATE SET
          ${column}    = people.${column} + 1,
          last_updated = now()
        RETURNING id, shown_count, trial_count, positive_count
      `;
      const result = await query(sql, [
        normalizedTitle,
        name.trim(),
        wikipedia_page_url ?? null,
        wikipedia_image_url ?? null,
      ]);
      res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('postSignal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/admin/people
 *
 * Returns aggregate list (up to 200 rows, ordered by trial_count DESC).
 * Requires ensureAuthenticated middleware on the route.
 */
// Postgres error codes surfaced by the CRUD handlers.
const PG_UNIQUE_VIOLATION = '23505';
const PG_INVALID_TEXT_REPRESENTATION = '22P02'; // e.g. malformed UUID

const getPgErrorCode = (err: unknown): string | undefined =>
  (err as { code?: string }).code;

const PERSON_COLUMNS = `
  id,
  name,
  wikipedia_article_title,
  wikipedia_page_url,
  wikipedia_image_url,
  shown_count,
  trial_count,
  positive_count,
  last_updated
`;

/** Validates an optional URL-ish text field: undefined, null, or non-empty string. */
const normalizeOptionalText = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return undefined; // signals invalid — callers treat non-null invalids as 400
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
  } catch (err) {
    console.error('getRandomPerson error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/admin/people
 *
 * Creates a person. Body: { name (required), wikipedia_article_title?,
 * wikipedia_page_url?, wikipedia_image_url? }.
 * Returns 201 with the full person row. Requires ensureAuthenticatedApi.
 */
export const createPerson = async (req: Request, res: Response): Promise<void> => {
  const { name, wikipedia_article_title, wikipedia_page_url, wikipedia_image_url } =
    req.body as Record<string, unknown>;

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

  const pageUrl = normalizeOptionalText(wikipedia_page_url) ?? null;
  const imageUrl = normalizeOptionalText(wikipedia_image_url) ?? null;

  try {
    const sql = `
      INSERT INTO people (
        name,
        wikipedia_article_title,
        wikipedia_page_url,
        wikipedia_image_url,
        last_updated
      )
      VALUES ($1, $2, $3, $4, now())
      RETURNING ${PERSON_COLUMNS}
    `;
    const result = await query(sql, [name.trim(), normalizedTitle, pageUrl, imageUrl]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (getPgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      res
        .status(409)
        .json({ error: 'A person with that wikipedia_article_title already exists' });
      return;
    }
    console.error('createPerson error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PUT /api/admin/people/:id
 *
 * Partial update. Updatable fields: name, wikipedia_article_title (null clears
 * eligibility), wikipedia_page_url, wikipedia_image_url.
 * Returns 200 with the full updated row. Requires ensureAuthenticatedApi.
 */
export const updatePerson = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;

  const sets: string[] = [];
  const values: unknown[] = [];
  const addSet = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${String(values.length)}`);
  };

  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      res.status(400).json({ error: 'name must be a non-empty string' });
      return;
    }
    addSet('name', body.name.trim());
  }

  if ('wikipedia_article_title' in body) {
    const title = body.wikipedia_article_title;
    if (title === null) {
      addSet('wikipedia_article_title', null);
    } else if (typeof title === 'string' && title.trim().length > 0) {
      addSet('wikipedia_article_title', title.trim());
    } else {
      res
        .status(400)
        .json({ error: 'wikipedia_article_title must be a non-empty string or null' });
      return;
    }
  }

  for (const field of ['wikipedia_page_url', 'wikipedia_image_url'] as const) {
    if (field in body) {
      const normalized = normalizeOptionalText(body[field]);
      if (normalized === undefined && body[field] !== null) {
        res.status(400).json({ error: `${field} must be a non-empty string or null` });
        return;
      }
      addSet(field, normalized ?? null);
    }
  }

  if (sets.length === 0) {
    res.status(400).json({ error: 'No updatable fields provided' });
    return;
  }

  try {
    values.push(id);
    const sql = `
      UPDATE people
      SET ${sets.join(', ')},
          last_updated = now()
      WHERE id = $${String(values.length)}
      RETURNING ${PERSON_COLUMNS}
    `;
    const result = await query(sql, values);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    const code = getPgErrorCode(err);
    if (code === PG_INVALID_TEXT_REPRESENTATION) {
      res.status(400).json({ error: 'id must be a valid UUID' });
      return;
    }
    if (code === PG_UNIQUE_VIOLATION) {
      res
        .status(409)
        .json({ error: 'A person with that wikipedia_article_title already exists' });
      return;
    }
    console.error('updatePerson error:', err);
    res.status(500).json({ error: 'Internal server error' });
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
  } catch (err) {
    if (getPgErrorCode(err) === PG_INVALID_TEXT_REPRESENTATION) {
      res.status(400).json({ error: 'id must be a valid UUID' });
      return;
    }
    console.error('deletePerson error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getPeopleAdmin = async (_req: Request, res: Response): Promise<void> => {
  try {
    const sql = `
      SELECT
        id,
        name,
        wikipedia_article_title,
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
  } catch (err) {
    console.error('getPeopleAdmin error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
