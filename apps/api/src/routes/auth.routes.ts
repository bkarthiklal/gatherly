import { loginSchema, registerSchema } from '@gatherly/types';
import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit, refreshRateLimit } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';

export const authRouter: Router = Router();

authRouter.post('/register', authRateLimit, validate(registerSchema), auth.register);
authRouter.post('/login', authRateLimit, validate(loginSchema), auth.login);
authRouter.post('/refresh', refreshRateLimit, auth.refresh);
authRouter.post('/logout', auth.logout);
authRouter.post('/logout-all', requireAuth, auth.logoutEverywhere);
authRouter.get('/me', requireAuth, auth.me);
