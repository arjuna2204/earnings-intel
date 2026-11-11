/**
 * Cboe delayed quotes (options chains, prices for the basic top-500 rows, VIX) are published for viewing
 * on cboe.com; Cboe asks for approval before its content is used elsewhere. Set CBOE_DATA=off in
 * Vercel (and as a GitHub secret, to stop fetching) for a public launch until that's sorted.
 */
export const CBOE_ON = process.env.CBOE_DATA !== "off";
