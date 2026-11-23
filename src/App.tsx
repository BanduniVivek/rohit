import React from 'react';
import { ArrowLeft, Car, ExternalLink, LogOut, ShieldCheck, UserCheck } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RiderWorkspace } from './components/RiderWorkspace';
import { DriverWorkspace } from './components/DriverWorkspace';
import { AdminWorkspace } from './components/AdminWorkspace';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

const PORTAL_META = {
  RIDER: {
    brand: 'MetroRide Rider',
    headline: 'Book a ride from anywhere to anywhere.',
    summary:
      'Search any pickup and destination on the live map, compare vehicle fares, track your driver in real time, and verify trips with your 4-digit OTP.',
    cta: 'Sign in to Rider App',
  },
  DRIVER: {
    brand: 'MetroRide Driver',
    headline: 'Go online, accept ride requests, and stream live GPS.',
    summary:
      'Register your vehicle, receive incoming trip offers in real time, navigate to pickup, verify rider OTPs, and track your net earnings.',
    cta: 'Sign in to Driver App',
  },
  ADMIN: {
    brand: 'MetroRide Operations',
    headline: 'Monitor live city rides, drivers, fares, and audit logs.',
    summary:
      'Manage driver verification, configure versioned tariffs and geofence rules, resolve support tickets, and inspect real-time fleet activity.',
    cta: 'Sign in to Operations Console',
  },
} as const;

const AppShell: React.FC = () => {
  const {
    portal,
    selectPortal,
    firebaseUser,
    appUser,
    loading,
    authError,
    signInWithGoogle,
    logout,
  } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-700 border-t-transparent animate-spin mx-auto" />
          <p className="text-xs font-medium text-slate-600">Loading MetroRide...</p>
        </div>
      </div>
    );
  }

  // Root Launcher (/) — choose which isolated role app to open
  if (!portal) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
        <header className="h-14 px-6 border-b border-slate-200 bg-white flex items-center justify-between gap-8">
          <span className="font-display text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            MetroRide
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton variant="compact" />
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-6 py-12 space-y-10 w-full">
          <div className="max-w-2xl space-y-3">
            <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 text-balance">
              Choose your MetroRide application.
            </h1>
            <p className="text-base text-slate-600 leading-relaxed">
              Each role runs in its own isolated portal so riders, drivers, and operations staff
              only see their own workspace. Open Rider and Driver in separate browser tabs to test
              the complete real-time flow end to end.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {(
              [
                {
                  id: 'RIDER' as const,
                  title: 'Rider App',
                  desc: 'Pick any pickup & destination on the live map, request a ride, and track driver arrival.',
                  icon: Car,
                  href: '/rider',
                },
                {
                  id: 'DRIVER' as const,
                  title: 'Driver App',
                  desc: 'Log in as a driver, go online, receive live ride offers, accept, and drive on the map.',
                  icon: UserCheck,
                  href: '/driver',
                },
                {
                  id: 'ADMIN' as const,
                  title: 'Admin Operations',
                  desc: 'Monitor active rides on the city map, manage drivers, fares, and audit records.',
                  icon: ShieldCheck,
                  href: '/admin',
                },
              ] as const
            ).map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.id}
                  className="rounded-2xl border border-slate-200 bg-white p-6 flex flex-col justify-between gap-5"
                >
                  <div className="space-y-3">
                    <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900">{card.title}</h2>
                    <p className="text-sm text-slate-600 leading-relaxed">{card.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => selectPortal(card.id)}
                      className="flex-1 min-h-[44px] rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition-colors"
                    >
                      Open Here
                    </button>
                    <a
                      href={card.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 whitespace-nowrap"
                      title={`Open ${card.title} in new tab`}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>New Tab</span>
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        <footer className="px-6 py-4 border-t border-slate-200 bg-white text-xs text-slate-500 flex items-center justify-between">
          <span>MetroRide · Real-Time Ride-Hailing Platform</span>
          <span>PostgreSQL + Socket.IO + OpenStreetMap</span>
        </footer>
      </div>
    );
  }

  const meta = PORTAL_META[portal];

  // Role-specific Sign-In Screen
  if (!firebaseUser || !appUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
        <header className="h-14 px-6 border-b border-slate-200 bg-white flex items-center justify-between gap-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => selectPortal(null)}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Back to portal selector"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="font-display text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              {meta.brand}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton variant="compact" />
          </div>
        </header>

        <main className="max-w-xl mx-auto px-6 py-16 space-y-6 w-full">
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 text-balance">
            {meta.headline}
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">{meta.summary}</p>
          {authError && (
            <p className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
              {authError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={signInWithGoogle}
              className="min-h-[48px] px-6 rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 transition-colors shadow-sm"
            >
              {meta.cta}
            </button>
          </div>
        </main>

        <footer className="px-6 py-4 border-t border-slate-200 bg-white text-xs text-slate-500">
          {meta.brand} · Authenticated Session
        </footer>
      </div>
    );
  }

  // Strictly Isolated Portal View (Zero cross-role tabs visible!)
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 bg-white/95 backdrop-blur-md border-b border-slate-200 flex items-center justify-between gap-4">
        <span className="font-display text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          {meta.brand}
        </span>

        <span className="hidden sm:inline text-xs font-medium text-slate-500 truncate">
          {appUser.name}
        </span>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:block">
            <PWAInstallButton variant="compact" />
          </div>
          <button
            type="button"
            onClick={logout}
            className="min-h-[40px] px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      <main className="flex-1">
        {portal === 'RIDER' && <RiderWorkspace />}
        {portal === 'DRIVER' && <DriverWorkspace />}
        {portal === 'ADMIN' && <AdminWorkspace />}
      </main>

      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
