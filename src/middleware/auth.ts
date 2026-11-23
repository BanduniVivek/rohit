import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreatePortalUser, PortalRole } from '../modules/identity/identity.service.ts';

export interface AuthUserContext {
  id: string;
  uid: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  status: string;
}

export interface AuthRequest extends Request {
  firebaseUser?: DecodedIdToken;
  authUser?: AuthUserContext;
}

function parsePortalHeader(raw: unknown): PortalRole {
  const val = String(raw || '').toUpperCase();
  if (val === 'DRIVER') return 'DRIVER';
  if (val === 'ADMIN') return 'ADMIN';
  return 'RIDER';
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing bearer token' });
  }

  const token = authHeader.split('Bearer ')[1];
  const portal = parsePortalHeader(req.headers['x-app-portal']);

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.firebaseUser = decoded;

    const dbUser = await getOrCreatePortalUser({
      firebaseUid: decoded.uid,
      email: decoded.email || `${decoded.uid}@metroride.local`,
      name: decoded.name || decoded.email?.split('@')[0] || 'Commuter',
      portal,
    });

    if (dbUser.status === 'BLOCKED') {
      return res.status(403).json({ error: 'Account suspended. Contact city operations support.' });
    }

    req.authUser = dbUser;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      return res.status(403).json({ error: `Forbidden: requires role ${allowedRoles.join(' or ')}` });
    }
    next();
  };
};
