import { Router } from 'express';
import { PEOPLE_PATHS } from '../config/constants';
import {
  postSignal,
  getPeopleAdmin,
  createPerson,
  updatePerson,
  deletePerson,
} from '../controllers/people';
import { signalRateLimiter } from '../middleware/people-rate-limit';
import { ensureAuthenticated, ensureAuthenticatedApi } from '../middleware/auth';

const router = Router();

// Public write path — rate-limited
router.post(PEOPLE_PATHS.SIGNAL, signalRateLimiter, postSignal);

// Admin read — requires authentication
router.get(PEOPLE_PATHS.ADMIN_LIST, ensureAuthenticated, getPeopleAdmin);

// Admin writes — require authentication; 401 JSON when unauthenticated (NFR-04)
router.post(PEOPLE_PATHS.ADMIN_LIST, ensureAuthenticatedApi, createPerson);
router.put(PEOPLE_PATHS.ADMIN_PERSON, ensureAuthenticatedApi, updatePerson);
router.delete(PEOPLE_PATHS.ADMIN_PERSON, ensureAuthenticatedApi, deletePerson);

export default router;
