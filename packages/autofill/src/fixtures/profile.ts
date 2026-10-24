import { type Profile, ProfileSchema } from "../profile"

/** A filled-in Profile for fixture tests; everything else keeps its default. */
export const sampleProfile: Profile = ProfileSchema.parse({
  personal: { first: "Ada", last: "Lovelace" },
  contact: {
    email: "ada@example.com",
    phone: "+14155550100",
    city: "San Francisco",
    state: "CA",
    zip: "94103",
  },
  links: {
    linkedin: "https://www.linkedin.com/in/ada",
    github: "https://github.com/ada",
    website: "https://ada.dev",
  },
  workAuth: {
    authorized: "yes",
    sponsorshipNow: "no",
    sponsorshipFuture: "no",
  },
})
