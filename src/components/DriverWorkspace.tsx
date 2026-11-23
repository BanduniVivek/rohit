import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  IndianRupee,
  LocateFixed,
  Navigation,
  Power,
  ShieldAlert,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { CityMap } from './CityMap';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';

async function readDocumentFile(file: File): Promise<string> {
  if (file.type.startsWith('image/')) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1000;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(String(reader.result));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.onerror = () => resolve(String(reader.result));
        img.src = String(reader.result);
      };
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
  }

  if (file.type === 'application/pdf') {
    if (file.size > 2 * 1024 * 1024) {
      throw new Error('PDF must be under 2 MB. Please choose a smaller file or image.');
    }
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Failed to read PDF file'));
      reader.readAsDataURL(file);
    });
  }

  throw new Error('Please upload an Image (JPG/PNG) or PDF document.');
}

export const DriverWorkspace: React.FC = () => {
  const { appUser, driverProfile, socket, refreshProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<'dispatch' | 'earnings' | 'vehicle'>('dispatch');

  const [incomingRequests, setIncomingRequests] = useState<any[]>([]);
  const [activeRideDetail, setActiveRideDetail] = useState<any | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(() =>
    driverProfile?.location
      ? { lat: driverProfile.location.lat, lng: driverProfile.location.lng }
      : null
  );
  const [gpsStatus, setGpsStatus] = useState<'LOCATING' | 'ACTIVE' | 'ERROR'>('LOCATING');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const lastHttpSyncRef = useRef<number>(0);

  const [earnings, setEarnings] = useState<{ summary: any; entries: any[] }>({
    summary: { gross: '0.00', commission: '0.00', net: '0.00', trips: 0 },
    entries: [],
  });

  const [otpInput, setOtpInput] = useState('');
  const [cashCollected, setCashCollected] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingKyc, setEditingKyc] = useState(false);

  const [form, setForm] = useState({
    name: appUser?.name || '',
    phone: appUser?.phone || '',
    licenceNumber: '',
    licenceExpiry: '2032-12-31',
    aadhaarNumber: '',
    licenceDocRef: '',
    licenceDocName: '',
    aadhaarDocRef: '',
    aadhaarDocName: '',
    rcDocRef: '',
    rcDocName: '',
    registrationNumber: '',
    category: 'AUTO' as 'BIKE' | 'AUTO' | 'MINI' | 'SEDAN',
    make: 'Bajaj',
    model: 'RE Compact',
    colour: 'Yellow & Green',
  });

  useEffect(() => {
    if (driverProfile?.driver) {
      const v = driverProfile.vehicles?.[0];
      const dlDoc = driverProfile.documents?.find((d: any) => d.documentType === 'DRIVING_LICENCE');
      const aadhaarDoc = driverProfile.documents?.find((d: any) => d.documentType === 'AADHAAR_CARD');
      const rcDoc = driverProfile.documents?.find((d: any) => d.documentType === 'RC_BOOK');
      setForm((prev) => ({
        ...prev,
        name: driverProfile.user?.name || appUser?.name || prev.name,
        phone: driverProfile.user?.phone || appUser?.phone || prev.phone,
        licenceNumber: driverProfile.driver.licenceNumber || prev.licenceNumber,
        licenceExpiry: driverProfile.driver.licenceExpiry || prev.licenceExpiry,
        aadhaarNumber: driverProfile.driver.aadhaarNumber || prev.aadhaarNumber,
        licenceDocRef: dlDoc?.fileRef || prev.licenceDocRef,
        aadhaarDocRef: aadhaarDoc?.fileRef || prev.aadhaarDocRef,
        rcDocRef: rcDoc?.fileRef || prev.rcDocRef,
        registrationNumber: v?.registrationNumber || prev.registrationNumber,
        category: (v?.category as any) || prev.category,
        make: v?.make || prev.make,
        model: v?.model || prev.model,
        colour: v?.colour || prev.colour,
      }));
    } else if (appUser) {
      setForm((prev) => ({
        ...prev,
        name: prev.name || appUser.name || '',
        phone: prev.phone || appUser.phone || '',
      }));
    }
  }, [driverProfile, appUser]);

  const pushRealGpsUpdate = useCallback(
    (lat: number, lng: number, accuracy?: number, heading?: number, speed?: number) => {
      setDriverPos({ lat, lng });
      setGpsStatus('ACTIVE');
      if (typeof accuracy === 'number') {
        setGpsAccuracy(Math.round(accuracy));
      }

      if (socket && socket.connected) {
        socket.emit('driver:location:stream', {
          lat,
          lng,
          heading: heading || 0,
          speed: speed || 0,
        });
      }

      // Sync via HTTP initially or every 12s if driver profile already exists
      const now = Date.now();
      if (driverProfile?.driver && now - lastHttpSyncRef.current > 12000) {
        lastHttpSyncRef.current = now;
        apiRequest('/drivers/me/location', {
          method: 'POST',
          body: JSON.stringify({ lat, lng, heading: heading || 0, speed: speed || 0 }),
        }).catch(() => {});
      }
    },
    [socket, driverProfile?.driver]
  );

  const requestGpsFix = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus('ERROR');
      setErrorMsg('Browser geolocation is not supported on this device.');
      return;
    }
    setGpsStatus('LOCATING');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pushRealGpsUpdate(
          Number(pos.coords.latitude.toFixed(5)),
          Number(pos.coords.longitude.toFixed(5)),
          pos.coords.accuracy,
          pos.coords.heading || 0,
          pos.coords.speed || 0
        );
      },
      () => {
        setGpsStatus('ERROR');
        setErrorMsg('Location access is required for real-time GPS tracking. Please allow GPS access.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [pushRealGpsUpdate]);

  // Continuous Real-Time Device GPS watchPosition (zero simulations)
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus('ERROR');
      return;
    }

    requestGpsFix();

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        pushRealGpsUpdate(
          Number(pos.coords.latitude.toFixed(5)),
          Number(pos.coords.longitude.toFixed(5)),
          pos.coords.accuracy,
          pos.coords.heading || 0,
          pos.coords.speed || 0
        );
      },
      () => {
        setGpsStatus('ERROR');
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [pushRealGpsUpdate, requestGpsFix]);

  const loadDriverState = useCallback(async () => {
    try {
      const [activeRes, reqRes, earnRes] = await Promise.all([
        apiRequest('/drivers/me/active-ride'),
        apiRequest('/drivers/me/ride-requests'),
        apiRequest('/drivers/me/earnings'),
      ]);
      setActiveRideDetail(activeRes.activeRide || null);
      setIncomingRequests(reqRes.requests || []);
      setEarnings(earnRes);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadDriverState();
  }, [
    loadDriverState,
    driverProfile?.driver?.id,
    driverProfile?.driver?.verificationStatus,
    driverProfile?.driver?.isOnline,
  ]);

  // Real-time Socket.IO events for KYC approval, incoming ride offers, and cancellations
  useEffect(() => {
    if (!socket) return;
    socket.emit('driver:join');
    if (activeRideDetail?.ride?.id) {
      socket.emit('ride:join', activeRideDetail.ride.id);
    }

    const onNewOffer = () => {
      setStatusNotice('New ride request received!');
      loadDriverState();
    };
    const onCancelled = () => {
      setActiveRideDetail(null);
      setStatusNotice('Ride was cancelled.');
      loadDriverState();
    };
    const onVerificationUpdated = async (payload: {
      verificationStatus: string;
      rejectionReason?: string;
    }) => {
      await refreshProfile();
      await loadDriverState();
      if (payload.verificationStatus === 'APPROVED') {
        setEditingKyc(false);
        setStatusNotice('Admin approved your documents! Tap Go Online to accept rides.');
      } else {
        setErrorMsg(
          `Account ${payload.verificationStatus}: ${
            payload.rejectionReason || 'Please review your documents.'
          }`
        );
      }
    };

    socket.on('ride.request.created', onNewOffer);
    socket.on('ride.cancelled', onCancelled);
    socket.on('driver.verification.updated', onVerificationUpdated);
    return () => {
      socket.off('ride.request.created', onNewOffer);
      socket.off('ride.cancelled', onCancelled);
      socket.off('driver.verification.updated', onVerificationUpdated);
    };
  }, [socket, activeRideDetail?.ride?.id, loadDriverState, refreshProfile]);

  // Fetch live road route for active trip or first incoming offer
  const focusRide = activeRideDetail?.ride || incomingRequests[0] || null;
  useEffect(() => {
    if (!focusRide) {
      setRouteCoords([]);
      return;
    }
    const useDriverOrigin = activeRideDetail?.ride?.status === 'ACCEPTED' && driverPos;
    const fromLat = useDriverOrigin ? driverPos.lat : focusRide.pickupLat;
    const fromLng = useDriverOrigin ? driverPos.lng : focusRide.pickupLng;
    const toLat =
      activeRideDetail?.ride?.status === 'ACCEPTED' ? focusRide.pickupLat : focusRide.dropLat;
    const toLng =
      activeRideDetail?.ride?.status === 'ACCEPTED' ? focusRide.pickupLng : focusRide.dropLng;

    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest<{ coordinates: [number, number][] }>(
          `/geo/route?pickupLat=${fromLat}&pickupLng=${fromLng}&dropLat=${toLat}&dropLng=${toLng}`
        );
        if (!cancelled) setRouteCoords(res.coordinates || []);
      } catch {
        // fallback handled by CityMap
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    focusRide?.id,
    focusRide?.pickupLat,
    focusRide?.dropLat,
    activeRideDetail?.ride?.status,
    driverPos?.lat,
    driverPos?.lng,
  ]);

  const handleDocUpload = async (
    field: 'licenceDoc' | 'aadhaarDoc' | 'rcDoc',
    file: File | null
  ) => {
    if (!file) return;
    setErrorMsg(null);
    try {
      const ref = await readDocumentFile(file);
      if (field === 'licenceDoc') {
        setForm((prev) => ({ ...prev, licenceDocRef: ref, licenceDocName: file.name }));
      } else if (field === 'aadhaarDoc') {
        setForm((prev) => ({ ...prev, aadhaarDocRef: ref, aadhaarDocName: file.name }));
      } else {
        setForm((prev) => ({ ...prev, rcDocRef: ref, rcDocName: file.name }));
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not process document upload');
    }
  };

  const handleOnboardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusNotice(null);

    if (!form.licenceDocRef || !form.aadhaarDocRef) {
      setErrorMsg('Please upload both your Driving Licence and Aadhaar Card files for Admin inspection.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest('/drivers/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          rcDocRef: form.rcDocRef || undefined,
          lat: driverPos?.lat,
          lng: driverPos?.lng,
        }),
      });
      await refreshProfile();
      setEditingKyc(false);
      socket?.emit('driver:join');
      setStatusNotice(
        'Details & documents uploaded! Waiting for Admin approval in Operations Console.'
      );
      await loadDriverState();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleOnline = async () => {
    if (!driverProfile?.driver) return;
    setErrorMsg(null);
    try {
      const next = !driverProfile.driver.isOnline;
      if (next && driverPos) {
        await apiRequest('/drivers/me/location', {
          method: 'POST',
          body: JSON.stringify({ lat: driverPos.lat, lng: driverPos.lng }),
        });
      }
      await apiRequest('/drivers/me/availability', {
        method: 'PATCH',
        body: JSON.stringify({ isOnline: next }),
      });
      await refreshProfile();
      if (next) {
        socket?.emit('driver:join');
        requestGpsFix();
        await loadDriverState();
      }
      setStatusNotice(
        next ? 'You are ONLINE and streaming live GPS!' : 'You are OFFLINE.'
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    setErrorMsg(null);
    try {
      await apiRequest(`/ride-requests/${requestId}/accept`, { method: 'POST' });
      setStatusNotice('Ride accepted! Follow live GPS route to pickup.');
      await loadDriverState();
    } catch (err: any) {
      setErrorMsg(err.message);
      await loadDriverState();
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    setErrorMsg(null);
    try {
      await apiRequest(`/ride-requests/${requestId}/reject`, { method: 'POST' });
      await loadDriverState();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleArrive = async () => {
    if (!activeRideDetail?.ride?.id) return;
    setErrorMsg(null);
    try {
      await apiRequest(`/rides/${activeRideDetail.ride.id}/arrive`, { method: 'POST' });
      setStatusNotice('Marked arrived. Enter rider 4-digit OTP to start trip.');
      await loadDriverState();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleStartWithOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRideDetail?.ride?.id) return;
    setErrorMsg(null);
    try {
      await apiRequest(`/rides/${activeRideDetail.ride.id}/start`, {
        method: 'POST',
        body: JSON.stringify({ otp: otpInput }),
      });
      setOtpInput('');
      setStatusNotice('OTP verified! Trip is IN_PROGRESS.');
      await loadDriverState();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleCompleteTrip = async () => {
    if (!activeRideDetail?.ride?.id) return;
    setErrorMsg(null);
    try {
      await apiRequest(`/rides/${activeRideDetail.ride.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ cashCollected }),
      });
      setStatusNotice('Trip completed and earnings recorded!');
      setActiveRideDetail(null);
      await loadDriverState();
      await refreshProfile();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDriverSos = async () => {
    try {
      await apiRequest('/support/sos', {
        method: 'POST',
        body: JSON.stringify({
          rideId: activeRideDetail?.ride?.id,
          lat: driverPos?.lat || 20.5937,
          lng: driverPos?.lng || 78.9629,
          notes: 'Driver triggered emergency SOS',
        }),
      });
      setStatusNotice('SOS alert logged with Operations.');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const driver = driverProfile?.driver;
  const activeRide = activeRideDetail?.ride;
  const showKycForm = !driver || editingKyc;

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-12 lg:min-h-[calc(100vh-56px)] bg-slate-50">
      {/* Driver Real-Time GPS Map */}
      <div className="lg:col-span-7 h-[38vh] min-h-[250px] lg:h-[calc(100vh-56px)] lg:sticky lg:top-14">
        <CityMap
          pickup={focusRide ? { lat: focusRide.pickupLat, lng: focusRide.pickupLng } : null}
          drop={focusRide ? { lat: focusRide.dropLat, lng: focusRide.dropLng } : null}
          routeCoords={routeCoords}
          assignedDriver={
            driverPos
              ? {
                  driverId: driver?.id || 'me',
                  driverName: driverProfile?.user?.name || 'Your Live GPS',
                  category: driverProfile?.vehicles?.[0]?.category || form.category,
                  lat: driverPos.lat,
                  lng: driverPos.lng,
                }
              : null
          }
          className="w-full h-full"
        />
      </div>

      {/* Driver Console Panel */}
      <div className="lg:col-span-5 flex flex-col bg-white border-t lg:border-t-0 lg:border-l border-slate-200 pb-20 lg:pb-6">
        <div className="hidden lg:flex items-center gap-1 p-2 mx-5 mt-4 bg-slate-100 rounded-xl">
          {[
            { id: 'dispatch', label: 'Dispatch & Trip' },
            { id: 'earnings', label: 'Earnings' },
            { id: 'vehicle', label: 'KYC & Vehicle' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 min-h-[40px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-4 flex-1 overflow-y-auto">
          {/* Live Real-Time GPS Status Bar */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <LocateFixed
                className={`w-4 h-4 shrink-0 ${
                  gpsStatus === 'ACTIVE'
                    ? 'text-emerald-700'
                    : gpsStatus === 'ERROR'
                    ? 'text-red-600'
                    : 'text-amber-600'
                }`}
              />
              <span className="font-mono truncate text-slate-700">
                {gpsStatus === 'ACTIVE' && driverPos
                  ? `Live GPS: ${driverPos.lat.toFixed(4)}, ${driverPos.lng.toFixed(4)}${
                      gpsAccuracy ? ` (±${gpsAccuracy}m)` : ''
                    }`
                  : gpsStatus === 'LOCATING'
                  ? 'Acquiring real device GPS...'
                  : 'GPS permission needed'}
              </span>
            </div>
            <button
              type="button"
              onClick={requestGpsFix}
              className="text-[11px] font-semibold text-emerald-700 hover:underline shrink-0"
            >
              Sync GPS
            </button>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {statusNotice && (
            <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs text-emerald-900">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
              <span>{statusNotice}</span>
            </div>
          )}

          {showKycForm ? (
            <form onSubmit={handleOnboardSubmit} className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h1 className="text-lg font-bold text-slate-900">
                    {driver ? 'Update KYC & Vehicle Details' : 'Driver Onboarding & KYC'}
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Upload your Driving Licence and Aadhaar Card so Operations Admin can verify your
                    documents.
                  </p>
                </div>
                {driver && (
                  <button
                    type="button"
                    onClick={() => setEditingKyc(false)}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                <p className="text-xs font-bold text-slate-800">1. Driver Contact Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Full Name"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                  />
                  <input
                    required
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="Mobile (+91 98...)"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                  />
                </div>
              </div>

              {/* KYC Documents with Image/PDF Preview */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
                <p className="text-xs font-bold text-slate-800">
                  2. Driving Licence & Aadhaar Card (Required)
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    required
                    value={form.licenceNumber}
                    onChange={(e) => setForm({ ...form, licenceNumber: e.target.value })}
                    placeholder="Driving Licence No"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono"
                  />
                  <input
                    required
                    type="date"
                    value={form.licenceExpiry}
                    onChange={(e) => setForm({ ...form, licenceExpiry: e.target.value })}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono"
                    title="Driving Licence Expiry Date"
                  />
                </div>

                <label className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-2.5 cursor-pointer hover:border-emerald-600">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {form.licenceDocRef.startsWith('data:image') ? (
                      <img
                        src={form.licenceDocRef}
                        alt="Licence preview"
                        className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <Upload className="w-4 h-4 text-emerald-700 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">
                        {form.licenceDocName
                          ? `Licence: ${form.licenceDocName}`
                          : form.licenceDocRef
                          ? 'Driving Licence document attached'
                          : 'Upload Driving Licence (Photo or PDF)'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {form.licenceDocRef ? 'Visible to Admin' : 'Required · Tap to upload'}
                      </p>
                    </div>
                  </div>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleDocUpload('licenceDoc', e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>

                <input
                  required
                  value={form.aadhaarNumber}
                  onChange={(e) => setForm({ ...form, aadhaarNumber: e.target.value })}
                  placeholder="Aadhaar Card Number (12 digits)"
                  maxLength={14}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono"
                />

                <label className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-2.5 cursor-pointer hover:border-emerald-600">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {form.aadhaarDocRef.startsWith('data:image') ? (
                      <img
                        src={form.aadhaarDocRef}
                        alt="Aadhaar preview"
                        className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <Upload className="w-4 h-4 text-emerald-700 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">
                        {form.aadhaarDocName
                          ? `Aadhaar: ${form.aadhaarDocName}`
                          : form.aadhaarDocRef
                          ? 'Aadhaar Card document attached'
                          : 'Upload Aadhaar Card (Photo or PDF)'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {form.aadhaarDocRef ? 'Visible to Admin' : 'Required · Tap to upload'}
                      </p>
                    </div>
                  </div>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleDocUpload('aadhaarDoc', e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                <p className="text-xs font-bold text-slate-800">3. Vehicle Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    required
                    value={form.registrationNumber}
                    onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
                    placeholder="Plate No (e.g. TN-45-AB-2048)"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono"
                  />
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as any })}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                  >
                    <option value="BIKE">Moto Bike</option>
                    <option value="AUTO">City Auto</option>
                    <option value="MINI">Metro Mini</option>
                    <option value="SEDAN">Prime Sedan</option>
                  </select>
                  <input
                    required
                    value={form.make}
                    onChange={(e) => setForm({ ...form, make: e.target.value })}
                    placeholder="Make (e.g. Bajaj, Tata)"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                  />
                  <input
                    required
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="Model (e.g. RE Compact)"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                  />
                </div>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-2 cursor-pointer hover:border-emerald-600">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="w-4 h-4 text-slate-600 shrink-0" />
                    <span className="text-xs font-medium text-slate-700 truncate">
                      {form.rcDocName || 'Optional: Upload Vehicle RC Book (Photo or PDF)'}
                    </span>
                  </div>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleDocUpload('rcDoc', e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 transition-colors"
              >
                {submitting
                  ? 'Uploading KYC for Admin Review...'
                  : 'Submit Details & Documents for Approval'}
              </button>
            </form>
          ) : (
            <>
              {activeTab === 'dispatch' && (
                <div className="space-y-4">
                  {driver.verificationStatus !== 'APPROVED' ? (
                    <div
                      className={`rounded-2xl border p-5 space-y-4 ${
                        driver.verificationStatus === 'PENDING'
                          ? 'border-amber-200 bg-amber-50/70'
                          : 'border-red-200 bg-red-50/70'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {driver.verificationStatus === 'PENDING' ? (
                          <Clock className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-6 h-6 text-red-700 shrink-0 mt-0.5" />
                        )}
                        <div className="space-y-1">
                          <h2 className="text-base font-bold text-slate-900">
                            {driver.verificationStatus === 'PENDING'
                              ? 'Verification Pending Admin Approval'
                              : `Driver Account ${driver.verificationStatus}`}
                          </h2>
                          <p className="text-xs text-slate-700 leading-relaxed">
                            {driver.verificationStatus === 'PENDING'
                              ? 'Your Driving Licence and Aadhaar Card have been sent to Admin Operations (/admin). Once Admin inspects and approves them, you can Go Online.'
                              : driver.rejectionReason ||
                                'Your documents were not approved. Please upload updated documents.'}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-xl bg-white border border-slate-200 p-3.5 space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Driving Licence</span>
                          <span className="font-mono font-semibold text-slate-900">
                            {driver.licenceNumber}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Aadhaar Card</span>
                          <span className="font-mono font-semibold text-slate-900">
                            {driver.aadhaarNumber || 'Submitted'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Vehicle</span>
                          <span className="font-mono font-semibold text-slate-900">
                            {driverProfile.vehicles?.[0]?.registrationNumber} (
                            {driverProfile.vehicles?.[0]?.category})
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await refreshProfile();
                            await loadDriverState();
                          }}
                          className="flex-1 min-h-[44px] rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                        >
                          Check Approval Status
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingKyc(true)}
                          className="flex-1 min-h-[44px] rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50"
                        >
                          Edit & Re-submit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs text-emerald-800 font-semibold flex items-center gap-1">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>Verified Driver · APPROVED</span>
                            </p>
                            <h2 className="text-base font-bold text-slate-900 mt-0.5">
                              {driver.isOnline ? 'Online · Streaming Live GPS' : 'Offline'}
                            </h2>
                          </div>
                          <button
                            type="button"
                            onClick={handleToggleOnline}
                            className={`min-h-[44px] px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                              driver.isOnline
                                ? 'bg-slate-900 text-white hover:bg-slate-800'
                                : 'bg-emerald-700 text-white hover:bg-emerald-800'
                            }`}
                          >
                            <Power className="w-4 h-4" />
                            <span>{driver.isOnline ? 'Go Offline' : 'Go Online'}</span>
                          </button>
                        </div>

                        {driver.isOnline && (
                          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                            <span className="text-xs text-slate-600">
                              Real-time GPS updates automatically while online
                            </span>
                            <button
                              type="button"
                              onClick={handleDriverSos}
                              className="min-h-[36px] px-3 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 flex items-center gap-1"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>SOS</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {activeRide ? (
                        <div className="rounded-2xl border border-emerald-700 bg-white p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-slate-500">Active Assignment</p>
                              <h3 className="text-base font-bold text-slate-900">
                                {activeRideDetail.rider?.name || 'Rider'} · ₹
                                {activeRide.estimatedFare}
                              </h3>
                            </div>
                            <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-md">
                              {activeRide.status}
                            </span>
                          </div>

                          <div className="space-y-1.5 text-xs text-slate-700 border-t border-slate-100 pt-3">
                            <p>
                              <strong className="text-emerald-800">Pickup:</strong>{' '}
                              {activeRide.pickupAddress}
                            </p>
                            <p>
                              <strong className="text-amber-800">Drop:</strong>{' '}
                              {activeRide.dropAddress}
                            </p>
                            <p className="font-mono text-slate-500 tabular-nums">
                              {activeRide.distanceKm} km · {activeRide.durationMin} min ·{' '}
                              {activeRide.paymentMethod}
                            </p>
                          </div>

                          {activeRide.status === 'ACCEPTED' && (
                            <button
                              type="button"
                              onClick={handleArrive}
                              className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 flex items-center justify-center gap-2"
                            >
                              <Navigation className="w-4 h-4" />
                              <span>Mark Arrived at Pickup</span>
                            </button>
                          )}

                          {activeRide.status === 'ARRIVED' && (
                            <form onSubmit={handleStartWithOtp} className="space-y-2.5">
                              <label className="block text-xs font-semibold text-slate-700">
                                Enter Rider 4-Digit Pickup OTP to Start Trip
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  maxLength={4}
                                  required
                                  value={otpInput}
                                  onChange={(e) => setOtpInput(e.target.value)}
                                  placeholder="4-digit OTP"
                                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-lg tracking-widest text-center"
                                />
                                <button
                                  type="submit"
                                  className="min-h-[48px] px-5 rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800"
                                >
                                  Start Trip
                                </button>
                              </div>
                            </form>
                          )}

                          {activeRide.status === 'IN_PROGRESS' && (
                            <div className="space-y-3">
                              {activeRide.paymentMethod === 'CASH' && (
                                <label className="flex items-center gap-2.5 text-xs font-medium text-slate-800 bg-slate-50 rounded-xl p-3 border border-slate-200">
                                  <input
                                    type="checkbox"
                                    checked={cashCollected}
                                    onChange={(e) => setCashCollected(e.target.checked)}
                                    className="w-4 h-4 accent-emerald-700"
                                  />
                                  <span>Cash ₹{activeRide.estimatedFare} collected</span>
                                </label>
                              )}
                              <button
                                type="button"
                                onClick={handleCompleteTrip}
                                className="w-full min-h-[48px] rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800"
                              >
                                Complete Trip & Record Earnings
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-900">
                              Incoming Ride Requests ({incomingRequests.length})
                            </h3>
                            <button
                              type="button"
                              onClick={loadDriverState}
                              className="text-xs font-semibold text-emerald-700 hover:underline"
                            >
                              Refresh
                            </button>
                          </div>

                          {incomingRequests.length === 0 ? (
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-500">
                              {driver.isOnline
                                ? 'Listening for incoming ride requests in real time...'
                                : 'Tap Go Online above to start receiving ride requests.'}
                            </div>
                          ) : (
                            incomingRequests.map((req) => (
                              <div
                                key={req.requestId}
                                className="rounded-2xl border-2 border-emerald-600 bg-emerald-50/30 p-4 space-y-3"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold text-slate-700">
                                    {req.riderName} · {req.vehicleType}
                                  </span>
                                  <span className="font-mono text-lg font-bold text-emerald-800 tabular-nums">
                                    ₹{req.estimatedFare}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-700 space-y-1">
                                  <p className="font-semibold text-slate-900">
                                    {req.pickupAddress} → {req.dropAddress}
                                  </p>
                                  <p className="text-slate-500 tabular-nums">
                                    {req.tripDistanceKm} km trip · {req.durationMin} min ·{' '}
                                    {req.paymentMethod}
                                  </p>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleRejectRequest(req.requestId)}
                                    className="flex-1 min-h-[44px] rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700"
                                  >
                                    Decline
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAcceptRequest(req.requestId)}
                                    className="flex-1 min-h-[44px] rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800"
                                  >
                                    Accept Ride
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'earnings' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[11px] text-slate-500">Gross</p>
                      <p className="font-mono text-base font-bold text-slate-900 tabular-nums mt-0.5">
                        ₹{earnings.summary.gross}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-[11px] text-slate-500">Fee (15%)</p>
                      <p className="font-mono text-base font-bold text-slate-700 tabular-nums mt-0.5">
                        ₹{earnings.summary.commission}
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-[11px] text-emerald-800">Net</p>
                      <p className="font-mono text-base font-bold text-emerald-900 tabular-nums mt-0.5">
                        ₹{earnings.summary.net}
                      </p>
                    </div>
                  </div>

                  {earnings.entries.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-500">
                      Complete a trip to see your commission and net earnings ledger.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl">
                      {earnings.entries.map((e) => (
                        <div key={e.id} className="p-3.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {e.pickupAddress} → {e.dropAddress}
                            </p>
                            <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                              Gross ₹{e.grossAmount} · Fee ₹{e.commissionAmount}
                            </p>
                          </div>
                          <p className="font-mono text-sm font-bold text-emerald-800 tabular-nums shrink-0">
                            +₹{e.netAmount}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'vehicle' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900">KYC & Vehicle Profile</h3>
                      <button
                        type="button"
                        onClick={() => setEditingKyc(true)}
                        className="text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        Update KYC
                      </button>
                    </div>
                    <div className="text-xs text-slate-700 space-y-1">
                      <p>
                        Verification:{' '}
                        <strong className="font-mono">{driver.verificationStatus}</strong>
                      </p>
                      <p>
                        Licence: <strong className="font-mono">{driver.licenceNumber}</strong> (exp{' '}
                        {driver.licenceExpiry})
                      </p>
                      <p>
                        Aadhaar:{' '}
                        <strong className="font-mono">{driver.aadhaarNumber || 'Not set'}</strong>
                      </p>
                    </div>
                    {driverProfile.vehicles?.map((v: any) => (
                      <div
                        key={v.id}
                        className="text-xs text-slate-700 space-y-1 pt-2 border-t border-slate-100"
                      >
                        <p className="font-semibold text-slate-900">
                          {v.make} {v.model} ({v.colour})
                        </p>
                        <p className="font-mono">
                          {v.registrationNumber} · {v.category} · {v.verificationStatus}
                        </p>
                      </div>
                    ))}
                    {driverProfile.documents?.length > 0 && (
                      <div className="pt-2 border-t border-slate-100 space-y-2">
                        <p className="text-xs font-semibold text-slate-800">Submitted Documents</p>
                        <div className="grid grid-cols-2 gap-2">
                          {driverProfile.documents.map((doc: any) => (
                            <div
                              key={doc.id}
                              className="rounded-xl border border-slate-200 p-2 text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-semibold text-slate-800 truncate">
                                  {doc.documentType.replace(/_/g, ' ')}
                                </span>
                                <span className="font-mono text-[10px] font-bold text-slate-600">
                                  {doc.verificationStatus}
                                </span>
                              </div>
                              {doc.fileRef?.startsWith('data:image') && (
                                <img
                                  src={doc.fileRef}
                                  alt={doc.documentType}
                                  className="w-full h-20 object-cover rounded-lg border border-slate-100"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Driver mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-3 h-16 pb-safe"
      >
        {[
          { id: 'dispatch', label: 'Dispatch', icon: Car },
          { id: 'earnings', label: 'Earnings', icon: IndianRupee },
          { id: 'vehicle', label: 'KYC & Docs', icon: ClipboardCheck },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id as any)}
              className={`flex flex-col items-center justify-center min-h-[44px] ${
                active ? 'text-emerald-700 font-bold' : 'text-slate-500 font-medium'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[11px] mt-0.5">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
