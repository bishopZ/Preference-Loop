import { Router } from 'express';
import { PEOPLE_PATHS } from '../config/constants';
import { postSignal, getPeopleAdmin } from '../controllers/people';
import { signalRateLimiter } from '../middleware/people-rate-limit';
import { ensureAuthenticated } from '../middleware/auth';

const router = Router();

// Public write path — rate-limited
router.post(PEOPLE_PATHS.SIGNAL, signalRateLimiter, postSignal);

// Admin read — requires authentication
router.get(PEOPLE_PATHS.ADMIN_LIST, ensureAuthenticated, getPeopleAdmin);

export default router;
