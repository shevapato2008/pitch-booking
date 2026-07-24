import type { VenueViewModel } from "../../presentation/venue";

Component({
  properties: {
    venue: {
      type: Object,
      value: null,
    },
  },
});

export type VenueCardProperties = {
  venue: VenueViewModel | null;
};

