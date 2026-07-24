import type {
  Availability,
  AvailabilityWindow,
  PitchType,
  Slot,
  SlotStatus,
} from "../domain/contracts";

interface StatusPresentation {
  label: string;
  className: string;
}

const STATUS_PRESENTATION: Record<SlotStatus, StatusPresentation> = {
  EXPIRED: { label: "已结束", className: "slot--expired" },
  AVAILABLE: { label: "可订", className: "slot--available" },
  TEMPORARILY_LOCKED: {
    label: "暂时锁定",
    className: "slot--temporarily-locked",
  },
  BOOKED: { label: "已预订", className: "slot--booked" },
  CLOSED: { label: "未开放", className: "slot--closed" },
};

export interface AvailabilityDateViewModel {
  date: string;
  monthDayLabel: string;
  weekdayLabel: string;
}

export interface SlotViewModel {
  id: string;
  status: SlotStatus;
  unavailableReason: Slot["unavailableReason"];
  timeText: string;
  priceText: string;
  statusLabel: string;
  className: string;
  isSelectable: boolean;
  isSelected: boolean;
}

export interface PitchGroupViewModel {
  id: string;
  name: string;
  pitchType: PitchType;
  slots: SlotViewModel[];
}

export interface AvailabilityViewModel {
  venueId: string;
  date: string;
  pitchType: PitchType;
  dates: AvailabilityDateViewModel[];
  pitchGroups: PitchGroupViewModel[];
  isEmpty: boolean;
}

export function formatPriceCents(priceCents: number): string {
  const yuan = Math.floor(priceCents / 100);
  const cents = priceCents % 100;
  return cents === 0 ? `¥${yuan}` : `¥${yuan}.${String(cents).padStart(2, "0")}`;
}

export function formatTimeRange(startsAt: string, endsAt: string): string {
  return `${startsAt.slice(11, 16)}–${endsAt.slice(11, 16)}`;
}

export function buildAvailabilityDates(
  window: AvailabilityWindow,
): AvailabilityDateViewModel[] {
  const [startYear, startMonth, startDay] = window.startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = window.endDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const endTime = Date.UTC(endYear, endMonth - 1, endDay);
  const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const dates: AvailabilityDateViewModel[] = [];

  while (cursor.getTime() <= endTime) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();
    dates.push({
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      monthDayLabel: `${month}月${day}日`,
      weekdayLabel: weekdayLabels[cursor.getUTCDay()],
    });
    cursor.setUTCDate(day + 1);
  }

  return dates;
}

export function toggleSelectedSlot(
  selectedSlotId: string | null,
  tappedSlotId: string,
  status: SlotStatus,
): string | null {
  if (status !== "AVAILABLE") return selectedSlotId;
  return selectedSlotId === tappedSlotId ? null : tappedSlotId;
}

export function toAvailabilityViewModel(
  availability: Availability,
  selectedSlotId: string | null,
): AvailabilityViewModel {
  const pitchGroups = availability.pitchGroups
    .filter((pitchGroup) => pitchGroup.pitchType === availability.pitchType)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((pitchGroup): PitchGroupViewModel => ({
      id: pitchGroup.id,
      name: pitchGroup.name,
      pitchType: pitchGroup.pitchType,
      slots: [...pitchGroup.slots]
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
        .map((slot): SlotViewModel => {
          const selected = slot.status === "AVAILABLE" && slot.id === selectedSlotId;
          const presentation = STATUS_PRESENTATION[slot.status];
          return {
            id: slot.id,
            status: slot.status,
            unavailableReason: slot.unavailableReason,
            timeText: formatTimeRange(slot.startsAt, slot.endsAt),
            priceText: formatPriceCents(slot.priceCents),
            statusLabel: selected ? "已选择" : presentation.label,
            className: selected ? "slot--selected" : presentation.className,
            isSelectable: slot.status === "AVAILABLE",
            isSelected: selected,
          };
        }),
    }));

  return {
    venueId: availability.venueId,
    date: availability.date,
    pitchType: availability.pitchType,
    dates: buildAvailabilityDates(availability.availabilityWindow),
    pitchGroups,
    isEmpty: pitchGroups.every((pitchGroup) => pitchGroup.slots.length === 0),
  };
}
