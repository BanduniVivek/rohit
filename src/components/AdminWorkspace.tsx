import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { CityMap } from './CityMap';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export const AdminWorkspace: React.FC = () => {
  const { socket } = useAuth();
  const [section, setSection] = useState<'overview' | 'drivers' | 'fares' | 'support'>('overview');

  const [kpis, setKpis] = useState<any>({});
  const [cityContext, setCityContext] = useState<any>({
    landmarks: [],
    nearbyDrivers: [],
    serviceArea: null,
  });
  const [drivers, setDrivers] = useState<any[]>([]);
  const [rides, setRides] = useState<any[]>([]);
  const [selectedRide, setSelectedRide] = useState<any | null>(null);
  const [fareConfigs, setFareConfigs] = useState<any[]>([]);
  const [supportData, setSupportData] = useState<{ tickets: any[]; sos: any[] }>({
    tickets: [],
    sos: [],
  });
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const [driverFilter, setDriverFilter] = useState<
    'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [rejectReason, setRejectReason] = useState('Document mismatch or incomplete KYC');
  const [previewDoc, setPreviewDoc] = useState<{
    driverName: string;
    docType: string;
    fileRef: string;
  } | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [areaForm, setAreaForm] = useState({
    cityName: 'Bengaluru',
    radiusKm: 20,
    operatingHours: '05:00 - 23:59',
    supportPhone: '+91 80 4400 9100',
    allowOutOfAreaDrop: true,
    isActive: true,
  });

  const loadAdminData = useCallback(async () => {
    try {
      const [dashRes, cityRes, drvRes, ridesRes, fareRes, supRes, logRes] = await Promise.all([
        apiRequest('/admin/dashboard'),
        apiRequest('/city/context?all=true'),
        apiRequest('/admin/drivers'),
        apiRequest('/admin/rides'),
        apiRequest('/admin/fare-configs'),
        apiRequest('/admin/support'),
        apiRequest('/admin/audit-logs'),
      ]);

      setKpis(dashRes.kpis || {});
      setCityContext(cityRes);
      if (cityRes.serviceArea) {
        setAreaForm({
          cityName: cityRes.serviceArea.cityName,
          radiusKm: cityRes.serviceArea.radiusKm,
          operatingHours: cityRes.serviceArea.operatingHours,
          supportPhone: cityRes.serviceArea.supportPhone,
          allowOutOfAreaDrop: cityRes.serviceArea.allowOutOfAreaDrop,
          isActive: cityRes.serviceArea.isActive,
        });
      }
      setDrivers(drvRes.drivers || []);
      setRides(ridesRes.rides || []);
      setFareConfigs(fareRes.fareConfigs || []);
      setSupportData(supRes);
      setAuditLogs(logRes.auditLogs || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load operations console');
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  useEffect(() => {
    if (!socket) return;
    socket.emit('ops:join');
    const refresh = () => loadAdminData();
    const handleLocUpdate = (payload: { driverId: string; lat: number; lng: number; heading?: number }) => {
      setCityContext((prev: any) => {
        const list = prev.nearbyDrivers || [];
        const exists = list.some((d: any) => d.driverId === payload.driverId);
        if (exists) {
          return {
            ...prev,
            nearbyDrivers: list.map((d: any) =>
              d.driverId === payload.driverId
                ? { ...d, lat: payload.lat, lng: payload.lng, heading: payload.heading || 0 }
                : d
            ),
          };
        }
        return {
          ...prev,
          nearbyDrivers: [
            ...list,
            {
              driverId: payload.driverId,
              driverName: 'Live GPS Driver',
              category: 'CAB',
              lat: payload.lat,
              lng: payload.lng,
              heading: payload.heading || 0,
            },
          ],
        };
      });
    };
    socket.on('ride.created', refresh);
    socket.on('ride.request.accepted', refresh);
    socket.on('ride.completed', refresh);
    socket.on('ride.cancelled', refresh);
    socket.on('sos.triggered', refresh);
    socket.on('driver.onboarded', refresh);
    socket.on('driver.availability.changed', refresh);
    socket.on('driver.verification.updated', refresh);
    socket.on('driver.location.updated', handleLocUpdate);
    return () => {
      socket.off('ride.created', refresh);
      socket.off('ride.request.accepted', refresh);
      socket.off('ride.completed', refresh);
      socket.off('ride.cancelled', refresh);
      socket.off('sos.triggered', refresh);
      socket.off('driver.onboarded', refresh);
      socket.off('driver.availability.changed', refresh);
      socket.off('driver.verification.updated', refresh);
      socket.off('driver.location.updated', handleLocUpdate);
    };
  }, [socket, loadAdminData]);

  const handleDriverDecision = async (
    driverId: string,
    decision: 'APPROVED' | 'REJECTED' | 'SUSPENDED'
  ) => {
    setErrorMsg(null);
    setNotice(null);
    try {
      await apiRequest(`/admin/drivers/${driverId}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          reason: decision === 'APPROVED' ? undefined : rejectReason,
        }),
      });
      setNotice(`Driver status updated to ${decision} and broadcasted in real time.`);
      await loadAdminData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleAdminCancelRide = async (rideId: string) => {
    setErrorMsg(null);
    setNotice(null);
    try {
      await apiRequest(`/rides/${rideId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelled by City Operations' }),
      });
      setNotice('Ride cancelled by Admin Operations.');
      await loadAdminData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleFareSave = async (cfg: any) => {
    setErrorMsg(null);
    setNotice(null);
    try {
      await apiRequest('/admin/fare-config', {
        method: 'PATCH',
        body: JSON.stringify(cfg),
      });
      setNotice(`Saved versioned tariff for ${cfg.vehicleType}.`);
      await loadAdminData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSaveServiceArea = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNotice(null);
    try {
      await apiRequest('/admin/service-area', {
        method: 'PATCH',
        body: JSON.stringify(areaForm),
      });
      setNotice('City geofence & service policy updated.');
      await loadAdminData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleResolveTicket = async (ticketId: string) => {
    setErrorMsg(null);
    try {
      await apiRequest(`/admin/support/tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'RESOLVED', resolution: 'Resolved by City Operations' }),
      });
      setNotice('Support ticket marked RESOLVED.');
      await loadAdminData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const filteredDrivers = drivers
    .filter((d) => {
      const matchesStatus = driverFilter === 'ALL' || d.verificationStatus === driverFilter;
      const matchesQuery =
        !searchQuery.trim() ||
        d.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.licenceNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.aadhaarNumber?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesStatus && matchesQuery;
    })
    .sort((a, b) => {
      if (a.verificationStatus === 'PENDING' && b.verificationStatus !== 'PENDING') return -1;
      if (b.verificationStatus === 'PENDING' && a.verificationStatus !== 'PENDING') return 1;
      return 0;
    });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 pb-24 lg:pb-8 space-y-5">
      {/* Sub-navigation bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Operations Console</h1>
          <p className="text-xs text-slate-500">
            All-India live GPS fleet monitoring, driver KYC inspection, tariffs, and audit trail
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview & Map' },
            { id: 'drivers', label: `Drivers (${kpis.pendingApprovals || 0} pending)` },
            { id: 'fares', label: 'Fares & Policy' },
            { id: 'support', label: 'Support & Audit' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSection(t.id as any)}
              className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                section === t.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs text-emerald-900">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
          <span>{notice}</span>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Online Drivers', val: kpis.onlineDrivers ?? 0 },
          { label: 'Pending KYC', val: kpis.pendingApprovals ?? 0 },
          { label: 'Active Rides', val: kpis.activeRides ?? 0 },
          { label: 'Completed Rides', val: kpis.completedRides ?? 0 },
          { label: 'Gross Bookings', val: `₹${kpis.grossBookings ?? '0.00'}` },
          { label: 'Platform Commission', val: `₹${kpis.platformCommission ?? '0.00'}` },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-3.5">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="font-mono text-lg font-bold text-slate-900 tabular-nums mt-1">
              {item.val}
            </p>
          </div>
        ))}
      </div>

      {/* SECTION: OVERVIEW & LIVE MAP */}
      {section === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-7 h-[360px] lg:h-[460px]">
            <CityMap
              pickup={
                selectedRide
                  ? { lat: selectedRide.pickupLat, lng: selectedRide.pickupLng }
                  : null
              }
              drop={
                selectedRide ? { lat: selectedRide.dropLat, lng: selectedRide.dropLng } : null
              }
              nearbyDrivers={cityContext.nearbyDrivers || []}
              className="w-full h-full rounded-2xl"
            />
          </div>
          <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Recent Rides</h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {rides.length} total
              </span>
            </div>
            <div className="divide-y divide-slate-100 overflow-y-auto max-h-[410px]">
              {rides.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No trips recorded yet.</p>
              ) : (
                rides.slice(0, 20).map((r) => {
                  const isActive = [
                    'REQUESTED',
                    'SEARCHING',
                    'ACCEPTED',
                    'ARRIVED',
                    'IN_PROGRESS',
                  ].includes(r.status);
                  const isSelected = selectedRide?.id === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedRide(isSelected ? null : r)}
                      className={`px-4 py-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                        isSelected ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {r.pickupAddress} → {r.dropAddress}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {r.vehicleType} · {r.status} · {r.paymentStatus}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <p className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                          ₹{r.finalFare || r.estimatedFare}
                        </p>
                        {isActive && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAdminCancelRide(r.id);
                            }}
                            className="px-2 py-1 rounded-md border border-red-200 bg-red-50 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION: DRIVER VERIFICATION & DOCUMENT INSPECTION */}
      {section === 'drivers' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search driver name, DL, or Aadhaar..."
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
                {(['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const).map(
                  (status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setDriverFilter(status)}
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold ${
                        driverFilter === status
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600'
                      }`}
                    >
                      {status}
                    </button>
                  )
                )}
              </div>
              <button
                type="button"
                onClick={loadAdminData}
                className="min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col sm:flex-row sm:items-center gap-2.5">
            <label className="text-xs font-semibold text-slate-700 shrink-0">
              Rejection / Suspension Note:
            </label>
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason shown to driver if rejected or suspended..."
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            {filteredDrivers.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500">
                No drivers match this filter.
              </p>
            ) : (
              filteredDrivers.map((d) => (
                <div
                  key={d.driverId}
                  className={`p-4 space-y-3 ${
                    d.verificationStatus === 'PENDING' ? 'bg-amber-50/40' : ''
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-slate-900">{d.name}</p>
                        <span
                          className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded ${
                            d.verificationStatus === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : d.verificationStatus === 'PENDING'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {d.verificationStatus}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          · {d.isOnline ? 'Online' : 'Offline'}
                        </span>
                        {d.phone && <span className="text-xs text-slate-500">· {d.phone}</span>}
                      </div>
                      <p className="text-xs text-slate-700 font-mono">
                        DL: {d.licenceNumber} (exp {d.licenceExpiry}) · Aadhaar:{' '}
                        {d.aadhaarNumber || 'N/A'}
                      </p>
                      {d.vehicles?.[0] && (
                        <p className="text-xs text-slate-600">
                          Vehicle: {d.vehicles[0].make} {d.vehicles[0].model} (
                          {d.vehicles[0].category}) ·{' '}
                          <span className="font-mono font-semibold text-slate-800">
                            {d.vehicles[0].registrationNumber}
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDriverDecision(d.driverId, 'APPROVED')}
                        className="min-h-[40px] px-4 rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDriverDecision(d.driverId, 'REJECTED')}
                        className="min-h-[40px] px-4 rounded-xl border border-red-200 bg-red-50 text-red-800 text-xs font-semibold hover:bg-red-100"
                      >
                        Deny / Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDriverDecision(d.driverId, 'SUSPENDED')}
                        className="min-h-[40px] px-4 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
                      >
                        Suspend
                      </button>
                    </div>
                  </div>

                  {/* Inline Document Previews (Images & PDFs clearly visible) */}
                  {d.documents?.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                      {d.documents.map((doc: any) => {
                        const isImg = doc.fileRef?.startsWith('data:image');
                        const isPdf = doc.fileRef?.startsWith('data:application/pdf');
                        return (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() =>
                              setPreviewDoc({
                                driverName: d.name,
                                docType: doc.documentType.replace(/_/g, ' '),
                                fileRef: doc.fileRef,
                              })
                            }
                            className="text-left rounded-xl border border-slate-200 bg-white p-2.5 hover:border-emerald-600 transition-colors flex items-center gap-3"
                          >
                            {isImg ? (
                              <img
                                src={doc.fileRef}
                                alt={doc.documentType}
                                className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                                <FileText className="w-5 h-5" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-900 truncate">
                                {doc.documentType.replace(/_/g, ' ')}
                              </p>
                              <p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1 mt-0.5">
                                <Eye className="w-3 h-3" />
                                <span>
                                  {isImg ? 'View Photo' : isPdf ? 'View PDF' : 'Inspect Ref'}
                                </span>
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SECTION: FARES & SERVICE POLICY */}
      {section === 'fares' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Versioned Vehicle Tariffs</h2>
            {fareConfigs.map((cfg) => (
              <FareConfigRow key={cfg.id} config={cfg} onSave={handleFareSave} />
            ))}
          </div>

          <form
            onSubmit={handleSaveServiceArea}
            className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 space-y-3.5 h-fit"
          >
            <h2 className="text-sm font-bold text-slate-900">Coverage & Service Policy</h2>
            <div className="space-y-2.5 text-sm">
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Primary Hub</span>
                <input
                  value={areaForm.cityName}
                  onChange={(e) => setAreaForm({ ...areaForm, cityName: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Hub Radius (km)</span>
                <input
                  type="number"
                  value={areaForm.radiusKm}
                  onChange={(e) => setAreaForm({ ...areaForm, radiusKm: Number(e.target.value) })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Operating Hours</span>
                <input
                  value={areaForm.operatingHours}
                  onChange={(e) => setAreaForm({ ...areaForm, operatingHours: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Support Phone</span>
                <input
                  value={areaForm.supportPhone}
                  onChange={(e) => setAreaForm({ ...areaForm, supportPhone: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                />
              </label>
              <label className="flex items-center gap-2 pt-1 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={areaForm.allowOutOfAreaDrop}
                  onChange={(e) =>
                    setAreaForm({ ...areaForm, allowOutOfAreaDrop: e.target.checked })
                  }
                  className="w-4 h-4 accent-emerald-700"
                />
                <span>Enable All-India Pan-City Pickup & Drop</span>
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={areaForm.isActive}
                  onChange={(e) => setAreaForm({ ...areaForm, isActive: e.target.checked })}
                  className="w-4 h-4 accent-emerald-700"
                />
                <span>Platform operations active</span>
              </label>
            </div>
            <button
              type="submit"
              className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
            >
              Update Policy
            </button>
          </form>
        </div>
      )}

      {/* SECTION: SUPPORT, SOS & AUDIT LOGS */}
      {section === 'support' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <div className="rounded-2xl border border-red-200 bg-white p-4 space-y-2">
              <h2 className="text-sm font-bold text-red-900 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                <span>SOS Safety Alerts ({supportData.sos.length})</span>
              </h2>
              {supportData.sos.length === 0 ? (
                <p className="text-xs text-slate-500">No active SOS safety events.</p>
              ) : (
                supportData.sos.map((s) => (
                  <div key={s.id} className="text-xs border-t border-slate-100 pt-2">
                    <p className="font-semibold text-slate-900">
                      {s.userName} ({s.status})
                    </p>
                    <p className="text-slate-600">
                      {s.notes} · ({s.lat.toFixed(4)}, {s.lng.toFixed(4)})
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
              <h2 className="text-sm font-bold text-slate-900">
                Support Tickets ({supportData.tickets.length})
              </h2>
              {supportData.tickets.length === 0 ? (
                <p className="text-xs text-slate-500">No support tickets filed yet.</p>
              ) : (
                supportData.tickets.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2.5 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        {t.creatorName} · {t.category.replace(/_/g, ' ')}
                      </p>
                      <p className="text-slate-600 mt-0.5">{t.description}</p>
                    </div>
                    {t.status !== 'RESOLVED' ? (
                      <button
                        type="button"
                        onClick={() => handleResolveTicket(t.id)}
                        className="min-h-[34px] px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold shrink-0"
                      >
                        Resolve
                      </button>
                    ) : (
                      <span className="font-mono text-emerald-700 font-semibold shrink-0">
                        RESOLVED
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
            <h2 className="text-sm font-bold text-slate-900">Append-Only Audit Trail</h2>
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {auditLogs.map((log) => (
                <div key={log.id} className="py-2.5 text-xs">
                  <div className="flex justify-between font-mono text-slate-800 font-semibold">
                    <span>{log.action}</span>
                    <span className="text-slate-500">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-500 font-mono text-[11px] truncate mt-0.5">
                    {log.entityType} · {log.entityId}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KYC Document Inspector Modal (Images & PDFs) */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">{previewDoc.driverName}</p>
                <h3 className="text-sm font-bold text-slate-900">{previewDoc.docType}</h3>
              </div>
              <div className="flex items-center gap-2">
                {previewDoc.fileRef.startsWith('data:') && (
                  <a
                    href={previewDoc.fileRef}
                    download={`${previewDoc.driverName}-${previewDoc.docType}`}
                    className="min-h-[36px] px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-slate-100"
                  aria-label="Close document preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {previewDoc.fileRef.startsWith('data:image') ? (
              <img
                src={previewDoc.fileRef}
                alt={previewDoc.docType}
                className="w-full max-h-[65vh] object-contain rounded-xl border border-slate-200 bg-slate-50"
              />
            ) : previewDoc.fileRef.startsWith('data:application/pdf') ? (
              <iframe
                src={previewDoc.fileRef}
                title={previewDoc.docType}
                className="w-full h-[65vh] rounded-xl border border-slate-200 bg-slate-50"
              />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-800 break-all">
                {previewDoc.fileRef}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const FareConfigRow: React.FC<{ config: any; onSave: (cfg: any) => Promise<void> }> = ({
  config,
  onSave,
}) => {
  const [form, setForm] = useState({
    vehicleType: config.vehicleType,
    baseFare: config.baseFare,
    perKmRate: config.perKmRate,
    perMinRate: config.perMinRate,
    minimumFare: config.minimumFare,
    waitingFeePerMin: config.waitingFeePerMin,
    cancellationFee: config.cancellationFee,
    commissionRatePct: config.commissionRatePct,
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-900">
          {config.vehicleType}{' '}
          <span className="font-mono text-xs text-slate-500">v{config.version}</span>
        </p>
        <button
          type="button"
          onClick={() => onSave(form)}
          className="min-h-[36px] px-3.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800"
        >
          Save New Version
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <label>
          <span className="text-slate-500">Base (₹)</span>
          <input
            value={form.baseFare}
            onChange={(e) => setForm({ ...form, baseFare: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono"
          />
        </label>
        <label>
          <span className="text-slate-500">Per Km (₹)</span>
          <input
            value={form.perKmRate}
            onChange={(e) => setForm({ ...form, perKmRate: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono"
          />
        </label>
        <label>
          <span className="text-slate-500">Per Min (₹)</span>
          <input
            value={form.perMinRate}
            onChange={(e) => setForm({ ...form, perMinRate: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono"
          />
        </label>
        <label>
          <span className="text-slate-500">Min Fare (₹)</span>
          <input
            value={form.minimumFare}
            onChange={(e) => setForm({ ...form, minimumFare: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono"
          />
        </label>
        <label>
          <span className="text-slate-500">Cancel Fee (₹)</span>
          <input
            value={form.cancellationFee}
            onChange={(e) => setForm({ ...form, cancellationFee: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono"
          />
        </label>
        <label>
          <span className="text-slate-500">Commission (%)</span>
          <input
            value={form.commissionRatePct}
            onChange={(e) => setForm({ ...form, commissionRatePct: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono"
          />
        </label>
      </div>
    </div>
  );
};
