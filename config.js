// Google Maps Platform key (Places API New). Restrict it in Google Cloud to:
//   Application restriction: Websites -> https://oritre.github.io/*  (app lives at /agaloy/)
//   API restriction: Places API (New) only
// An empty key keeps the app working from the sheet alone.
const CONFIG = {
  GOOGLE_KEY: "",
  SHEET_ID: "1BJO256iyHm4XSVaf3zZBj3BVo-tbkbvCDV1rntm8HJE",
  DETAILS_TTL_DAYS: 3,      // refresh Google details for each place at most every N days (stays inside the free tier)
  DISCOVERY_TTL_DAYS: 7,    // look for new carts on Google Maps at most once a week
  MATCH_TTL_DAYS: 30        // retry finding a Google listing for an unmatched place after N days
};
