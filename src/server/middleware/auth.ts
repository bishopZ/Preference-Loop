import type { RequestHandler, Request } from 'express';
import { ROUTES } from '../config/constants';
import { verifyToken, type JwtPayload } from '../services/jwt';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export const ensureAuthenticated: RequestHandler = (req, res, next) => {
  const token = req.cookies?.token as string | undefined;

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      (req as AuthenticatedRequest).user = payload;
      next();
      return undefined;
    }
  }

  res.redirect(ROUTES.LOGIN);
};

/**
 * API variant of ensureAuthenticated: responds 401 JSON instead of
 * redirecting to the login page. Use for JSON API endpoints (NFR-04).
 */
export const ensureAuthenticatedApi: RequestHandler = (req, res, next) => {
  const token = req.cookies?.token as string | undefined;

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      (req as AuthenticatedRequest).user = payload;
      next();
      return undefined;
    }
  }

  res.status(401).json({ error: 'Authentication required' });
};
