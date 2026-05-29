import { Router } from 'express';
import { API_PATHS } from '../config/constants';
import { getKey } from '../controllers/api';
import { ensureAuthenticated } from '../middleware/auth';
import peopleRoutes from './people';

const router = Router();

// API routes - all require authentication
router.get(API_PATHS.KEY, ensureAuthenticated, getKey);

// People / preference-signal routes (public signal write + admin read)
router.use(peopleRoutes);

export default router;

