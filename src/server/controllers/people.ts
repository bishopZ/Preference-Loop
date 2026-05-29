import { Request, Response } from 'express';
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
      const result = await query(sql, [id as string]);
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
        (name as string).trim(),
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
