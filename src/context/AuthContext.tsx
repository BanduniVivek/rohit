import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User as FirebaseUser } from 'firebase/auth';
import { io, Socket } from 'socket.io-client';
import { auth, googleAuthProvider } from '../lib/firebase';
import { apiRequest, PortalRole, setActivePortal } from '../lib/api';

export interface AppUser {
  id: string;
  uid: string;
  name: string;
  phone: string | null;
  email: string;
  role: PortalRole;
  status: string;
}

interface AuthContextValue {
  portal: PortalRole | null;
  selectPortal: (p: PortalRole | null) => void;
  firebaseUser: FirebaseUser | null;
  appUser: AppUser | null;
  riderProfile: any | null;
  driverProfile: any | null;
  loading: boolean;
  authError: string | null;
  socket: Socket | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function detectInitialPortal(): PortalRole | null {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname.toLowerCase();
  if (path.startsWith('/rider')) return 'RIDER';
  if (path.startsWith('/driver')) return 'DRIVER';
  if (path.startsWith('/admin')) return 'ADMIN';
  return null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [portal, setPortalState] = useState<PortalRole | null>(() => {
    const p = detectInitialPortal();
    if (p) setActivePortal(p);
    return p;
  });
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [riderProfile, setRiderProfile] = useState<any | null>(null);
  const [driverProfile, setDriverProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  const selectPortal = useCallback((next: PortalRole | null) => {
    if (next) {
      setActivePortal(next);
      window.history.pushState({}, '', `/${next.toLowerCase()}`);
    } else {
      window.history.pushState({}, '', '/');
    }
    setPortalState(next);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const p = detectInitialPortal();
      if (p) setActivePortal(p);
      setPortalState(p);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser || !portal) return;
    try {
      setActivePortal(portal);
      const data = await apiRequest<{
        user: AppUser;
        riderProfile: any;
        driverProfile: any;
      }>('/auth/me');
      setAppUser(data.user);
      setRiderProfile(data.riderProfile);
      setDriverProfile(data.driverProfile);
      setAuthError(null);
    } catch (err: any) {
      setAuthError(err.message || 'Failed to sync profile');
    }
  }, [portal]);

  useEffect(() => {
    let activeSocket: Socket | null = null;
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (activeSocket) {
        activeSocket.disconnect();
        activeSocket = null;
        setSocket(null);
      }

      if (user && portal) {
        try {
          setActivePortal(portal);
          const data = await apiRequest<{
            user: AppUser;
            riderProfile: any;
            driverProfile: any;
          }>('/auth/me');
          setAppUser(data.user);
          setRiderProfile(data.riderProfile);
          setDriverProfile(data.driverProfile);
          setAuthError(null);

          const token = await user.getIdToken();
          activeSocket = io({
            path: '/socket.io',
            auth: { token, portal },
            transports: ['websocket', 'polling'],
          });
          setSocket(activeSocket);
        } catch (err: any) {
          setAuthError(err.message || 'Authentication sync failed');
        }
      } else {
        setAppUser(null);
        setRiderProfile(null);
        setDriverProfile(null);
      }
      setLoading(false);
    });

    return () => {
      unsub();
      if (activeSocket) activeSocket.disconnect();
    };
  }, [portal]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: any) {
      setAuthError(err.message || 'Sign-in was cancelled or failed');
    }
  };

  const logout = async () => {
    if (socket) socket.disconnect();
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        portal,
        selectPortal,
        firebaseUser,
        appUser,
        riderProfile,
        driverProfile,
        loading,
        authError,
        socket,
        signInWithGoogle,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
