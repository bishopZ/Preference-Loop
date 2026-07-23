import { API_PATHS } from './constants';
import { getCsrfToken } from './csrf';

/** Full person row as returned by the admin API. */
export interface Person {
  id: string;
  name: string;
  imdb_name_id: string | null;
  slug: string | null;
  wikipedia_article_title: string | null;
  wikipedia_page_url: string | null;
  wikipedia_image_url: string | null;
  shown_count: number;
  trial_count: number;
  positive_count: number;
  positive_rate?: number | null;
  last_updated: string;
}

/** Writable person fields (create and update payload). */
export interface PersonInput {
  name: string;
  imdb_name_id: string | null;
  slug: string | null;
  wikipedia_article_title: string | null;
  wikipedia_page_url: string | null;
  wikipedia_image_url: string | null;
}

/** Thrown when the server indicates the session is missing or expired. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'UnauthenticatedError';
  }
}

const jsonHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'x-csrf-token': getCsrfToken(),
});

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed (${String(response.status)})`;
  } catch {
    return `Request failed (${String(response.status)})`;
  }
};

const HTTP_UNAUTHORIZED = 401;

const assertOk = async (response: Response): Promise<void> => {
  if (response.status === HTTP_UNAUTHORIZED) throw new UnauthenticatedError();
  if (!response.ok) throw new Error(await readErrorMessage(response));
};

/**
 * Fetches the admin people list. The list endpoint answers HTML clients
 * with a redirect to /login when unauthenticated, so a followed redirect
 * is treated the same as a 401 (ADR-CLU-B1 header auth applies to writes).
 */
export const fetchAdminPeople = async (): Promise<Person[]> => {
  const response = await fetch(API_PATHS.ADMIN_PEOPLE);
  if (response.redirected) throw new UnauthenticatedError();
  await assertOk(response);
  const data = (await response.json()) as { people: Person[] };
  return data.people;
};

export const createPerson = async (input: PersonInput): Promise<Person> => {
  const response = await fetch(API_PATHS.ADMIN_PEOPLE, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  await assertOk(response);
  return (await response.json()) as Person;
};

export const updatePerson = async (id: string, input: PersonInput): Promise<Person> => {
  const response = await fetch(`${API_PATHS.ADMIN_PEOPLE}/${id}`, {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  await assertOk(response);
  return (await response.json()) as Person;
};

export const deletePerson = async (id: string): Promise<void> => {
  const response = await fetch(`${API_PATHS.ADMIN_PEOPLE}/${id}`, {
    method: 'DELETE',
    headers: { 'x-csrf-token': getCsrfToken() },
  });
  await assertOk(response);
};

/** Signal events the public voting loop can emit (F-06–F-08). */
export type SignalEvent = 'shown' | 'trial' | 'positive';

const HTTP_NOT_FOUND = 404;

/**
 * Fetches one fairness-weighted eligible person for the public voting loop.
 * Returns `null` when the eligible pool is empty (F-11 / F-12 empty state),
 * so callers can render the empty state instead of treating 404 as an error.
 */
export const fetchRandomPerson = async (): Promise<Person | null> => {
  const response = await fetch(API_PATHS.PEOPLE_RANDOM);
  if (response.status === HTTP_NOT_FOUND) return null;
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return (await response.json()) as Person;
};

/**
 * Fires a signal for a person by id. Public write path — CSRF is enforced
 * globally, so the double-submit token travels in the x-csrf-token header
 * (ADR-CLU-B1). The signal cookie is set on the preceding random GET.
 */
export const sendSignal = async (id: string, event: SignalEvent): Promise<void> => {
  const response = await fetch(API_PATHS.PEOPLE_SIGNAL, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ id, event }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));
};
