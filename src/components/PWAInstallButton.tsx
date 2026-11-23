import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'banner' }> = ({
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          variant === 'banner'
            ? 'w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0'
            : 'min-h-[40px] flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0'
        }
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Install Android App</span>
      </button>
    );
  }

  if (isIOS || variant === 'banner') {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className={
            variant === 'banner'
              ? 'w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0'
              : 'min-h-[40px] flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0'
          }
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>Install App</span>
        </button>

        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">Install MetroRide on Mobile</h3>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                  aria-label="Close install instructions"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p>
                  <strong className="text-slate-900">Android (Chrome):</strong> Tap the browser menu
                  and select <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                </p>
                <p>
                  <strong className="text-slate-900">iOS (Safari):</strong> Tap <strong>Share</strong>{' '}
                  in the bottom toolbar and choose <strong>Add to Home Screen</strong>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
