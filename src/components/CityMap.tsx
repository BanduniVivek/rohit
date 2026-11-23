import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';

export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface MapDriver {
  driverId: string;
  driverName?: string;
  category?: string;
  lat: number;
  lng: number;
  heading?: number;
}

interface CityMapProps {
  landmarks?: Array<{ id: string; name: string; address: string; lat: number; lng: number }>;
  pickup?: MapPoint | null;
  drop?: MapPoint | null;
  routeCoords?: [number, number][];
  nearbyDrivers?: MapDriver[];
  assignedDriver?: MapDriver | null;
  activeSelectionMode?: 'pickup' | 'drop' | null;
  onMapPick?: (lat: number, lng: number, label: string) => void;
  serviceRadiusKm?: number;
  className?: string;
}

function createPinIcon(color: string, text: string) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
      <div style="background:${color};color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.28);">${text}</div>
      <div style="width:12px;height:12px;border-radius:9999px;background:${color};border:2.5px solid #fff;margin-top:2px;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function createDriverIcon(isAssigned: boolean, label: string, heading = 0) {
  const bg = isAssigned ? '#059669' : '#0F172A';
  const ring = isAssigned ? '0 0 0 6px rgba(5,150,105,0.22)' : '0 2px 6px rgba(0,0,0,0.25)';
  return L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-50%) rotate(${heading}deg);width:${
      isAssigned ? 34 : 26
    }px;height:${
      isAssigned ? 34 : 26
    }px;border-radius:9999px;background:${bg};color:#fff;border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;box-shadow:${ring};transition:all 0.25s linear;">${label}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

export const CityMap: React.FC<CityMapProps> = ({
  pickup,
  drop,
  routeCoords = [],
  nearbyDrivers = [],
  assignedDriver,
  activeSelectionMode,
  onMapPick,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const dropMarkerRef = useRef<L.Marker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const assignedMarkerRef = useRef<L.Marker | null>(null);
  const nearbyLayerRef = useRef<L.LayerGroup | null>(null);
  const onMapPickRef = useRef(onMapPick);
  const lastRouteKeyRef = useRef<string>('');
  const lastDriverPanKeyRef = useRef<string>('');

  onMapPickRef.current = onMapPick;

  // Initialize Leaflet map centered over India/initial location
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialLat = pickup?.lat || assignedDriver?.lat || 20.5937;
    const initialLng = pickup?.lng || assignedDriver?.lng || 78.9629;
    const initialZoom = pickup || assignedDriver ? 13 : 5;

    const map = L.map(containerRef.current, {
      center: [initialLat, initialLng],
      zoom: initialZoom,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    nearbyLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!onMapPickRef.current) return;
      const lat = Number(e.latlng.lat.toFixed(5));
      const lng = Number(e.latlng.lng.toFixed(5));
      onMapPickRef.current(lat, lng, `Pinned (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Pickup & Drop markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (pickup) {
      if (!pickupMarkerRef.current) {
        pickupMarkerRef.current = L.marker([pickup.lat, pickup.lng], {
          icon: createPinIcon('#059669', 'PICKUP'),
        }).addTo(map);
      } else {
        pickupMarkerRef.current.setLatLng([pickup.lat, pickup.lng]);
      }
    } else if (pickupMarkerRef.current) {
      pickupMarkerRef.current.remove();
      pickupMarkerRef.current = null;
    }

    if (drop) {
      if (!dropMarkerRef.current) {
        dropMarkerRef.current = L.marker([drop.lat, drop.lng], {
          icon: createPinIcon('#D97706', 'DROP'),
        }).addTo(map);
      } else {
        dropMarkerRef.current.setLatLng([drop.lat, drop.lng]);
      }
    } else if (dropMarkerRef.current) {
      dropMarkerRef.current.remove();
      dropMarkerRef.current = null;
    }
  }, [pickup?.lat, pickup?.lng, drop?.lat, drop?.lng]);

  // Update Route Polyline & fit bounds whenever pickup/drop/route changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }

    const pts: [number, number][] =
      routeCoords.length >= 2
        ? routeCoords
        : pickup && drop
        ? [
            [pickup.lat, pickup.lng],
            [drop.lat, drop.lng],
          ]
        : [];

    const routeKey = `${pickup?.lat ?? ''},${pickup?.lng ?? ''}|${drop?.lat ?? ''},${
      drop?.lng ?? ''
    }|${routeCoords.length}`;

    if (pts.length >= 2) {
      routeLineRef.current = L.polyline(pts, {
        color: '#0F172A',
        weight: 4,
        opacity: 0.85,
      }).addTo(map);

      if (lastRouteKeyRef.current !== routeKey) {
        const bounds = L.latLngBounds(pts);
        if (assignedDriver) {
          bounds.extend([assignedDriver.lat, assignedDriver.lng]);
        }
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
        lastRouteKeyRef.current = routeKey;
      }
    } else if (pickup && lastRouteKeyRef.current !== routeKey) {
      map.setView([pickup.lat, pickup.lng], 14);
      lastRouteKeyRef.current = routeKey;
    } else if (!pickup && !drop) {
      lastRouteKeyRef.current = '';
    }
  }, [routeCoords, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng]);

  // Update Nearby Drivers
  useEffect(() => {
    const group = nearbyLayerRef.current;
    if (!group) return;
    group.clearLayers();
    for (const drv of nearbyDrivers) {
      if (assignedDriver && drv.driverId === assignedDriver.driverId) continue;
      L.marker([drv.lat, drv.lng], {
        icon: createDriverIcon(false, (drv.category || 'C').slice(0, 1), drv.heading || 0),
      })
        .bindTooltip(drv.driverName || 'Online Driver')
        .addTo(group);
    }
  }, [nearbyDrivers, assignedDriver?.driverId]);

  // Update Real-Time GPS Driver Marker & follow if no route is pinning the viewport
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (assignedDriver) {
      const label = (assignedDriver.category || 'CAB').slice(0, 3).toUpperCase();
      if (!assignedMarkerRef.current) {
        assignedMarkerRef.current = L.marker([assignedDriver.lat, assignedDriver.lng], {
          icon: createDriverIcon(true, label, assignedDriver.heading || 0),
          zIndexOffset: 500,
        })
          .bindTooltip(assignedDriver.driverName || 'Driver Live GPS')
          .addTo(map);
      } else {
        assignedMarkerRef.current.setLatLng([assignedDriver.lat, assignedDriver.lng]);
        assignedMarkerRef.current.setIcon(
          createDriverIcon(true, label, assignedDriver.heading || 0)
        );
      }

      if (!pickup && !drop) {
        const panKey = `${assignedDriver.lat.toFixed(3)},${assignedDriver.lng.toFixed(3)}`;
        if (lastDriverPanKeyRef.current !== panKey) {
          map.setView([assignedDriver.lat, assignedDriver.lng], Math.max(map.getZoom(), 14));
          lastDriverPanKeyRef.current = panKey;
        }
      }
    } else if (assignedMarkerRef.current) {
      assignedMarkerRef.current.remove();
      assignedMarkerRef.current = null;
    }
  }, [assignedDriver?.lat, assignedDriver?.lng, assignedDriver?.category, assignedDriver?.heading, pickup, drop]);

  return (
    <div className={`relative overflow-hidden bg-slate-100 border border-slate-200 ${className}`}>
      <div
        ref={containerRef}
        className={`w-full h-full z-0 ${activeSelectionMode ? 'cursor-crosshair' : ''}`}
      />

      {activeSelectionMode && (
        <div className="absolute bottom-4 left-4 right-4 sm:right-auto z-[400] flex items-center gap-2 rounded-xl bg-slate-900/95 text-white px-3.5 py-2 text-xs font-semibold shadow-lg pointer-events-none">
          <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            {activeSelectionMode === 'pickup' && 'Tap anywhere on the map to set Pickup location'}
            {activeSelectionMode === 'drop' && 'Tap anywhere on the map to set Destination'}
          </span>
        </div>
      )}
    </div>
  );
};
