export const DEFAULT_PORT = '3000';

export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  ABOUT: '/about',
  POLICIES: '/policies',
  LOGOUT: '/logout',
  ADMIN_PEOPLE: '/admin/people',
  SITEMAP: '/sitemap.xml',
} as const;

export const API_PATHS = {
  LOGIN: '/login/password',
  LOGOUT: '/logout',
  SESSION: '/api/session',
  KEY: '/api/key',
} as const;

/** Path prefix for API routes (e.g. for error handling). */
export const API_PREFIX = '/api';

// encryption parameters
export const ITERATIONS = 100000;
export const KEY_LENGTH = 64;
export const DIGEST = 'sha512';

export const BASE = 10;

export const PEOPLE_PATHS = {
  SIGNAL: '/api/people/signal',
  RANDOM: '/api/people/random',
  SIGNAL_BATCH: '/api/people/signal/batch',
  PERSON_BY_ID: '/api/people/:id',
  ADMIN_LIST: '/api/admin/people',
  ADMIN_PERSON: '/api/admin/people/:id',
} as const;
