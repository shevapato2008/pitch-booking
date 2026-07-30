import type { AnyVenueViewModel } from "../../presentation/venue";

Component({
  properties: {
    venue: {
      type: Object,
      value: null,
    },
  },
});

export type VenueCardProperties = {
  venue: AnyVenueViewModel | null;
};
