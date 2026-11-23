import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { fareConfigs } from '../../db/schema.ts';
import { estimateRoadTrip } from '../location/location.service.ts';

export interface FareEstimateItem {
  vehicleType: string;
  label: string;
  etaMin: number;
  distanceKm: number;
  durationMin: number;
  estimatedFare: string;
  fareVersion: number;
  breakdown: {
    baseFare: string;
    distanceCharge: string;
    timeCharge: string;
    minimumAdjustment: string;
    minimumFare: string;
    cancellationFee: string;
    commissionRatePct: string;
  };
}

const VEHICLE_LABELS: Record<string, string> = {
  BIKE: 'Moto Bike',
  AUTO: 'City Auto',
  MINI: 'Metro Mini',
  SEDAN: 'Prime Sedan',
};

export async function getActiveFareConfigs() {
  return await db.select().from(fareConfigs).where(eq(fareConfigs.isActive, true));
}

export async function calculateFareEstimates(
  pickupLat: number,
  pickupLng: number,
  dropLat: number,
  dropLng: number
): Promise<FareEstimateItem[]> {
  const { distanceKm, durationMin } = estimateRoadTrip(pickupLat, pickupLng, dropLat, dropLng);
  const configs = await getActiveFareConfigs();

  const order = ['BIKE', 'AUTO', 'MINI', 'SEDAN'];
  const sorted = [...configs].sort(
    (a, b) => order.indexOf(a.vehicleType) - order.indexOf(b.vehicleType)
  );

  return sorted.map((cfg, idx) => {
    const baseFare = Number(cfg.baseFare);
    const perKm = Number(cfg.perKmRate);
    const perMin = Number(cfg.perMinRate);
    const minFare = Number(cfg.minimumFare);

    const distanceCharge = Number((distanceKm * perKm).toFixed(2));
    const timeCharge = Number((durationMin * perMin).toFixed(2));
    const rawTotal = Number((baseFare + distanceCharge + timeCharge).toFixed(2));
    const minimumAdjustment = rawTotal < minFare ? Number((minFare - rawTotal).toFixed(2)) : 0;
    const total = Math.max(minFare, rawTotal);

    return {
      vehicleType: cfg.vehicleType,
      label: VEHICLE_LABELS[cfg.vehicleType] || cfg.vehicleType,
      etaMin: 3 + idx * 2,
      distanceKm,
      durationMin,
      estimatedFare: total.toFixed(2),
      fareVersion: cfg.version,
      breakdown: {
        baseFare: baseFare.toFixed(2),
        distanceCharge: distanceCharge.toFixed(2),
        timeCharge: timeCharge.toFixed(2),
        minimumAdjustment: minimumAdjustment.toFixed(2),
        minimumFare: minFare.toFixed(2),
        cancellationFee: Number(cfg.cancellationFee).toFixed(2),
        commissionRatePct: Number(cfg.commissionRatePct).toFixed(2),
      },
    };
  });
}
