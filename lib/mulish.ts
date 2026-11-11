import { Mulish } from "next/font/google";

// One Mulish instance for the whole app. Each page used to call Mulish() with its own weight list,
// and Turbopack's font loader fails to build those when there's no build cache
// ("next/font/google queries have exactly one entry"). Every page imports this one instead.
// The weight list is the union of the weights the pages use.
export const mulish = Mulish({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});
